// Conexión con Autodesk Forma sin que cada usuario tenga cuenta de Autodesk.
// Un administrador conecta su cuenta una vez y se guardan dos accesos independientes:
//   "data": data:read/write/create, solo en el servidor: versión más reciente del IFC y envío de generadores.
//   "view": viewables:read, el único que llega al navegador; solo sirve para ver modelos ya convertidos.
import { HttpError } from "./http.js";
import { key, getJson, setJson, lock, unlock } from "./store.js";

export const BASE = "https://developer.api.autodesk.com";
export const CHAINS = { data: "data:read data:write data:create", view: "viewables:read" };

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
  await setJson(chainKey(chain), { ...tokens, by, at: new Date().toISOString(), scope: CHAINS[chain] });
}

export async function formaStatus() {
  const [d, v] = await Promise.all([getJson(chainKey("data")), getJson(chainKey("view"))]);
  // Las conexiones hechas antes de habilitar el envío de generadores solo pueden leer.
  const escritura = Boolean(d && d.scope && d.scope.includes("data:write"));
  return { conectado: Boolean(d && v), por: (d && d.by) || null, desde: (d && d.at) || null, escritura };
}

// Token vigente de una cadena; lo renueva si está por vencer. Autodesk entrega un refresh token nuevo
// en cada renovación e invalida el anterior, así que solo una solicitud a la vez puede renovar.
export async function getToken(chain) {
  for (let i = 0; i < 8; i++) {
    const t = await getJson(chainKey(chain));
    if (!t || !t.refresh) throw new HttpError(409, "Forma no está conectado. Un administrador debe conectarlo desde Configuración.");
    if (t.access && Date.now() < t.exp - 120_000) return t;
    const lk = chainKey(chain) + ":lock";
    if (await lock(lk, 20)) {
      try {
        const fresh = await getJson(chainKey(chain));
        if (fresh.access && Date.now() < fresh.exp - 120_000) return fresh;
        const n = await tokenRequest({ grant_type: "refresh_token", refresh_token: fresh.refresh, scope: CHAINS[chain] });
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

export async function call(path, { method = "GET", json } = {}) {
  const t = await getToken("data");
  const headers = { Authorization: "Bearer " + t.access };
  if (json) headers["Content-Type"] = path.startsWith("/data/") ? "application/vnd.api+json" : "application/json";
  const r = await fetch(path.startsWith("http") ? path : BASE + path, { method, headers, body: json ? JSON.stringify(json) : undefined });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const msg = r.status === 403 || r.status === 404
      ? "La cuenta conectada no tiene acceso en Forma a ese archivo o carpeta (o no puede subir archivos ahí), o la liga no es correcta."
      : `Forma respondió con un error (${r.status}).`;
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

export async function folderInfo(projectId, folderUrn) {
  const f = await call(`/data/v1/projects/${encodeURIComponent(projectId)}/folders/${encodeURIComponent(folderUrn)}`);
  const a = (f && f.data && f.data.attributes) || {};
  return { nombre: a.displayName || a.name || "Carpeta" };
}

// Sube un archivo a una carpeta de Docs. Si ya existe uno con el mismo nombre, se guarda como versión nueva.
export async function subirArchivo(projectId, folderUrn, nombre, bytes) {
  const P = encodeURIComponent(projectId);
  // 1) Espacio de almacenamiento en la carpeta.
  const st = await call(`/data/v1/projects/${P}/storage`, { method: "POST", json: {
    jsonapi: { version: "1.0" },
    data: { type: "objects", attributes: { name: nombre }, relationships: { target: { data: { type: "folders", id: folderUrn } } } },
  } });
  const objId = st && st.data && st.data.id; // urn:adsk.objects:os.object:<bucket>/<objeto>
  const m = /^urn:adsk\.objects:os\.object:([^/]+)\/(.+)$/.exec(objId || "");
  if (!m) throw new HttpError(502, "Forma no devolvió dónde guardar el archivo.");
  const oss = `/oss/v2/buckets/${encodeURIComponent(m[1])}/objects/${encodeURIComponent(m[2])}/signeds3upload`;
  // 2) Liga firmada, 3) subida directa y 4) cierre de la subida.
  const sig = await call(oss);
  const put = await fetch(sig.urls[0], { method: "PUT", body: bytes });
  if (!put.ok) throw new HttpError(502, `No se pudo subir el archivo a Forma (${put.status}).`);
  await call(oss, { method: "POST", json: { uploadKey: sig.uploadKey } });
  // 5) ¿Ya existe un archivo con ese nombre en la carpeta?
  const cont = await call(`/data/v1/projects/${P}/folders/${encodeURIComponent(folderUrn)}/contents?filter[type]=items&filter[attributes.displayName]=${encodeURIComponent(nombre)}`);
  const existente = ((cont && cont.data) || []).find((x) => x.attributes && x.attributes.displayName === nombre);
  const storage = { data: { type: "objects", id: objId } };
  const ext = (t) => ({ type: t, version: "1.0" });
  if (existente) {
    const v = await call(`/data/v1/projects/${P}/versions`, { method: "POST", json: {
      jsonapi: { version: "1.0" },
      data: { type: "versions", attributes: { name: nombre, extension: ext("versions:autodesk.bim360:File") },
        relationships: { item: { data: { type: "items", id: existente.id } }, storage } },
    } });
    return { nombre, version: (v && v.data && v.data.attributes && v.data.attributes.versionNumber) || null, nuevo: false };
  }
  const it = await call(`/data/v1/projects/${P}/items`, { method: "POST", json: {
    jsonapi: { version: "1.0" },
    data: { type: "items", attributes: { displayName: nombre, extension: ext("items:autodesk.bim360:File") },
      relationships: { tip: { data: { type: "versions", id: "1" } }, parent: { data: { type: "folders", id: folderUrn } } } },
    included: [{ type: "versions", id: "1", attributes: { name: nombre, extension: ext("versions:autodesk.bim360:File") }, relationships: { storage } }],
  } });
  void it;
  return { nombre, version: 1, nuevo: true };
}

export const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
