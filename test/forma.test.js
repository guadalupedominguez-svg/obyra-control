// Envío de archivos a Forma con las respuestas de Autodesk simuladas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { _setStoreForTests } from "../lib/store.js";
import { parseFolderLink, subirArchivo, formaStatus } from "../lib/forma.js";

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

test("la conexión indica si puede escribir", async () => {
  assert.equal((await formaStatus()).escritura, true);
  db.set("ctrl:forma:data", token("data:read"));
  assert.equal((await formaStatus()).escritura, false);
  db.set("ctrl:forma:data", token("data:read data:write data:create"));
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
