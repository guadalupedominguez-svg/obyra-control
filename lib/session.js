// Sesión cifrada en cookie (AES-256-GCM). Guarda quién inició sesión (usuario, rol y contratista).
import crypto from "node:crypto";

const NAME = "ctrl_sess";

function key() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("Falta SESSION_SECRET en las variables del servidor (mínimo 32 caracteres).");
  return crypto.createHash("sha256").update(s).digest();
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString("base64url");
}

export function unseal(str) {
  try {
    const b = Buffer.from(str, "base64url");
    const d = crypto.createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(/;\s*/).forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

export function setCookie(res, name, value, maxAgeSeconds) {
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(`${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`);
  res.setHeader("Set-Cookie", list);
}

export function getSession(req) {
  const c = parseCookies(req)[NAME];
  return c ? unseal(c) : null;
}

export function saveSession(res, s) {
  setCookie(res, NAME, seal(s), 60 * 60 * 12);
}

export function clearSession(res) {
  setCookie(res, NAME, "", 0);
}
