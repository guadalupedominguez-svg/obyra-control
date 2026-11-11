// Envío de generadores (Excel) a la carpeta de Forma configurada por el administrador.
//   GET  /api/envio                    bitácora de archivos enviados (un contratista solo ve los suyos)
//   POST /api/envio {nombre, base64, contratista?, estimacion?, piezas?, area?, volumen?}
//        quien puede estimar; un archivo por solicitud
import { Buffer } from "node:buffer";
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, hgetJson, hgetallJson, hsetJson } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";
import { formaStatus, subirArchivo } from "../lib/forma.js";

const MAX = 12 * 1024 * 1024; // 12 MB por archivo
const ENVIOS = () => key("envios"); // hash: nombre de archivo -> registro

export default route(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const me = await requireUser(req);
    let lista = Object.values(await hgetallJson(ENVIOS()));
    if (!can(me, "verTodo")) lista = lista.filter((e) => e.contratista === me.contratista);
    lista.sort((a, b) => (a.ultimo.at < b.ultimo.at ? 1 : -1));
    res.status(200).json({ envios: lista });
    return;
  }
  const me = await requireUser(req, "estimar");
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

  // Bitácora: qué se envió, cuándo, quién y con qué versión quedó en Forma.
  const num = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 1000) / 1000 : null);
  const prev = (await hgetJson(ENVIOS(), nombre)) || { envios: [] };
  const envio = { at: new Date().toISOString(), por: me.nombre, email: me.email, version: r.version, piezas: num(body.piezas) };
  await hsetJson(ENVIOS(), { [nombre]: {
    nombre, carpeta: o.carpeta.nombre,
    contratista: cleanText(body.contratista, 60, "El contratista").toUpperCase(),
    estimacion: cleanText(body.estimacion, 30, "La estimación").toUpperCase(),
    piezas: num(body.piezas), area: num(body.area), volumen: num(body.volumen),
    ultimo: envio, envios: [...prev.envios, envio].slice(-20),
  } });
  res.status(200).json({ ok: true, ...r, carpeta: o.carpeta.nombre, ultimo: envio });
});
