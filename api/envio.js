// Envío de generadores (Excel) a la carpeta de Forma configurada por el administrador.
//   POST /api/envio {nombre, base64}   quien puede estimar; un archivo por solicitud
import { Buffer } from "node:buffer";
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson } from "../lib/store.js";
import { requireUser } from "../lib/users.js";
import { formaStatus, subirArchivo } from "../lib/forma.js";

const MAX = 12 * 1024 * 1024; // 12 MB por archivo

export default route(["POST"], async (req, res) => {
  await requireUser(req, "estimar");
  const body = await readJson(req, { max: Math.ceil(MAX * 1.4) + 4096 });
  const nombre = cleanText(body.nombre, 150, "El nombre del archivo", { required: true });
  if (!/^[\w.() -]+\.xlsx$/.test(nombre)) throw new HttpError(400, "Nombre de archivo no válido.");
  const bytes = Buffer.from(String(body.base64 || ""), "base64");
  if (!bytes.length) throw new HttpError(400, "El archivo está vacío.");
  if (bytes.length > MAX) throw new HttpError(413, "El archivo pesa más de 12 MB.");
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new HttpError(400, "El archivo no es un Excel (.xlsx)."); // zip: PK

  const o = (await getJson(key("obra"))) || {};
  if (!o.carpeta) throw new HttpError(409, "Falta configurar la carpeta de Forma para los generadores (Configuración).");
  const st = await formaStatus();
  if (!st.escritura) throw new HttpError(409, "La conexión con Forma solo tiene permiso de lectura. Un administrador debe volver a conectar Forma desde Configuración.");

  const r = await subirArchivo(o.carpeta.projectId, o.carpeta.folderUrn, nombre, bytes);
  res.status(200).json({ ok: true, ...r, carpeta: o.carpeta.nombre });
});
