// Conexión con Autodesk Forma sin que cada usuario tenga cuenta de Autodesk.
// Un administrador conecta su cuenta una vez y se guardan dos accesos independientes:
//   "data": data:read, solo en el servidor, para encontrar la versión más reciente del IFC.
//   "view": viewables:read, el único que llega al navegador; solo sirve para ver modelos ya convertidos.
import { HttpError } from "./http.js";
import { key, getJson, setJson, lock, unlock } from "./store.js";

export const BASE = "https://developer.api.autodesk.com";
export const CHAINS = { data: "data:read", view: "viewables:read" };

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
  await setJson(chainKey(chain), { ...tokens, by, at: new Date().toISOString() });
}

export async function formaStatus() {
  const [d, v] = await Promise.all([getJson(chainKey("data")), getJson(chainKey("view"))]);
  return { conectado: Boolean(d && v), por: (d && d.by) || null, desde: (d && d.at) || null };
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

export async function call(path) {
  const t = await getToken("data");
  const r = await fetch(path.startsWith("http") ? path : BASE + path, { headers: { Authorization: "Bearer " + t.access } });
  const text = await r.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!r.ok) {
    const msg = r.status === 403 || r.status === 404
      ? "La cuenta conectada no tiene acceso a ese archivo en Forma, o la liga no es correcta."
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

export const b64url = (s) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
