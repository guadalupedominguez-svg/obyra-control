// Conexión con Forma (una sola vez, la hace un administrador) y token de visualización.
//   GET /api/forma/connect    (admin) inicia la conexión con Autodesk
//   GET /api/forma/callback   recibe cada autorización; pide primero data:read y luego viewables:read
//   GET /api/forma/token      token de solo visualización para el visor (cualquier usuario con sesión)
//   GET /api/forma/cuenta     (quien estima) conecta su propia cuenta de Autodesk para enviar generadores
import crypto from "node:crypto";
import { route, HttpError } from "../../lib/http.js";
import { parseCookies, setCookie } from "../../lib/session.js";
import { currentUser, requireUser, can } from "../../lib/users.js";
import { CHAINS, callbackUrl, tokenRequest, saveChain, getToken, cuentaChain } from "../../lib/forma.js";

function authorize(req, res, chain, by) {
  const state = chain + "." + crypto.randomBytes(16).toString("hex");
  setCookie(res, "ctrl_forma", state + "." + Buffer.from(by).toString("base64url"), 600);
  const url = new URL(process.env.APS_AUTHORIZE_URL || "https://developer.api.autodesk.com/authentication/v2/authorize");
  const params = {
    response_type: "code",
    client_id: process.env.APS_CLIENT_ID || "",
    redirect_uri: callbackUrl(req),
    scope: CHAINS[chain],
    state,
  };
  if (chain === "data" || chain === "cuenta") params.prompt = "login"; // que elija con qué cuenta de Autodesk conecta
  url.search = new URLSearchParams(params).toString();
  res.redirect(302, url.toString());
}

async function connect(req, res) {
  const me = await currentUser(req);
  if (!me || me.rol !== "admin") { res.redirect(302, "/?forma=sin-permiso"); return; }
  if (!process.env.APS_CLIENT_ID) throw new HttpError(500, "Falta APS_CLIENT_ID en las variables del servidor.");
  authorize(req, res, "data", me.email);
}

async function cuenta(req, res) {
  const me = await currentUser(req);
  if (!me || !can(me, "estimar")) { res.redirect(302, "/?forma=sin-permiso"); return; }
  if (!process.env.APS_CLIENT_ID) throw new HttpError(500, "Falta APS_CLIENT_ID en las variables del servidor.");
  authorize(req, res, "cuenta", me.email);
}

async function callback(req, res) {
  const { code, state, error } = req.query || {};
  const cookie = parseCookies(req).ctrl_forma || "";
  setCookie(res, "ctrl_forma", "", 0);
  const [chain, rnd, byB64] = cookie.split(".");
  const by = byB64 ? Buffer.from(byB64, "base64url").toString("utf8") : "";
  const me = await currentUser(req);
  if (error || !code) { res.redirect(302, "/?forma=cancelado"); return; }
  const permitido = me && me.email === by && (chain === "cuenta" ? can(me, "estimar") : me.rol === "admin");
  if (!chain || !CHAINS[chain] || state !== chain + "." + rnd || !permitido) {
    res.redirect(302, "/?forma=invalido");
    return;
  }
  try {
    const tokens = await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: callbackUrl(req) });
    await saveChain(chain === "cuenta" ? cuentaChain(me.email) : chain, tokens, me.email);
  } catch (e) {
    console.error("forma callback", e.message, JSON.stringify(e.detail || ""));
    res.redirect(302, "/?forma=error");
    return;
  }
  // La primera autorización (data:read) encadena la segunda (viewables:read); Autodesk ya no pide contraseña.
  if (chain === "data") { authorize(req, res, "view", me.email); return; }
  if (chain === "cuenta") { res.redirect(302, "/?forma=cuenta"); return; }
  res.redirect(302, "/?forma=conectado");
}

const token = route(["GET"], async (req, res) => {
  await requireUser(req);
  const t = await getToken("view");
  res.status(200).json({ access_token: t.access, expires_in: Math.max(60, Math.floor((t.exp - Date.now()) / 1000) - 60) });
});

const pages = route(["GET"], async (req, res) => {
  const action = (req.query && req.query.action) || "";
  if (action === "connect") return connect(req, res);
  if (action === "callback") return callback(req, res);
  if (action === "cuenta") return cuenta(req, res);
  res.status(404).json({ error: "No encontrado." });
});

export default async function handler(req, res) {
  if (req.query && req.query.action === "token") return token(req, res);
  return pages(req, res);
}
