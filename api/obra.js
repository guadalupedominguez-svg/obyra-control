// Datos de la obra: nombre y modelo IFC en Forma.
//   GET  /api/obra                               cualquier usuario con sesión
//   POST /api/obra {action:"nombre", nombre}     admin
//   POST /api/obra {action:"modelo", url}        admin: liga del IFC en Forma Docs
//   POST /api/obra {action:"actualizar"}         admin: toma la versión más reciente del IFC
//   POST /api/obra {action:"carpeta", url}       admin: carpeta de Forma donde se envían los generadores
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";
import { formaStatus, parseFormaLink, latestVersion, parseFolderLink, folderInfo, b64url } from "../lib/forma.js";

const OBRA = () => key("obra");

export default route(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const me = await requireUser(req);
    const o = (await getJson(OBRA())) || {};
    const out = {
      nombre: o.nombre || "Obra sin nombre",
      modelo: o.versionUrn
        ? { urn: b64url(o.versionUrn), version: o.versionNumber, archivo: o.fileName, fecha: o.fecha, actualizado: o.actualizado }
        : null,
      carpeta: o.carpeta ? { nombre: o.carpeta.nombre } : null,
    };
    if (can(me, "administrar")) {
      out.forma = await formaStatus();
      out.formaUrl = o.formaUrl || "";
      out.carpetaUrl = (o.carpeta && o.carpeta.url) || "";
    }
    res.status(200).json(out);
    return;
  }

  const me = await requireUser(req, "administrar");
  const body = await readJson(req);
  const o = (await getJson(OBRA())) || {};

  if (body.action === "nombre") {
    o.nombre = cleanText(body.nombre, 120, "El nombre de la obra", { required: true });
  } else if (body.action === "modelo" || body.action === "actualizar") {
    const link = body.action === "modelo" ? cleanText(body.url, 2000, "La liga", { required: true }) : o.formaUrl;
    if (!link) throw new HttpError(400, "Primero pega la liga del IFC en Forma.");
    const { projectId, lineage } = parseFormaLink(link);
    const v = await latestVersion(projectId, lineage);
    if (!/\.ifc$/i.test(v.fileName)) throw new HttpError(400, `El archivo "${v.fileName}" no es un IFC.`);
    Object.assign(o, { formaUrl: link, projectId, lineage, ...v, actualizado: new Date().toISOString(), actualizadoPor: me.email });
  } else if (body.action === "carpeta") {
    const url = cleanText(body.url, 2000, "La liga", { required: true });
    const { projectId, folderUrn } = parseFolderLink(url);
    const { nombre } = await folderInfo(projectId, folderUrn);
    o.carpeta = { url, projectId, folderUrn, nombre, actualizado: new Date().toISOString(), por: me.email };
  } else {
    throw new HttpError(400, "Acción no reconocida.");
  }
  await setJson(OBRA(), o);
  res.status(200).json({ ok: true });
});
