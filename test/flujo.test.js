// Pruebas del flujo completo con una base Redis en memoria:
// inicio de sesión, usuarios, catálogo de piezas, reporte del contratista, aprobación, rechazo y estimación.
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { _setStoreForTests } from "../lib/store.js";

process.env.SESSION_SECRET = "x".repeat(40);
process.env.KV_REST_API_URL = "http://memoria";
process.env.KV_REST_API_TOKEN = "t";
process.env.ADMIN_EMAIL = "admin@obra.mx";
process.env.ADMIN_PASSWORD = "Admin-12345";

// ---- Redis en memoria (solo los comandos que usa la app) ----
const db = new Map();
_setStoreForTests(async ([op, k, ...a]) => {
  const h = () => { if (!db.has(k)) db.set(k, new Map()); return db.get(k); };
  switch (op) {
    case "GET": return db.has(k) ? db.get(k) : null;
    case "SET": {
      if (a.includes("NX") && db.has(k)) return null;
      db.set(k, a[0]); return "OK";
    }
    case "DEL": return db.delete(k) ? 1 : 0;
    case "INCR": { const n = Number(db.get(k) || 0) + 1; db.set(k, String(n)); return n; }
    case "EXPIRE": return 1;
    case "HGET": return db.has(k) ? db.get(k).get(a[0]) ?? null : null;
    case "HSET": { const m = h(); for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]); return a.length / 2; }
    case "HDEL": return db.has(k) && db.get(k).delete(a[0]) ? 1 : 0;
    case "HGETALL": return db.has(k) ? [...db.get(k)].flat() : [];
    case "HMGET": return a.map((f) => (db.has(k) ? db.get(k).get(f) ?? null : null));
    default: throw new Error("Comando no simulado: " + op);
  }
});

const handlers = {
  session: (await import("../api/session.js")).default,
  users: (await import("../api/users.js")).default,
  piezas: (await import("../api/piezas.js")).default,
};

// ---- Cliente HTTP simulado con cookies por usuario ----
function client() {
  let cookie = "";
  return async function call(name, body) {
    const req = { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body };
    const out = { status: 200, json: null, headers: {} };
    const res = {
      headersSent: false,
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      getHeader(k) { return out.headers[k.toLowerCase()]; },
      status(n) { out.status = n; return res; },
      json(o) { out.json = o; res.headersSent = true; return res; },
      end() { res.headersSent = true; },
    };
    await handlers[name](req, res);
    const sc = out.headers["set-cookie"];
    if (sc) cookie = [].concat(sc).map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
    return out;
  };
}

const G = (n) => ("0".repeat(21) + n).slice(-22); // GlobalId de prueba (22 caracteres)
const admin = client(), resi = client(), copresa = client(), otro = client();

before(async () => {
  const r = await admin("session", { action: "login", email: "Admin@Obra.mx", password: "Admin-12345" });
  assert.equal(r.status, 200);
});

test("el admin inicial entra y ve sus permisos", async () => {
  const r = await admin("session");
  assert.equal(r.json.loggedIn, true);
  assert.equal(r.json.user.rol, "admin");
  assert.equal(r.json.permisos.administrar, true);
});

test("contraseña incorrecta no entra", async () => {
  const r = await client()("session", { action: "login", email: "admin@obra.mx", password: "mala-contrasena" });
  assert.equal(r.status, 401);
});

