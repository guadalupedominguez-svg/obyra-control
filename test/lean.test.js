// Módulo Lean con una base Redis en memoria: look-ahead, restricciones, plan semanal, calificación en dos pasos y sesión pull.
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
  lean: (await import("../api/lean.js")).default,
  carpetas: (await import("../api/carpetas.js")).default,
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

const admin = client(), pm = client(), resi = client(), sup = client(), copresa = client();

before(async () => {
  assert.equal((await admin("session", { action: "login", email: "admin@obra.mx", password: "Admin-12345" })).status, 200);
  const alta = async (email, nombre, rol, extra = {}) => assert.equal((await admin("users", { action: "save", email, nombre, rol, activo: true, password: "Clave-12345", ...extra })).status, 200);
  await alta("pm@obra.mx", "Mariana", "pm");
  await alta("res@obra.mx", "Residente", "residente");
  await alta("sup@obra.mx", "Super", "superintendente");
  await alta("c@copresa.mx", "Jorge", "contratista", { contratista: "COPRESA" });
  for (const [c, e] of [[pm, "pm@obra.mx"], [resi, "res@obra.mx"], [sup, "sup@obra.mx"], [copresa, "c@copresa.mx"]]) {
    assert.equal((await c("session", { action: "login", email: e, password: "Clave-12345" })).status, 200);
  }
});

let actId;
test("el PM configura y crea actividades; los demás no", async () => {
  let r = await pm("lean", { action: "config", modo: "takt", ubicaciones: ["Área 1", "Área 2"], meta: 85 });
  assert.equal(r.status, 200);
  assert.equal(r.json.config.modo, "takt");
  assert.equal((await resi("lean", { action: "config", meta: 50 })).status, 403);
  const act = { partida: "muros", contratista: "copresa", ubicacion: "Área 1", semanaIni: "2026-W46", semanaFin: "2026-W47" };
  assert.equal((await copresa("lean", { action: "act-guardar", act })).status, 403);
  assert.equal((await pm("lean", { action: "act-guardar", act: { ...act, semanaFin: "2026-W45" } })).status, 400);
  r = await pm("lean", { action: "act-guardar", act });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.actividad.partida, "MUROS");
  actId = r.json.actividad.id;
  const g = await copresa("lean");
  assert.equal(g.json.actividades.length, 1); // el contratista ve el look-ahead completo
  assert.equal(g.json.config.meta, 85);
});

test("restricciones: el contratista las levanta en lo suyo y se liberan", async () => {
  let r = await copresa("lean", { action: "restr-agregar", actId, texto: "Paneles en tránsito", tipo: "Material", responsable: "COPRESA" });
  assert.equal(r.status, 200);
  const rid = r.json.restriccion.id;
  r = await resi("lean", { action: "restr-liberar", actId, restrId: rid });
  assert.equal(r.json.actividad.restricciones[0].estado, "liberada");
});

test("plan semanal: lo establece el PM; califica el residente y valida el superintendente", async () => {
  assert.equal((await resi("lean", { action: "plan-agregar", semana: "2026-W46", actId, meta: "3 paneles" })).status, 403);
  let r = await pm("lean", { action: "plan-agregar", semana: "2026-W46", actId, meta: "3 paneles" });
  assert.equal(r.status, 200);
  assert.equal((await sup("lean", { action: "validar", semana: "2026-W46", actId, ok: true })).status, 409); // antes que el residente
  assert.equal((await pm("lean", { action: "calificar", semana: "2026-W46", actId, cumplido: true })).status, 403);
  assert.equal((await resi("lean", { action: "calificar", semana: "2026-W46", actId, cumplido: false })).status, 400); // falta causa
  r = await resi("lean", { action: "calificar", semana: "2026-W46", actId, cumplido: false, causa: "Material no disponible" });
  assert.equal(r.json.compromiso.res.cumplido, false);
  assert.equal((await sup("lean", { action: "validar", semana: "2026-W46", actId, ok: false })).status, 400); // regresar exige comentario
  r = await sup("lean", { action: "validar", semana: "2026-W46", actId, ok: false, comentario: "Sí llegaron 2 paneles, revisa" });
  assert.equal(r.json.compromiso.sup.estado, "regresado");
  r = await resi("lean", { action: "calificar", semana: "2026-W46", actId, cumplido: true });
  assert.equal(r.json.compromiso.sup, null); // vuelve a esperar al superintendente
  r = await sup("lean", { action: "validar", semana: "2026-W46", actId, ok: true });
  assert.equal(r.json.compromiso.sup.estado, "validado");
  assert.equal((await resi("lean", { action: "calificar", semana: "2026-W46", actId, cumplido: false, causa: "Clima" })).status, 409);
  assert.equal((await pm("lean", { action: "plan-quitar", semana: "2026-W46", actId })).status, 409);
});

