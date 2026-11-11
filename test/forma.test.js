// Envío de archivos a Forma con las respuestas de Autodesk simuladas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { _setStoreForTests } from "../lib/store.js";
import { parseFolderLink, subirArchivo, cuentaStatus, listarCarpetas, buscarCarpetas } from "../lib/forma.js";

process.env.KV_REST_API_URL = "http://memoria";
process.env.KV_REST_API_TOKEN = "t";

const db = new Map();
_setStoreForTests(async ([op, k, ...a]) => {
  if (op === "GET") return db.has(k) ? db.get(k) : null;
  if (op === "SET") { db.set(k, a[0]); return "OK"; }
  throw new Error("Comando no simulado: " + op);
});
const token = (scope) => JSON.stringify({ access: "tok", refresh: "r", exp: Date.now() + 3_600_000, by: "a@a", at: "x", scope });
db.set("ctrl:forma:data", token("data:read data:write data:create"));
db.set("ctrl:forma:view", token("viewables:read"));

const FOLDER = "urn:adsk.wipprod:fs.folder:co.AbC_123-x";
const LINK = "https://acc.autodesk.com/docs/files/projects/7CACE05A-1111-2222-3333-444455556666?folderUrn=" + encodeURIComponent(FOLDER) + "&viewModel=detail";

test("lee la liga de una carpeta de Forma", () => {
  assert.deepEqual(parseFolderLink(LINK), { projectId: "b.7cace05a-1111-2222-3333-444455556666", folderUrn: FOLDER });
  assert.throws(() => parseFolderLink("https://acc.autodesk.com/docs/files/projects/7cace05a-1111-2222-3333-444455556666"), /carpeta/);
});

test("cada residente tiene su propia cuenta de Autodesk", async () => {
  assert.equal((await cuentaStatus("res@obra.mx")).conectada, false);
  db.set("ctrl:forma:cuenta:res@obra.mx", token("data:read data:write data:create"));
  assert.equal((await cuentaStatus("res@obra.mx")).conectada, true);
});

function fakeFetch(existe) {
  const log = [];
  globalThis.fetch = async (url, opt = {}) => {
    const m = opt.method || "GET";
    log.push(m + " " + url.replace("https://developer.api.autodesk.com", ""));
    const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
    if (url.endsWith("/storage")) {
      const b = JSON.parse(opt.body);
      assert.equal(b.data.relationships.target.data.id, FOLDER);
      assert.equal(opt.headers["Content-Type"], "application/vnd.api+json");
      return ok({ data: { id: "urn:adsk.objects:os.object:wip.dm.prod/abc-123.xlsx" } });
    }
    if (url.includes("/signeds3upload") && m === "GET") return ok({ uploadKey: "UK", urls: ["https://s3.example/put"] });
    if (url === "https://s3.example/put") { assert.equal(opt.headers, undefined); return new Response("", { status: 200 }); }
    if (url.includes("/signeds3upload") && m === "POST") { assert.equal(JSON.parse(opt.body).uploadKey, "UK"); return ok({}); }
    if (url.includes("/contents?")) return ok({ data: existe ? [{ id: "urn:item:1", attributes: { displayName: "G.xlsx" } }] : [] });
    if (url.endsWith("/versions")) { assert.equal(JSON.parse(opt.body).data.relationships.item.data.id, "urn:item:1"); return ok({ data: { attributes: { versionNumber: 2 } } }); }
    if (url.endsWith("/items")) {
      const b = JSON.parse(opt.body);
      assert.equal(b.data.relationships.parent.data.id, FOLDER);
      assert.equal(b.included[0].relationships.storage.data.id, "urn:adsk.objects:os.object:wip.dm.prod/abc-123.xlsx");
      return ok({ data: { id: "urn:item:nuevo" } });
    }
    throw new Error("URL no esperada: " + m + " " + url);
  };
  return log;
}

test("sube un archivo nuevo a la carpeta", async () => {
  const log = fakeFetch(false);
  const r = await subirArchivo("b.p", FOLDER, "G.xlsx", Buffer.from("PK.."));
  assert.deepEqual(r, { nombre: "G.xlsx", version: 1, nuevo: true });
  assert.ok(log.some((l) => l.startsWith("POST /data/v1/projects/b.p/items")));
  assert.ok(log.some((l) => l.includes("/oss/v2/buckets/wip.dm.prod/objects/abc-123.xlsx/signeds3upload")));
});

test("si ya existe un archivo con el mismo nombre, guarda una versión nueva", async () => {
  const log = fakeFetch(true);
  const r = await subirArchivo("b.p", FOLDER, "G.xlsx", Buffer.from("PK.."));
  assert.deepEqual(r, { nombre: "G.xlsx", version: 2, nuevo: false });
  assert.ok(log.some((l) => l.startsWith("POST /data/v1/projects/b.p/versions")));
  assert.ok(!log.some((l) => l.includes("/items")));
});

