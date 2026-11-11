// Explorador de carpetas de Forma para elegir dónde se guardan los generadores.
//   GET  /api/carpetas?padre=<folderUrn>    subcarpetas (sin padre: carpetas principales del proyecto)
//   POST /api/carpetas {contratista, folderUrn, ruta:[{id,nombre}]}
//        guarda la carpeta de un contratista (quien estima) o la general (contratista vacío: admin)
// Se navega con la cuenta de Autodesk de quien usa la app (ve solo lo que puede ver en Forma);
// el administrador sin cuenta propia usa la conexión general de la obra.
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";
import { cuentaStatus, cuentaChain, listarCarpetas, folderInfo } from "../lib/forma.js";

const URN = /^urn:adsk\.wip[a-z]+:fs\.folder:co\.[A-Za-z0-9_-]+$/;

async function cadena(me) {
  if ((await cuentaStatus(me.email)).conectada) return cuentaChain(me.email);
  if (can(me, "administrar")) return "data";
  throw new HttpError(409, "Conecta tu cuenta de Autodesk (botón «Conectar mi cuenta de Autodesk») para ver las carpetas de Forma.");
}

export default route(["GET", "POST"], async (req, res) => {
  const me = await requireUser(req, "estimar");
  const o = (await getJson(key("obra"))) || {};
  if (!o.projectId) throw new HttpError(409, "Primero el administrador debe configurar el modelo IFC de Forma (de ahí se toma el proyecto).");
  const chain = await cadena(me);

  if (req.method === "GET") {
    const padre = String((req.query && req.query.padre) || "");
    if (padre && !URN.test(padre)) throw new HttpError(400, "Carpeta no válida.");
    res.status(200).json({ carpetas: await listarCarpetas(o.projectId, padre, chain) });
    return;
  }

  const body = await readJson(req);
  const contratista = cleanText(body.contratista, 60, "El contratista").toUpperCase();
  if (!contratista && !can(me, "administrar")) throw new HttpError(403, "Solo un administrador puede cambiar la carpeta general.");
  const folderUrn = String(body.folderUrn || "");
  if (!URN.test(folderUrn)) throw new HttpError(400, "Elige una carpeta.");
  const { nombre } = await folderInfo(o.projectId, folderUrn, chain); // confirma que existe y que se puede ver
  const ruta = (Array.isArray(body.ruta) ? body.ruta : []).slice(0, 30)
    .filter((x) => x && URN.test(String(x.id || "")))
    .map((x) => ({ id: String(x.id), nombre: cleanText(x.nombre, 120, "La carpeta") }));
  const c = { projectId: o.projectId, folderUrn, nombre, ruta, actualizado: new Date().toISOString(), por: me.email };
  // Se vuelve a leer la obra justo antes de guardar para no pisar otro cambio.
  const actual = (await getJson(key("obra"))) || {};
  if (contratista) actual.carpetas = { ...(actual.carpetas || {}), [contratista]: c };
  else actual.carpeta = c;
  await setJson(key("obra"), actual);
  res.status(200).json({ ok: true, carpeta: { nombre, ruta } });
});