test("sesión pull: el contratista mueve solo sus tarjetas y el PM las pasa al look-ahead", async () => {
  // Catálogo de piezas del modelo para ligar por marca.
  await admin("piezas", { action: "catalogo", version: "1", piezas: [{ guid: "0000000000000000000007", marca: "MP-07", contratista: "COPRESA" }, { guid: "0000000000000000000008", marca: "MP-08", contratista: "COPRESA" }] });
  let r = await pm("lean", { action: "hito-guardar", hito: { nombre: "Fachadas terminadas", fecha: "2026-12-18", alcance: "FACHADA NORTE, FACHADA ESTE" } });
  assert.deepEqual(r.json.hito.alcance, ["FACHADA NORTE", "FACHADA ESTE"]);
  const hitoId = r.json.hito.id;
  r = await copresa("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { contratista: "FAMEP", entregable: "Paneles norte", duracion: 8, inicio: "2026-11-12", necesita: "Grúa", ubicacion: "Área 2", partida: "muros", guids: ["0000000000000000000001", "malo"], marcas: "mp-08, mp-07, XX-99" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.tarjeta.contratista, "COPRESA"); // el contratista no puede poner otra empresa
  assert.deepEqual(r.json.tarjeta.marcas, ["MP-08", "MP-07", "XX-99"]);
  // Orden de ejecución: marcas en el orden escrito, luego las elegidas sin marca (XX-99 no existe).
  assert.deepEqual(r.json.tarjeta.guids, ["0000000000000000000008", "0000000000000000000007", "0000000000000000000001"]);
  // 8 días hábiles desde el jueves 12: salta el domingo 15 y termina el sábado 21 (semana 47).
  assert.deepEqual(r.json.tarjeta.dias, ["2026-11-12", "2026-11-13", "2026-11-14", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
  assert.equal(r.json.tarjeta.semana, "2026-W47");
  // Ajuste a mano: se mueve un día; un domingo no se acepta.
  const manual = await copresa("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { ...r.json.tarjeta, dias: [...r.json.tarjeta.dias.slice(0, 7), "2026-11-21"] } });
  assert.equal(manual.json.tarjeta.fin, "2026-11-21");
  assert.equal((await copresa("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { ...r.json.tarjeta, dias: ["2026-11-15"] } })).status, 400);
  const tid = r.json.tarjeta.id;
  r = await pm("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { contratista: "AD-001", entregable: "Sellado", inicio: "2026-11-23", duracion: 3 } });
  const ajena = r.json.tarjeta.id;
  assert.equal((await copresa("lean", { action: "tarjeta-borrar", hitoId, id: ajena })).status, 403);
  assert.equal((await copresa("lean", { action: "pasar", hitoId })).status, 403);
  r = await pm("lean", { action: "pasar", hitoId });
  assert.equal(r.json.creadas, 2);
  const g = await pm("lean");
  const nueva = g.json.actividades.find((a) => a.origen && a.origen.tarjeta === tid);
  assert.equal(nueva.semanaIni, "2026-W46"); // del primer día (jueves 12)
  assert.equal(nueva.semanaFin, "2026-W47"); // al último (sábado 21)
  assert.equal(nueva.restricciones[0].texto, "Grúa"); // lo que necesita pasa como restricción
  assert.equal(nueva.guids.length, 3); // las piezas de la tarjeta pasan a la actividad
  assert.equal((await copresa("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { id: tid, entregable: "x", inicio: "2026-11-16", duracion: 1 } })).status, 409);
});

test("desasignar piezas repetidas entre tarjetas", async () => {
  await admin("piezas", { action: "catalogo", version: "2", piezas: [
    { guid: "0000000000000000000011", marca: "MP-11", contratista: "COPRESA" },
    { guid: "0000000000000000000012", marca: "MP-12", contratista: "COPRESA" },
  ] });
  let r = await pm("lean", { action: "hito-guardar", hito: { nombre: "Azotea", fecha: "2026-12-04" } });
  const hitoId = r.json.hito.id;
  const a = (await pm("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { contratista: "COPRESA", entregable: "A", inicio: "2026-11-16", duracion: 2, marcas: "MP-11, MP-12" } })).json.tarjeta;
  const b = (await pm("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { contratista: "AD-001", entregable: "B", inicio: "2026-11-18", duracion: 2, marcas: "MP-12", guids: ["0000000000000000000099"] } })).json.tarjeta;
  assert.equal((await copresa("lean", { action: "quitar-piezas", hitoId, quitar: [{ tarId: b.id, guids: ["0000000000000000000012"] }] })).status, 403); // tarjeta ajena
  r = await pm("lean", { action: "quitar-piezas", hitoId, quitar: [{ tarId: b.id, guids: ["0000000000000000000012", "0000000000000000000099"] }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const nb = r.json.hito.tarjetas.find((t) => t.id === b.id), na = r.json.hito.tarjetas.find((t) => t.id === a.id);
  assert.deepEqual(nb.marcas, []); // MP-12 venía por marca: se quitó la marca
  assert.deepEqual(nb.guids, []); // y la suelta también
  assert.equal(na.guids.length, 2); // la otra tarjeta conserva sus piezas
});

test("una pieza puede ejecutarse en varios días de la tarea (ajuste manual)", async () => {
  await admin("piezas", { action: "catalogo", version: "3", piezas: [
    { guid: "0000000000000000000021", marca: "MP-21", contratista: "COPRESA" },
    { guid: "0000000000000000000022", marca: "MP-22", contratista: "COPRESA" },
  ] });
  const hitoId = (await pm("lean", { action: "hito-guardar", hito: { nombre: "Losa", fecha: "2026-12-11" } })).json.hito.id;
  const r = await pm("lean", { action: "tarjeta-guardar", hitoId, tarjeta: { contratista: "COPRESA", entregable: "Losa", inicio: "2026-11-23", duracion: 3, marcas: "MP-21, MP-22",
    reparto: { "0000000000000000000021": [1, 3], "0000000000000000000022": [5, 2], "0000000000000000000099": [1, 1] } } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.tarjeta.reparto, { "0000000000000000000021": [1, 3], "0000000000000000000022": [2, 3] }); // recortado a 3 días; pieza ajena fuera
});