test("el admin crea usuarios; el contratista requiere empresa", async () => {
  let r = await admin("users", { action: "save", email: "res@obra.mx", nombre: "Residente", rol: "residente", activo: true, password: "Residente-123" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await admin("users", { action: "save", email: "c@copresa.mx", nombre: "Copresa", rol: "contratista", activo: true, password: "Copresa-1234" });
  assert.equal(r.status, 400);
  r = await admin("users", { action: "save", email: "c@copresa.mx", nombre: "Copresa", rol: "contratista", contratista: "copresa", activo: true, password: "Copresa-1234" });
  assert.equal(r.status, 200);
  r = await admin("users", { action: "save", email: "o@otro.mx", nombre: "Otro", rol: "contratista", contratista: "AD-001", activo: true, password: "Otro-123456" });
  assert.equal(r.status, 200);
  assert.equal((await resi("session", { action: "login", email: "res@obra.mx", password: "Residente-123" })).status, 200);
  assert.equal((await copresa("session", { action: "login", email: "c@copresa.mx", password: "Copresa-1234" })).status, 200);
  assert.equal((await otro("session", { action: "login", email: "o@otro.mx", password: "Otro-123456" })).status, 200);
});

test("solo el admin administra usuarios", async () => {
  const r = await resi("users");
  assert.equal(r.status, 403);
});

test("el admin carga el catálogo; cada contratista solo ve lo suyo", async () => {
  const piezas = [
    { guid: G(1), marca: "MP-01", contratista: "COPRESA", clave: "MU-01", area: 12.5, volumen: 1.875 },
    { guid: G(2), marca: "MP-02", contratista: "COPRESA", clave: "MU-01", area: 10, volumen: 1.5 },
    { guid: G(3), marca: "MP-03", contratista: "AD-001", clave: "MU-02", area: 8 },
    { guid: "corto", marca: "X" },
  ];
  assert.equal((await resi("piezas", { action: "catalogo", version: "3", piezas })).status, 403);
  const r = await admin("piezas", { action: "catalogo", version: "3", piezas });
  assert.equal(r.json.total, 3);
  const c = await copresa("piezas");
  assert.deepEqual(Object.keys(c.json.piezas).sort(), [G(1), G(2)]);
  const v = await resi("piezas");
  assert.equal(Object.keys(v.json.piezas).length, 3);
});

test("el contratista reporta lo suyo y queda por aprobar", async () => {
  const r = await copresa("piezas", { action: "reportar", guids: [G(1), G(2), G(3)], estatus: "Terminado", comentario: "Listo" });
  assert.equal(r.status, 200);
  assert.equal(r.json.actualizadas, 2);
  assert.equal(r.json.omitidas, 1); // la de AD-001
  assert.equal(r.json.avance[G(1)].pend.estatus, "Terminado");
  assert.equal(r.json.avance[G(1)].estatus, "Planeado");
  assert.equal((await copresa("piezas", { action: "reportar", guids: [G(1)], estatus: "Liberado" })).status, 400);
  assert.equal((await copresa("piezas", { action: "aprobar", guids: [G(1)] })).status, 403);
});

test("rechazar exige motivo; aprobar aplica el estatus", async () => {
  assert.equal((await resi("piezas", { action: "rechazar", guids: [G(2)] })).status, 400);
  let r = await resi("piezas", { action: "rechazar", guids: [G(2)], comentario: "Falta aplanado" });
  assert.equal(r.json.avance[G(2)].rechazo.motivo, "Falta aplanado");
  assert.equal(r.json.avance[G(2)].estatus, "En ejecución"); // rechazado: regresa a En ejecución
  assert.equal(r.json.avance[G(2)].pend, undefined);
  r = await resi("piezas", { action: "aprobar", guids: [G(1)] });
  assert.equal(r.json.avance[G(1)].estatus, "Terminado");
  assert.equal(r.json.avance[G(1)].pct, 100);
  assert.equal(r.json.avance[G(1)].aprobado.por, "Residente");
});

test("solo lo terminado y aprobado pasa a estimación, una sola vez", async () => {
  assert.equal((await copresa("piezas", { action: "estimar", guids: [G(1)], estimacion: "x" })).status, 403);
  let r = await resi("piezas", { action: "estimar", guids: [G(1), G(2)], estimacion: "ad-003" });
  assert.equal(r.json.actualizadas, 1);
  assert.equal(r.json.avance[G(1)].estatus, "Estimado");
  assert.equal(r.json.avance[G(1)].estimacion, "AD-003");
  r = await copresa("piezas", { action: "reportar", guids: [G(1)], estatus: "En ejecución", pct: 50 });
  assert.equal(r.json.actualizadas, 0); // ya estimada: no se puede reabrir
  const h = (await resi("piezas")).json.avance[G(1)].hist.map((e) => e.accion);
  assert.deepEqual(h, ["reporta", "aprueba", "estima"]);
});

test("cambiar la contraseña cierra las otras sesiones", async () => {
  const otraSesion = client();
  await otraSesion("session", { action: "login", email: "o@otro.mx", password: "Otro-123456" });
  const r = await otro("session", { action: "password", actual: "Otro-123456", nueva: "Nueva-clave-99" });
  assert.equal(r.status, 200);
  assert.equal((await otro("session")).json.loggedIn, true);
  assert.equal((await otraSesion("session")).json.loggedIn, false);
});

test("un usuario desactivado pierde el acceso de inmediato", async () => {
  await admin("users", { action: "save", email: "c@copresa.mx", nombre: "Copresa", rol: "contratista", contratista: "COPRESA", activo: false });
  assert.equal((await copresa("piezas")).status, 401);
});

test("las escrituras sin JSON se rechazan", async () => {
  const req = { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "a=1" };
  let status = 0;
  const res = { setHeader() {}, getHeader() {}, status(n) { status = n; return res; }, json() { return res; } };
  await handlers.piezas(req, res);
  assert.equal(status, 415);
});

test("solo el contratista reporta; el administrador tampoco aprueba", async () => {
  assert.equal((await admin("piezas", { action: "reportar", guids: [G(3)], estatus: "En ejecución", pct: 30 })).status, 403);
  assert.equal((await resi("piezas", { action: "reportar", guids: [G(3)], estatus: "En ejecución", pct: 30 })).status, 403);
  assert.equal((await resi("session")).json.permisos.reportar, false);
  let r = await otro("piezas", { action: "reportar", guids: [G(3)], estatus: "En ejecución", pct: 30 });
  assert.equal(r.json.avance[G(3)].pend.estatus, "En ejecución");
  assert.equal((await admin("piezas", { action: "aprobar", guids: [G(3)] })).status, 403);
  const s = await admin("session");
  assert.equal(s.json.permisos.aprobar, false);
  r = await resi("piezas", { action: "aprobar", guids: [G(3)] });
  assert.equal(r.json.avance[G(3)].estatus, "En ejecución");
});

test("desde Piezas el residente solo libera o rechaza; rechazar regresa a En ejecución", async () => {
  const cat = await admin("piezas", { action: "catalogo", version: "4", piezas: [
    { guid: G(1), marca: "MP-01", contratista: "COPRESA", clave: "MU-01", area: 12.5 },
    { guid: G(3), marca: "MP-03", contratista: "AD-001", clave: "MU-02", area: 8 },
    { guid: G(4), marca: "MP-04", contratista: "AD-001", clave: "MU-02", area: 5 },
  ] });
  assert.equal(cat.status, 200);
  assert.equal((await resi("piezas", { action: "revisar", guids: [G(4)], decision: "Terminado" })).status, 400);
  assert.equal((await otro("piezas", { action: "revisar", guids: [G(4)], decision: "Liberado" })).status, 403);
  let r = await resi("piezas", { action: "revisar", guids: [G(4), G(1)], decision: "Liberado" });
  assert.equal(r.json.actualizadas, 1); // G(1) ya está estimada
  assert.equal(r.json.avance[G(4)].estatus, "Liberado");
  assert.equal((await resi("piezas", { action: "revisar", guids: [G(4)], decision: "Rechazado" })).status, 400); // sin indicaciones
  await otro("piezas", { action: "reportar", guids: [G(4)], estatus: "Terminado" });
  r = await resi("piezas", { action: "revisar", guids: [G(4)], decision: "Rechazado", comentario: "Falta sellador" });
  const a = r.json.avance[G(4)];
  assert.equal(a.estatus, "En ejecución");
  assert.equal(a.pend, undefined);
  assert.equal(a.rechazo.motivo, "Falta sellador");
});