test("el explorador lista carpetas principales y subcarpetas (con paginación)", async () => {
  const P = "b.proj";
  globalThis.fetch = async (url) => {
    const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
    const u = url.replace("https://developer.api.autodesk.com", "");
    if (u === "/project/v1/hubs") return ok({ data: [{ id: "b.otro" }, { id: "b.hub" }] });
    if (u === "/project/v1/hubs/b.otro/projects/b.proj") return new Response("{}", { status: 404 });
    if (u === "/project/v1/hubs/b.hub/projects/b.proj") return ok({ data: { id: P } });
    if (u.startsWith("/project/v1/hubs/b.hub/projects/b.proj/topFolders")) return ok({ data: [{ id: "urn:adsk.wipprod:fs.folder:co.pf", type: "folders", attributes: { displayName: "Project Files" } }] });
    if (u.includes("/folders/urn%3Aadsk.wipprod%3Afs.folder%3Aco.pf/contents") && !u.includes("pagina2"))
      return ok({ data: [{ id: "urn:adsk.wipprod:fs.folder:co.b", type: "folders", attributes: { displayName: "Gen COPRESA" } }], links: { next: { href: "https://developer.api.autodesk.com/data/v1/x?pagina2" } } });
    if (u.includes("pagina2")) return ok({ data: [{ id: "urn:adsk.wipprod:fs.folder:co.a", type: "folders", attributes: { displayName: "Gen AD-001" } }, { id: "oculta", type: "folders", attributes: { displayName: "x", hidden: true } }] });
    throw new Error("URL no esperada " + u);
  };
  const top = await listarCarpetas(P, "");
  assert.deepEqual(top.map((c) => c.nombre), ["Project Files"]);
  const sub = await listarCarpetas(P, "urn:adsk.wipprod:fs.folder:co.pf");
  assert.deepEqual(sub.map((c) => c.nombre), ["Gen AD-001", "Gen COPRESA"]); // ordenadas y sin ocultas
  assert.equal(JSON.parse(db.get("ctrl:forma:hub:b.proj")), "b.hub"); // el hub se recuerda
});

test("si Autodesk no deja ver el hub, el explorador arranca subiendo desde la carpeta del IFC", async () => {
  db.delete("ctrl:forma:hub:b.p2");
  globalThis.fetch = async (url) => {
    const ok = (j) => new Response(JSON.stringify(j), { status: 200 });
    const u = url.replace("https://developer.api.autodesk.com", "");
    if (u === "/project/v1/hubs") return ok({ data: [] }); // la app no está habilitada en la cuenta
    if (u.endsWith("/items/urn%3Aadsk.wipprod%3Adm.lineage%3Aifc/parent")) return ok({ data: { id: "urn:adsk.wipprod:fs.folder:co.av", attributes: { displayName: "034_AVANCES" } } });
    if (u.includes("co.av/parent")) return ok({ data: { id: "urn:adsk.wipprod:fs.folder:co.con", attributes: { displayName: "03_CONSTRUCCION" } } });
    if (u.includes("co.con/parent")) return ok({ data: { id: "urn:adsk.wipprod:fs.folder:co.pf", attributes: { displayName: "Project Files" } } });
    if (u.includes("co.pf/parent")) return ok({ data: { id: "urn:adsk.wipprod:fs.folder:co.root", attributes: { displayName: "root", hidden: true } } });
    throw new Error("URL no esperada " + u);
  };
  const top = await listarCarpetas("b.p2", "", "data", { lineage: "urn:adsk.wipprod:dm.lineage:ifc" });
  assert.deepEqual(top, [{ id: "urn:adsk.wipprod:fs.folder:co.pf", nombre: "Project Files" }]);
});

test("busca carpetas por nombre en subcarpetas y devuelve su ruta", async () => {
  const kids = { av: [["g", "generadores"], ["v", "03401_Vuelo Dron"]], g: [["cp", "Gen COPRESA"], ["fm", "Gen FAMEP"]], v: [], cp: [], fm: [] };
  globalThis.fetch = async (url) => {
    const m = /co\.(\w+)\/contents/.exec(decodeURIComponent(url));
    const lista = (m && kids[m[1]]) || [];
    return new Response(JSON.stringify({ data: lista.map(([id, n]) => ({ id: "urn:adsk.wipprod:fs.folder:co." + id, type: "folders", attributes: { displayName: n } })) }), { status: 200 });
  };
  const r = await buscarCarpetas("b.p", "urn:adsk.wipprod:fs.folder:co.av", "copresa");
  assert.equal(r.length, 1);
  assert.equal(r[0].nombre, "Gen COPRESA");
  assert.deepEqual(r[0].ruta.map((x) => x.nombre), ["generadores", "Gen COPRESA"]);
});
