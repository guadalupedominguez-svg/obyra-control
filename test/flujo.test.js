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
  envio: (await import("../api/envio.js")).default,
  carpetas: (await import("../api/carpetas.js")).default,
  obra: (await import("../api/obra.js")).default,
};

// ---- Cliente HTTP simulado con cookies por usuario ----
function client() {
  let cookie = "";
  return async function call(name, body, query) {
    const req = { method: body ? "POST" : "GET", headers: { cookie, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" }, body, query: query || {} };
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

const sup = client();
test("el contratista actualiza su avance: se aplica de inmediato y queda sin validar", async () => {
  const r = await copresa("piezas", { action: "reportar", guids: [G(1), G(2), G(3)], estatus: "Terminado", comentario: "Listo" });
  assert.equal(r.status, 200);
  assert.equal(r.json.actualizadas, 2);
  assert.equal(r.json.omitidas, 1); // la de AD-001
  assert.equal(r.json.avance[G(1)].estatus, "Terminado"); // directo, sin «Por aprobar»
  assert.equal(r.json.avance[G(1)].pend, undefined);
  assert.equal(r.json.avance[G(1)].porValidar.por, "Copresa");
  assert.equal((await copresa("piezas", { action: "reportar", guids: [G(1)], estatus: "Estimado" })).status, 400); // Estimado sale del generador
  assert.equal((await copresa("piezas", { action: "validar", guids: [G(1)] })).status, 403);
});

test("el residente valida el avance o lo rechaza (queda En ejecución)", async () => {
  assert.equal((await resi("piezas", { action: "rechazar", guids: [G(2)] })).status, 400);
  let r = await resi("piezas", { action: "rechazar", guids: [G(2)], comentario: "Falta aplanado" });
  assert.equal(r.json.avance[G(2)].rechazo.motivo, "Falta aplanado");
  assert.equal(r.json.avance[G(2)].estatus, "En ejecución"); // lo rechazado queda En ejecución
  assert.equal(r.json.avance[G(2)].pct, 0);
  assert.equal(r.json.avance[G(2)].porValidar, undefined);
  r = await resi("piezas", { action: "validar", guids: [G(1)] });
  assert.equal(r.json.avance[G(1)].estatus, "Terminado");
  assert.equal(r.json.avance[G(1)].validado.por, "Residente");
  assert.equal(r.json.avance[G(1)].porValidar, undefined);
});

test("generador: contratista envía, residente valida, superintendente aprueba o regresa", async () => {
  await admin("users", { action: "save", email: "sup@obra.mx", nombre: "Super", rol: "superintendente", activo: true, password: "Super-123456" });
  assert.equal((await sup("session", { action: "login", email: "sup@obra.mx", password: "Super-123456" })).status, 200);
  // Lo terminado y validado sí; lo demás no.
  await copresa("piezas", { action: "reportar", guids: [G(2)], estatus: "Terminado" }); // sin validar
  let r = await copresa("piezas", { action: "enviar", guids: [G(1), G(2)], estimacion: "ad-003" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.actualizadas, 1);
  assert.equal(r.json.avance[G(1)].pend.etapa, "residente");
  assert.equal(r.json.avance[G(1)].pend.estimacion, "AD-003");
  assert.equal((await resi("piezas", { action: "enviar", guids: [G(1)], estimacion: "x" })).status, 403);
  // El superintendente aún no la ve: primero el residente.
  r = await sup("piezas", { action: "aprobar", guids: [G(1)] });
  assert.equal(r.json.actualizadas, 0);
  assert.equal((await sup("piezas", { action: "gen-validar", guids: [G(1)] })).status, 403);
  assert.equal((await resi("piezas", { action: "gen-regresar", guids: [G(1)] })).status, 400); // pide motivo
  r = await resi("piezas", { action: "gen-validar", guids: [G(1)] });
  assert.equal(r.json.avance[G(1)].pend.etapa, "superintendente");
  assert.equal(r.json.avance[G(1)].pend.validadoPor, "Residente");
  assert.equal((await resi("piezas", { action: "aprobar", guids: [G(1)] })).status, 403);
  // El superintendente lo regresa: vuelve a Terminado.
  r = await sup("piezas", { action: "regresar", guids: [G(1)], comentario: "Revisar cantidades" });
  assert.equal(r.json.avance[G(1)].estatus, "Terminado");
  assert.equal(r.json.avance[G(1)].pend, undefined);
  assert.equal(r.json.avance[G(1)].rechazo.motivo, "Revisar cantidades");
  // Se vuelve a enviar y ahora sí se aprueba: Estimado.
  await copresa("piezas", { action: "enviar", guids: [G(1)], estimacion: "AD-003" });
  await resi("piezas", { action: "gen-validar", guids: [G(1)] });
  r = await sup("piezas", { action: "aprobar", guids: [G(1)] });
  assert.equal(r.json.avance[G(1)].estatus, "Estimado");
  assert.equal(r.json.avance[G(1)].estimacion, "AD-003");
  r = await copresa("piezas", { action: "reportar", guids: [G(1)], estatus: "En ejecución", pct: 50 });
  assert.equal(r.json.actualizadas, 0); // ya estimada: no se puede reabrir
  const h = (await resi("piezas")).json.avance[G(1)].hist.map((e) => e.accion);
  assert.deepEqual(h, ["reporta", "valida", "envia", "valida-generador", "regresa", "envia", "valida-generador", "estima"]);
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

test("solo el contratista reporta; el administrador tampoco valida", async () => {
  assert.equal((await admin("piezas", { action: "reportar", guids: [G(3)], estatus: "En ejecución", pct: 30 })).status, 403);
  assert.equal((await resi("piezas", { action: "reportar", guids: [G(3)], estatus: "En ejecución", pct: 30 })).status, 403);
  assert.equal((await resi("session")).json.permisos.reportar, false);
  let r = await otro("piezas", { action: "reportar", guids: [G(3)], estatus: "En ejecución", pct: 30 });
  assert.equal(r.json.avance[G(3)].estatus, "En ejecución");
  assert.equal(r.json.avance[G(3)].pct, 30);
  assert.equal((await admin("piezas", { action: "validar", guids: [G(3)] })).status, 403);
  const s = await admin("session");
  assert.equal(s.json.permisos.aprobar, false);
  r = await resi("piezas", { action: "validar", guids: [G(3)] });
  assert.equal(r.json.avance[G(3)].validado.por, "Residente");
});

test("el envío a Forma queda en la bitácora", async () => {
  db.set("ctrl:obra", JSON.stringify({ nombre: "Obra",
    carpeta: { projectId: "b.p", folderUrn: "urn:adsk.wipprod:fs.folder:co.x", nombre: "05 Generadores" },
    carpetas: { "AD-001": { projectId: "b.p", folderUrn: "urn:adsk.wipprod:fs.folder:co.ad1", nombre: "Generadores AD-001" } } }));
  let carpetaUsada = null, tokenUsado = null;
  const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
  globalThis.fetch = async (url, opt = {}) => {
    if (url.endsWith("/storage")) {
      carpetaUsada = JSON.parse(opt.body).data.relationships.target.data.id; tokenUsado = opt.headers.Authorization;
      return ok({ data: { id: "urn:adsk.objects:os.object:wip.dm.prod/a.xlsx" } });
    }
    if (url.includes("signeds3upload")) return ok({ uploadKey: "K", urls: ["https://s3/put"] });
    if (url === "https://s3/put") return new Response("", { status: 200 });
    if (url.includes("/contents?")) return ok({ data: [] });
    if (url.endsWith("/items")) return ok({ data: { id: "i" } });
    throw new Error("no esperado " + url + " " + (opt.method || "GET"));
  };
  const xlsx = Buffer.from("PK\u0003\u0004 prueba").toString("base64");
  assert.equal((await otro("envio", { nombre: "G.xlsx", base64: xlsx })).status, 403); // contratista no envía
  const sinCuenta = await resi("envio", { nombre: "G.xlsx", base64: xlsx, contratista: "AD-001" });
  assert.equal(sinCuenta.status, 409); // el residente no ha conectado su cuenta de Autodesk
  assert.match(sinCuenta.json.error, /tu cuenta de Autodesk/);
  db.set("ctrl:forma:cuenta:res@obra.mx", JSON.stringify({ access: "tok-residente", refresh: "r", exp: Date.now() + 3_600_000 }));
  const r = await resi("envio", { nombre: "Generador_AD-001_AD-004_2026-11-11.xlsx", base64: xlsx, contratista: "ad-001", estimacion: "ad-004", piezas: 2, area: 13 });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.carpeta, "Generadores AD-001"); // carpeta del contratista
  assert.equal(carpetaUsada, "urn:adsk.wipprod:fs.folder:co.ad1");
  assert.equal(tokenUsado, "Bearer tok-residente"); // con la cuenta del residente
  const lista = (await resi("envio")).json.envios;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].contratista, "AD-001");
  assert.equal(lista[0].estimacion, "AD-004");
  assert.equal(lista[0].ultimo.por, "Residente");
  assert.equal((await otro("envio")).json.envios.length, 1); // AD-001 ve el suyo
});

test("el residente elige la carpeta de un contratista; la general solo el admin", async () => {
  const o = JSON.parse(db.get("ctrl:obra")); o.projectId = "b.p"; db.set("ctrl:obra", JSON.stringify(o));
  globalThis.fetch = async (url) => {
    if (url.includes("/folders/urn%3Aadsk.wipprod%3Afs.folder%3Aco.nueva")) return new Response(JSON.stringify({ data: { attributes: { displayName: "Gen FAMEP" } } }), { status: 200 });
    throw new Error("no esperado " + url);
  };
  const F = "urn:adsk.wipprod:fs.folder:co.nueva";
  assert.equal((await resi("carpetas", { contratista: "", folderUrn: F })).status, 403);
  assert.equal((await otro("carpetas", { contratista: "AD-001", folderUrn: F })).status, 403); // contratista no
  const r = await resi("carpetas", { contratista: "famep", folderUrn: F, ruta: [{ id: "urn:adsk.wipprod:fs.folder:co.pf", nombre: "Project Files" }, { id: F, nombre: "Gen FAMEP" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const guardada = JSON.parse(db.get("ctrl:obra")).carpetas.FAMEP;
  assert.equal(guardada.nombre, "Gen FAMEP");
  assert.equal(guardada.ruta.length, 2);
  assert.ok(JSON.parse(db.get("ctrl:obra")).carpetas["AD-001"]); // no borró las demás
});

test("al abrir, el administrador ve si hay una versión más nueva del IFC en Forma", async () => {
  const o = JSON.parse(db.get("ctrl:obra"));
  Object.assign(o, { lineage: "urn:adsk.wipprod:dm.lineage:ifc", versionUrn: "urn:v1", versionNumber: 1, fileName: "a.ifc" });
  db.set("ctrl:obra", JSON.stringify(o));
  db.set("ctrl:forma:data", JSON.stringify({ access: "tok", refresh: "r", exp: Date.now() + 3_600_000, scope: "data:read" }));
  db.set("ctrl:forma:view", JSON.stringify({ access: "tok", refresh: "r", exp: Date.now() + 3_600_000, scope: "viewables:read" }));
  let tip = "urn:v2";
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { relationships: { tip: { data: { id: tip } } }, attributes: {} }, included: [{ id: tip, attributes: { versionNumber: tip === "urn:v2" ? 2 : 1, displayName: "a.ifc" } }] }), { status: 200 });
  let r = await admin("obra", undefined, { revisar: "1" });
  assert.deepEqual(r.json.nueva, { version: 2, archivo: "a.ifc", fecha: null });
  assert.equal((await resi("obra", undefined, { revisar: "1" })).json.nueva, undefined); // solo el administrador
  tip = "urn:v1";
  r = await admin("obra", undefined, { revisar: "1" });
  assert.equal(r.json.nueva, undefined); // ya está en la última
});

test("contraseña olvidada: el admin la restablece, se ve solo una vez y el usuario debe cambiarla", async () => {
  const yo = client();
  await admin("users", { action: "save", email: "olvido@obra.mx", nombre: "Olvido Pérez", rol: "residente", activo: true, password: "Inicial-12345" });
  let lista = (await admin("users")).json.users;
  let u = lista.find((x) => x.email === "olvido@obra.mx");
  assert.equal(u.pw.temporal, true); // la que pone el admin es temporal
  assert.ok(!JSON.stringify(lista).includes("Inicial-12345")); // nunca se devuelve la contraseña
  assert.equal((await yo("session", { action: "login", email: "olvido@obra.mx", password: "Inicial-12345" })).status, 200);
  assert.equal((await yo("session")).json.user.cambiarPw, true);
  // Solo el admin restablece.
  assert.equal((await resi("users", { action: "reset", email: "olvido@obra.mx" })).status, 403);
  const r = await admin("users", { action: "reset", email: "olvido@obra.mx" });
  assert.equal(r.status, 200);
  assert.match(r.json.temporal, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  // La sesión anterior se cerró y la contraseña vieja ya no sirve.
  assert.equal((await yo("session")).json.loggedIn, false);
  assert.equal((await yo("session", { action: "login", email: "olvido@obra.mx", password: "Inicial-12345" })).status, 401);
  assert.equal((await yo("session", { action: "login", email: "olvido@obra.mx", password: r.json.temporal })).status, 200);
  assert.equal((await yo("session", { action: "password", actual: r.json.temporal, nueva: r.json.temporal })).status, 400);
  assert.equal((await yo("session", { action: "password", actual: r.json.temporal, nueva: "Mi-propia-2026" })).status, 200);
  assert.equal((await yo("session")).json.user.cambiarPw, false);
  u = (await admin("users")).json.users.find((x) => x.email === "olvido@obra.mx");
  assert.equal(u.pw.temporal, false); assert.equal(u.pw.por, "Olvido Pérez");
  assert.equal((await admin("users", { action: "reset", email: "admin@obra.mx" })).status, 400); // la propia, no
});

test("usuario inactivo: no entra hasta que el admin lo activa", async () => {
  const yo = client();
  await admin("users", { action: "save", email: "inact@obra.mx", nombre: "Lalo", rol: "residente", activo: false, password: "Inactivo-1234" });
  assert.equal((await yo("session", { action: "login", email: "inact@obra.mx", password: "Inactivo-1234" })).status, 401);
  assert.equal((await resi("users", { action: "activo", email: "inact@obra.mx", activo: true })).status, 403);
  const r = await admin("users", { action: "activo", email: "inact@obra.mx", activo: true });
  assert.equal(r.status, 200); assert.equal(r.json.user.activo, true);
  assert.equal((await yo("session", { action: "login", email: "inact@obra.mx", password: "Inactivo-1234" })).status, 200);
  assert.equal((await admin("users", { action: "activo", email: "admin@obra.mx", activo: false })).status, 400);
});

test("lo rechazado antes de la regla queda En ejecución al leer las piezas", async () => {
  const { setJson: _s } = await import("../lib/store.js");
  const store = await import("../lib/store.js");
  await store.hsetJson(store.key("avance"), { [G(9)]: { estatus: "Planeado", pct: 0, rechazo: { motivo: "x", por: "R", at: "2026-11-18T00:00:00Z" } } });
  await store.cmd(["DEL", store.key("mig", "rechazo-ejecucion")]);
  const r = await admin("piezas");
  assert.equal(r.status, 200);
  assert.equal((await store.hgetJson(store.key("avance"), G(9))).estatus, "En ejecución");
});
