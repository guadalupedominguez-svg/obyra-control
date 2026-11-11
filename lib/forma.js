// Conexión con Autodesk Forma sin que cada usuario tenga cuenta de Autodesk.
// Un administrador conecta su cuenta una vez y se guardan dos accesos independientes:
//   "data": data:read, solo en el servidor, para encontrar la versión más reciente del IFC y leer carpetas.
//   "view": viewables:read, el único que llega al navegador; solo sirve para ver modelos ya convertidos.
import { HttpError } from "./http.js";
import { key, getJson, setJson, lock, unlock, cmd } from "./store.js";

export const BASE = "https://developer.api.autodesk.com";
// La conexión del administrador solo lee (IFC y nombres de carpetas); los envíos usan la cuenta de cada residente.
export const CHAINS = { data: "data:read", view: "viewables:read", cuenta: "data:read data:write data:create" };
// "cuenta:<correo>" es la cuenta de Autodesk propia de un residente: con ella sube sus generadores.
const scopeOf = (chain) => CHAINS[String(chain).split(":")[0]];
export const cuentaChain = (email) => "cuenta:" + email;

export function callbackUrl(req) {
  if (process.env.APS_CALLBACK_URL) return process.env.APS_CALLBACK_URL;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}/api/forma/callback`;
}

function basicAuth() {
  const id = process.env.APS_CLIENT_ID, secret = process.env.APS_CLIENT_SECRET;
  if (!id || !secret) throw new HttpError(500, "Faltan APS_CLIENT_ID o APS_CLIENT_SECRET en las variables del servidor.");
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

export async function tokenRequest(params) {
  const r = await fetch(BASE + "/authentication/v2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Authorization: basicAuth() },
    body: new URLSearchParams(params),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new HttpError(502, "Autodesk rechazó la conexión. Vuelve a conectar Forma desde Configuración.", j);
  return { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
}

const chainKey = (chain) => key("forma", chain);

export async function saveChain(chain, tokens, by) {
  await setJson(chainKey(chain), { ...tokens, by, at: new Date().toISOString(), scope: scopeOf(chain) });
}

export async function cuentaStatus(email) {
  const t = await getJson(chainKey(cuentaChain(email)));
  return { conectada: Boolean(t && t.refresh), desde: (t && t.at) || null };
}
export const borrarCuenta = (email) => cmd(["DEL", chainKey(cuentaChain(email))]);

export async function formaStatus() {
  const [d, v] = await Promise.all([getJson(chainKey("data")), getJson(chainKey("view"))]);
  return { conectado: Boolean(d && v), por: (d && d.by) || null, desde: (d && d.at) || null };
}

// Token vigente de una cadena; lo renueva si está por vencer. Autodesk entrega un refresh token nuevo
// en cada renovación e invalida el anterior, así que solo una solicitud a la vez puede renovar.
export async function getToken(chain) {
  for (let i = 0; i < 8; i++) {
    const t = await getJson(chainKey(chain));
    if (!t || !t.refresh) {
      throw new HttpError(409, String(chain).startsWith("cuenta:")
        ? "Conecta tu cuenta de Autodesk (botón «Conectar mi cuenta de Autodesk») para enviar generadores a Forma."
        : "Forma no está conectado. Un administrador debe conectarlo desde Configuración.");
    }
    if (t.access && Date.now() < t.exp - 120_000) return t;
    const lk = chainKey(chain) + ":lock";
    if (await lock(lk, 20)) {
      try {
        const fresh = await getJson(chainKey(chain));
        if (fresh.access && Date.now() < fresh.exp - 120_000) return fresh;
        const n = await tokenRequest({ grant_type: "refresh_token", refresh_token: fresh.refresh, scope: scopeOf(chain) });
        const doc = { ...fresh, ...n };
        await setJson(chainKey(chain), doc);
        return doc;
      } finally {
        await unlock(lk);
      }
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new HttpError(503, "Forma está ocupado renovando la conexión. Intenta de nuevo en unos segundos.");
}

export async function call(path, { method = "GET", json, chain = "data" } = {}) {
  const t = await getToken(chain);
  const headers = { Authorization: "Bearer " + t.access };
  if (json) headers["Content-Type"] = path.startsWith("/data/") ? "application/vnd.api+json" : "application/json";
  const r = await fetch(path.startsWith("http") ? path : BASE + path, { method, headers, body: json ? JSON.stringify(json) : undefined });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    // Texto de Autodesk para saber qué rechazó (permisos, nombre, carpeta…).
    const e0 = body && body.errors && body.errors[0];
    const det = String((e0 && (e0.detail || e0.title)) || (body && (body.reason || body.developerMessage || body.message)) || "").slice(0, 200);
    const msg = (r.status === 403 || r.status === 404
      ? "La cuenta conectada no tiene acceso en Forma a ese archivo o carpeta (o no puede subir archivos ahí), o la liga no es correcta."
      : `Forma respondió con un error (${r.status}).`) + (det ? " Autodesk: " + det : "");
    throw new HttpError(r.status === 401 ? 409 : 502, msg, body);
  }
  return body;
}

// Lee la liga que se copia de Forma Docs: https://acc.autodesk.com/docs/files/projects/<id>?...&entityId=urn:adsk.wipprod:dm.lineage:...
export function parseFormaLink(link) {
  let u;
  try { u = new URL(String(link || "").trim()); } catch { throw new HttpError(400, "Pega la liga completa del archivo IFC en Forma."); }
  const pm = /\/projects\/([0-9a-fA-F-]{36})/.exec(u.pathname);
  const entity = u.searchParams.get("entityId") || "";
  if (!pm || !/^urn:adsk\.wip[a-z]+:dm\.lineage:[A-Za-z0-9_-]+$/.test(entity)) {
    throw new HttpError(400, "La liga no trae el proyecto y el archivo. En Forma Docs abre el IFC y copia la liga desde la barra del navegador.");
  }
  return { projectId: "b." + pm[1].toLowerCase(), lineage: entity };
}

// Versión más reciente de un archivo de Docs.
export async function latestVersion(projectId, lineage) {
  const it = await call(`/data/v1/projects/${encodeURIComponent(projectId)}/items/${encodeURIComponent(lineage)}`);
  const tip = it && it.data && it.data.relationships && it.data.relationships.tip && it.data.relationships.tip.data;
  const ver = ((it && it.included) || []).find((x) => tip && x.id === tip.id) || null;
  if (!tip) throw new HttpError(502, "Forma no devolvió la versión del archivo.");
  const a = (ver && ver.attributes) || {};
  return {
    versionUrn: tip.id,
    versionNumber: a.versionNumber || null,
    fileName: a.displayName || a.name || (it.data.attributes && it.data.attributes.displayName) || "",
    fecha: a.lastModifiedTime || a.createTime || null,
  };
}

// Liga de una carpeta de Forma Docs: https://acc.autodesk.com/docs/files/projects/<id>?folderUrn=urn:adsk.wipprod:fs.folder:co.XXXX
export function parseFolderLink(link) {
  let u;
  try { u = new URL(String(link || "").trim()); } catch { throw new HttpError(400, "Pega la liga completa de la carpeta en Forma."); }
  const pm = /\/projects\/([0-9a-fA-F-]{36})/.exec(u.pathname);
  const folder = u.searchParams.get("folderUrn") || "";
  if (!pm || !/^urn:adsk\.wip[a-z]+:fs\.folder:co\.[A-Za-z0-9_-]+$/.test(folder)) {
    throw new HttpError(400, "La liga no trae el proyecto y la carpeta. En Forma Docs abre la carpeta y copia la liga desde la barra del navegador.");
  }
  return { projectId: "b." + pm[1].toLowerCase(), folderUrn: folder };
}

export async function folderInfo(projectId, folderUrn, chain = "data") {
  const f = await call(`/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderUrn)}`, { chain });
  const a = (f && f.data && f.data.attributes) || {};
  return { nombre: a.displayName || a.name || "Carpeta" };
}

// Hub (cuenta de Forma) al que pertenece un proyecto; se guarda para no buscarlo cada vez.
async function hubDe(projectId, chain) {
  const k = key("forma", "hub", projectId);
  const guardado = await getJson(k);
  if (guardado) return guardado;
  const hubs = (await call("/project/v1/hubs", { chain })).data || [];
  for (const h of hubs) {
    try {
      await call(`/project/v1/hubs/${encodeURIComponent(h.id)}/projects/${encodeURIComponent(projectId)}`, { chain });
      await setJson(k, h.id);
      return h.id;
    } catch { /* no es de este hub */ }
  }
  throw new HttpError(404, "No se encontró el proyecto de Forma con esta cuenta de Autodesk.");
}

// Carpeta visible más alta, subiendo desde la carpeta del IFC (Project Files). No necesita el hub,
// así que funciona aunque Autodesk no deje listar los proyectos de la cuenta.
async function raizDesdeIfc(projectId, lineage, chain) {
  const P = encodeURIComponent(projectId);
  let f = (await call(`/data/v1/projects/${P}/items/${encodeURIComponent(lineage)}/parent`, { chain })).data;
  for (let i = 0; f && i < 30; i++) {
    let padre = null;
    try { padre = (await call(`/data/v1/projects/${P}/folders/${encodeURIComponent(f.id)}/parent`, { chain })).data; } catch { padre = null; }
    if (!padre || (padre.attributes && padre.attributes.hidden)) break; // llegó a la raíz oculta del proyecto
    f = padre;
  }
  return f ? [{ id: f.id, nombre: (f.attributes && (f.attributes.displayName || f.attributes.name)) || "Project Files" }] : [];
}

// Carpetas para el explorador: sin "padre", las carpetas principales del proyecto (Project Files, …).
export async function listarCarpetas(projectId, padre, chain = "data", { lineage } = {}) {
  const P = encodeURIComponent(projectId);
  const out = [];
  let url;
  if (!padre) {
    try {
      const hub = await hubDe(projectId, chain);
      url = `/project/v1/hubs/${encodeURIComponent(hub)}/projects/${P}/topFolders?excludeDeleted=true`;
    } catch (e) {
      if (!lineage) throw e;
      return raizDesdeIfc(projectId, lineage, chain);
    }
  } else {
    url = `/data/v1/projects/${P}/folders/${encodeURIComponent(padre)}/contents?filter[type]=folders&page[limit]=200`;
  }
  for (let i = 0; url && i < 20; i++) {
    const r = await call(url, { chain });
    for (const f of (r && r.data) || []) {
      const a = f.attributes || {};
      if (f.type !== "folders" || a.hidden) continue;
      out.push({ id: f.id, nombre: a.displayName || a.name || "Carpeta" });
    }
    url = r && r.links && r.links.next && r.links.next.href;
  }
  return out.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { numeric: true }));
}

// Sube un archivo a una carpeta de Docs. Si ya existe uno con el mismo nombre, se guarda como versión nueva.
export async function subirArchivo(projectId, folderUrn, nombre, bytes, chain = "data") {
  const P = encodeURIComponent(projectId);
  // Cada paso con su nombre, para que el error diga dónde falló.
  const paso = async (txt, fn) => {
    try { return await fn(); } catch (e) { if (e instanceof HttpError) e.message = `Al ${txt}: ${e.message}`; throw e; }
  };
  // 1) Espacio de almacenamiento en la carpeta.
  const st = await paso("reservar espacio en la carpeta", () => call(`/data/v1/projects/${P}/storage`, { method: "POST", chain, json: {
    jsonapi: { version: "1.0" },
    data: { type: "objects", attributes: { name: nombre }, relationships: { target: { data: { type: "folders", id: folderUrn } } } },
  } }));
  const objId = st && st.data && st.data.id; // urn:adsk.objects:os.object:<bucket>/<objeto>
  const m = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(objId || "");
  if (!m) throw new HttpError(502, "Forma no devolvió dónde guardar el archivo.");
  const oss = `/oss/v2/buckets/${encodeURIComponent(m[1])}/objects/${encodeURIComponent(m[2])}/signeds3upload`;
  // 2) Liga firmada, 3) subida directa y 4) cierre de la subida.
  await paso("subir el archivo", async () => {
    const sig = await call(oss, { chain });
    const put = await fetch(sig.urls[0], { method: "PUT", body: bytes });
    if (!put.ok) throw new HttpError(502, `No se pudo subir el archivo a Forma (${put.status}).`);
    await call(oss, { method: "POST", chain, json: { uploadKey: sig.uploadKey } });
  });
  // 5) ¿Ya existe un archivo con ese nombre en la carpeta?
  const cont = await paso("revisar la carpeta", () => call(`/data/v1/projects/${P}/folders/${encodeURIComponent(folderUrn)}/contents?filter[type]=items&filter[attributes.displayName]=${encodeURIComponent(nombre)}`, { chain }));
  const existente = ((cont && cont.data) || []).find((x) => x.attributes && x.attributes.displayName === nombre);
  const storage = { data: { type: "objects", id: objId } };
  const ext = (t) => ({ type: t, version: "1.0" });
  if (existente) {
    const v = await paso("guardar la versión nueva", () => call(`/data/v1/projects/${P}/versions`, { method: "POST", chain, json: {
      jsonapi: { version: "1.0" },
      data: { type: "versions", attributes: { name: nombre, extension: ext("versions:autodesk.bim360:File") },
        relationships: { item: { data: { type: "items", id: existente.id } }, storage } },
    } }));
    return { nombre, version: (v && v.data && v.data.attributes && v.data.attributes.versionNumber) || null, nuevo: false };
  }
  await paso("registrar el archivo en la carpeta", () => call(`/data/v1/projects/${P}/items`, { method: "POST", chain, json: {
    jsonapi: { version: "1.0" },
    data: { type: "items", attributes: { displayName: nombre, extension: ext("items:autodesk.bim360:File") },
      relationships: { tip: { data: { type: "versions", id: "1" } }, parent: { data: { type: "folders", id: folderUrn } } } },
    included: [{ type: "versions", id: "1", attributes: { name: nombre, extension: ext("versions:autodesk.bim360:File") }, relationships: { storage } }],
  } }));
  return { nombre, version: 1, nuevo: true };
}

export const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
