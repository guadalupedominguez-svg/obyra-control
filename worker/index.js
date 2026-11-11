// OBYRA Control en Cloudflare Workers.
// Sirve la carpeta public/ como archivos estáticos y ejecuta las funciones de /api (también corren en Vercel),
// con un adaptador que imita el req/res de Node que esas funciones esperan.
import { Buffer } from "node:buffer";

const API = {
  session: () => import("../api/session.js"),
  users: () => import("../api/users.js"),
  obra: () => import("../api/obra.js"),
  piezas: () => import("../api/piezas.js"),
  envio: () => import("../api/envio.js"),
  carpetas: () => import("../api/carpetas.js"),
  lean: () => import("../api/lean.js"),
};
const FORMA = () => import("../api/forma/[action].js");

const SECURITY = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "same-origin" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      const r = await env.ASSETS.fetch(request);
      const out = new Response(r.body, r);
      for (const [k, v] of Object.entries(SECURITY)) out.headers.set(k, v);
      return out;
    }
    // Las variables y secretos de Cloudflare quedan en process.env, como en Vercel.
    for (const [k, v] of Object.entries(env)) if (typeof v === "string") process.env[k] = v;
    const parts = url.pathname.slice(5).split("/").filter(Boolean);
    const query = {};
    for (const [k, v] of url.searchParams) query[k] = v;
    let load;
    if (parts[0] === "forma" && parts[1] && parts.length === 2) { load = FORMA; query.action = parts[1]; }
    else if (parts.length === 1) load = API[parts[0]];
    if (!load) return Response.json({ error: "No encontrado." }, { status: 404, headers: SECURITY });
    const mod = await load();
    return run(mod.default, request, url, query);
  },
};

async function run(handler, request, url, query) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  if (!headers["x-forwarded-proto"]) headers["x-forwarded-proto"] = url.protocol.replace(":", "");
  if (!headers["x-forwarded-host"]) headers["x-forwarded-host"] = url.host;
  const body = request.method === "GET" || request.method === "HEAD" ? null : Buffer.from(await request.arrayBuffer());
  const req = {
    method: request.method, url: url.pathname + url.search, query, headers, body: undefined,
    async *[Symbol.asyncIterator]() { if (body && body.length) yield body; },
  };

  return new Promise((resolve) => {
    const h = new Map(); // nombre en minúsculas -> [nombre, valor]
    const chunks = [];
    let done = false;
    const outHeaders = () => {
      const o = new Headers(SECURITY);
      for (const [, [name, val]] of h) {
        if (Array.isArray(val)) val.forEach((x) => o.append(name, String(x)));
        else o.set(name, String(val));
      }
      return o;
    };
    const finish = (bodyInit) => {
      if (done) return; done = true; res.headersSent = true;
      const status = res.statusCode || 200;
      const noBody = status === 204 || status === 304 || request.method === "HEAD";
      resolve(new Response(noBody ? null : bodyInit, { status, headers: outHeaders() }));
    };
    const res = {
      statusCode: 200, headersSent: false, isWorker: true,
      setHeader(k, v) { h.set(String(k).toLowerCase(), [k, v]); return res; },
      getHeader(k) { const e = h.get(String(k).toLowerCase()); return e ? e[1] : undefined; },
      removeHeader(k) { h.delete(String(k).toLowerCase()); },
      status(n) { res.statusCode = n; return res; },
      json(o) { if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(o)); return res; },
      send(x) {
        if (x != null && typeof x === "object" && !(x instanceof Uint8Array)) return res.json(x);
        if (!res.getHeader("Content-Type")) res.setHeader("Content-Type", "text/plain; charset=utf-8");
        res.end(x); return res;
      },
      redirect(a, b) { const [code, loc] = typeof a === "number" ? [a, b] : [302, a]; res.statusCode = code; res.setHeader("Location", loc); res.end(); return res; },
      write(d) { if (d != null) chunks.push(typeof d === "string" ? Buffer.from(d) : Buffer.from(d)); return true; },
      end(d) { if (d != null) res.write(d); finish(chunks.length ? Buffer.concat(chunks) : null); },
      // Transmite un cuerpo (p. ej. un archivo de Forma) sin cargarlo en memoria.
      sendWebStream(stream) { finish(stream); },
    };
    Promise.resolve(handler(req, res)).then(() => { if (!done) finish(chunks.length ? Buffer.concat(chunks) : null); },
      (e) => { if (!done) { res.statusCode = 500; finish(JSON.stringify({ error: e && e.message || "Error inesperado en el servidor." })); } });
  });
}
