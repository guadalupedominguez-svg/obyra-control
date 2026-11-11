// Usuarios con contraseña propia y rol. Se guardan en el hash "ctrl:users" (campo = correo).
import { HttpError } from "./http.js";
import { key, hgetJson, hgetallJson, hsetJson, hdel } from "./store.js";
import { getSession } from "./session.js";

export const ROLES = {
  admin: "Administrador",
  pm: "Project manager",
  superintendente: "Superintendente",
  residente: "Residente",
  admon: "Administración de obra",
  contratista: "Contratista",
};

// Qué puede hacer cada rol.
export const CAN = {
  reportar: ["contratista"], // el avance solo lo captura el contratista; los demás lo revisan
  aprobar: ["residente", "superintendente"],
  estimar: ["residente", "superintendente", "admon", "pm", "admin"],
  verTodo: ["residente", "superintendente", "admon", "pm", "admin"],
  administrar: ["admin"],
};
export const can = (user, what) => Boolean(user && CAN[what].includes(user.rol));

const USERS = () => key("users");
const ITER = 100000; // máximo que admite PBKDF2 en Cloudflare Workers

const b64 = (buf) => Buffer.from(buf).toString("base64");

async function derive(password, saltB64) {
  const mat = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: Buffer.from(saltB64, "base64"), iterations: ITER },
    mat,
    256,
  );
  return b64(bits);
}

export async function hashPassword(password) {
  const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await derive(password, salt), iter: ITER };
}

export async function verifyPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const h = await derive(password, rec.salt);
  const a = Buffer.from(h), b = Buffer.from(rec.hash);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export function normEmail(v) {
  const e = String(v || "").trim().toLowerCase();
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(e)) throw new HttpError(400, "Escribe un correo válido.");
  return e;
}

export function checkPassword(p) {
  const s = String(p || "");
  if (s.length < 10) throw new HttpError(400, "La contraseña debe tener al menos 10 caracteres.");
  if (s.length > 200) throw new HttpError(400, "La contraseña es demasiado larga.");
  return s;
}

// Lo que se puede mostrar de un usuario (sin la contraseña).
export const publicUser = (email, u) => ({
  email,
  nombre: u.nombre,
  rol: u.rol,
  contratista: u.contratista || "",
  activo: u.activo !== false,
  creado: u.creado || null,
});

export const getUser = (email) => hgetJson(USERS(), email);
export const allUsers = () => hgetallJson(USERS());
export const saveUser = (email, u) => hsetJson(USERS(), { [email]: u });
export const deleteUser = (email) => hdel(USERS(), email);

// Si todavía no hay usuarios, crea el primer administrador con ADMIN_EMAIL y ADMIN_PASSWORD.
export async function ensureBootstrapAdmin() {
  const all = await allUsers();
  if (Object.keys(all).length) return false;
  const email = process.env.ADMIN_EMAIL, pass = process.env.ADMIN_PASSWORD;
  if (!email || !pass) return false;
  const e = normEmail(email);
  await saveUser(e, { nombre: "Administrador", rol: "admin", activo: true, creado: new Date().toISOString(), pw: await hashPassword(checkPassword(pass)) });
  return true;
}

// Usuario de la sesión, comprobado contra la base (si lo desactivan o le cambian el rol, aplica de inmediato).
export async function currentUser(req) {
  const s = getSession(req);
  if (!s || !s.email || !s.exp || Date.now() > s.exp) return null;
  const u = await getUser(s.email);
  if (!u || u.activo === false) return null;
  if ((u.pwv || 0) !== (s.pwv || 0)) return null; // la contraseña cambió: cierra sesiones anteriores
  return { email: s.email, nombre: u.nombre, rol: u.rol, contratista: u.contratista || "" };
}

export async function requireUser(req, what) {
  const u = await currentUser(req);
  if (!u) throw new HttpError(401, "Inicia sesión para continuar.");
  if (what && !can(u, what)) throw new HttpError(403, "Tu rol no tiene permiso para esta acción.");
  return u;
}
