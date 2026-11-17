// Proyectos: datos separados por obra y acceso por usuario.
import { test } from "node:test";
import assert from "node:assert/strict";
import { _setStoreForTests } from "../lib/store.js";

process.env.SESSION_SECRET = "x".repeat(40);
process.env.KV_REST_API_URL = "http://memoria";
process.env.KV_REST_API_TOKEN = "t";
process.env.ADMIN_EMAIL = "admin@obra.mx";
process.env.ADMIN_PASSWORD = "Admin-12345";

const db = new Map();
_setStoreForTests(async ([op, k, ...a]) => {
  const h = () => { if (!db.has(k)) db.set(k, new Map()); return db.get(k); };
  switch (op) {
    case "GET": return db.has(k) ? db.get(k) : null;
    case "SET": if (a.includes("NX") && db.has(k)) return null; db.set(k, a[0]); return "OK";
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

const H = {};
for (const n of ["session", "users", "piezas", "obra", "proyectos", "lean"]) H[n] = (await import(`../api/${n}.js`)).default;

function client() {
  let cookie = "";
  return async function call(name, body, { proyecto, query } = {}) {
    const headers = { cookie, "content-type": "application/json", "x-forwarded-for": "1.2.3.4" };
    if (proyecto) headers["x-proyecto"] = proyecto;
    const req = { method: body ? "POST" : "GET", headers, body, query: query || {} };
    const out = { status: 200, json: null, headers: {} };
    const res = {
      headersSent: false,
      setHeader(k, v) { out.headers[k.toLowerCase()] = v; },
      getHeader(k) { return out.headers[k.toLowerCase()]; },
      status(n) { out.status = n; return res; },
      json(o) { out.json = o; res.headersSent = true; return res; },
      end() { res.headersSent = true; },
    };
    await H[name](req, res);
    const sc = out.headers["set-cookie"];
    if (sc) cookie = [].concat(sc).map((c) => c.split(";")[0]).filter((c) => !c.endsWith("=")).join("; ");
    return out;
  };
}
const login = async (c, email, password) => assert.equal((await c("session", { action: "login", email, password })).status, 200);
const pieza = (n, extra = {}) => ({ guid: "0000000000000000000" + String(n).padStart(3, "0"), marca: "T-" + n, contratista: "HVAC", clave: "IE-01", ...extra });

test("cada proyecto tiene sus propios datos y cada usuario entra solo a los suyos", async () => {
  const admin = client();
  await login(admin, "admin@obra.mx", "Admin-12345");
  await admin("obra", { action: "nombre", nombre: "Frio Express" });
  await admin("piezas", { action: "catalogo", version: "1", piezas: [pieza(1)] });

  // Proyecto nuevo, por ensamble.
  let r = await admin("proyectos", { action: "crear", nombre: "Torre Médica", unidad: "ensamble" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const id = r.json.proyecto.id;
  assert.equal(id, "torre-medica");
  r = await admin("obra", null, { proyecto: id });
  assert.equal(r.json.nombre, "Torre Médica");
  assert.equal(r.json.unidad, "ensamble");
  assert.equal((await admin("obra")).json.unidad, "elemento"); // Frio Express sigue igual

  // Piezas separadas.
  await admin("piezas", { action: "catalogo", version: "1", piezas: [pieza(2, { takt: "T3" }), pieza(3)] }, { proyecto: id });
  const cat = (await admin("piezas", null, { proyecto: id })).json.piezas;
  assert.equal(cat["0000000000000000000002"].takt, "T3"); // el tren takt se guarda con la pieza
  const piezasDe = async (c, p) => Object.keys((await c("piezas", null, { proyecto: p })).json.piezas || {});
  assert.equal((await piezasDe(admin)).length, 1);
  assert.equal((await piezasDe(admin, id)).length, 2);

  // Lista de proyectos.
  r = await admin("proyectos");
  assert.deepEqual(r.json.proyectos.map((p) => p.id), ["principal", "torre-medica"]);
  assert.equal(r.json.proyectos[0].nombre, "Frio Express");

  // Usuario solo del proyecto nuevo.
  r = await admin("users", { action: "save", email: "res@obra.mx", nombre: "Res", rol: "residente", password: "Residente-123", proyectos: [id] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const res = client();
  await login(res, "res@obra.mx", "Residente-123");
  assert.equal((await res("piezas")).status, 403); // Frio Express no
  assert.equal((await piezasDe(res, id)).length, 2);
  r = await res("session");
  assert.deepEqual(r.json.proyectos.map((p) => p.id), [id]);
  assert.equal(r.json.proyecto, id); // pidió el principal sin acceso: la app lo cambia al suyo
  // Un usuario existente (sin lista) sigue entrando solo al principal.
  await admin("users", { action: "save", email: "viejo@obra.mx", nombre: "Viejo", rol: "residente", password: "Residente-123" });
  const viejo = client();
  await login(viejo, "viejo@obra.mx", "Residente-123");
  assert.equal((await viejo("piezas")).status, 200);
  assert.equal((await viejo("piezas", null, { proyecto: id })).status, 403);
  // Proyecto que no existe.
  assert.equal((await admin("piezas", null, { proyecto: "no-existe" })).status, 404);
  // Lean también separado.
  await admin("lean", { action: "hito-guardar", hito: { nombre: "Nivel 1", fecha: "2026-12-04" } }, { proyecto: id });
  const hitosDe = async (p) => ((await admin("lean", null, { proyecto: p })).json.hitos || []).length;
  assert.equal(await hitosDe(id), 1);
  assert.equal(await hitosDe(), 0);
});
