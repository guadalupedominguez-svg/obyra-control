// Base de datos en Upstash Redis (REST). Todas las llaves llevan el prefijo "ctrl:" para que
// OBYRA Control pueda compartir la misma base que OBYRA sin chocar con sus llaves ("visor:…").
import { HttpError } from "./http.js";

const URL_ = () => process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = () => process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const storeConfigured = () => Boolean(URL_() && TOKEN());
export const key = (...parts) => "ctrl:" + parts.join(":");

// Para pruebas: permite sustituir el cliente por uno en memoria.
let override = null;
export function _setStoreForTests(fn) { override = fn; }

export async function cmd(args) {
  if (override) return override(args);
  if (!storeConfigured()) throw new HttpError(500, "Falta configurar la base de datos (KV_REST_API_URL y KV_REST_API_TOKEN).");
  const r = await fetch(URL_(), {
    method: "POST",
    headers: { Authorization: "Bearer " + TOKEN(), "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new HttpError(500, "Base de datos: " + (j.error || r.status));
  return j.result;
}

export async function getJson(k, fallback = null) {
  const v = await cmd(["GET", k]);
  return v ? JSON.parse(v) : fallback;
}
export const setJson = (k, v) => cmd(["SET", k, JSON.stringify(v)]);

export async function hgetJson(k, field) {
  const v = await cmd(["HGET", k, field]);
  return v ? JSON.parse(v) : null;
}
export async function hgetallJson(k) {
  const flat = (await cmd(["HGETALL", k])) || [];
  const out = {};
  // Upstash devuelve [campo, valor, campo, valor, …]
  for (let i = 0; i + 1 < flat.length; i += 2) out[flat[i]] = JSON.parse(flat[i + 1]);
  return out;
}
export async function hmgetJson(k, fields) {
  if (!fields.length) return [];
  const vals = (await cmd(["HMGET", k, ...fields])) || [];
  return vals.map((v) => (v ? JSON.parse(v) : null));
}
export async function hsetJson(k, entries) {
  const args = ["HSET", k];
  for (const [f, v] of Object.entries(entries)) args.push(f, JSON.stringify(v));
  if (args.length > 2) await cmd(args);
}
export const hdel = (k, field) => cmd(["HDEL", k, field]);

// Bloqueo simple: devuelve true si se obtuvo.
export async function lock(k, seconds) {
  return (await cmd(["SET", k, "1", "NX", "EX", String(seconds)])) === "OK";
}
export const unlock = (k) => cmd(["DEL", k]);

// Contador con vencimiento (para limitar intentos de inicio de sesión).
export async function hit(k, seconds) {
  const n = await cmd(["INCR", k]);
  if (Number(n) === 1) await cmd(["EXPIRE", k, String(seconds)]);
  return Number(n);
}
