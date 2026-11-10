// Utilidades HTTP compartidas por las funciones de /api.

// Error con estado HTTP y mensaje para mostrar al usuario.
export class HttpError extends Error {
  constructor(status, message, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

// Envuelve un handler: valida el método, exige JSON en las escrituras (bloquea envíos de formularios
// desde otros sitios) y convierte los errores en JSON legible.
export function route(methods, fn) {
  return async function handler(req, res) {
    if (!methods.includes(req.method)) {
      res.setHeader("Allow", methods.join(", "));
      res.status(405).json({ error: "Método no permitido." });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      const ct = String(req.headers["content-type"] || "");
      if (!ct.startsWith("application/json")) {
        res.status(415).json({ error: "La solicitud debe enviarse como JSON." });
        return;
      }
    }
    res.setHeader("Cache-Control", "private, no-store");
    try {
      await fn(req, res);
    } catch (e) {
      if (res.headersSent) {
        res.end();
        return;
      }
      if (e instanceof HttpError) {
        if (e.status >= 500) console.error(e.status, e.message, JSON.stringify(e.detail || "").slice(0, 2000));
        res.status(e.status).json({ error: e.message });
      } else {
        console.error(e);
        res.status(500).json({ error: e.message || "Error inesperado en el servidor." });
      }
    }
  };
}

export async function readJson(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length > 2_000_000) throw new HttpError(413, "La solicitud es demasiado grande.");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "La solicitud no es un JSON válido.");
  }
}

// Texto corto y limpio (sin saltos de control) o error.
export function cleanText(v, max, name, { required = false } = {}) {
  const s = v == null ? "" : String(v).replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (required && !s) throw new HttpError(400, `Falta ${name}.`);
  if (s.length > max) throw new HttpError(400, `${name} es demasiado largo (máximo ${max} caracteres).`);
  return s;
}
