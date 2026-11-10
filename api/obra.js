// Datos de la obra: nombre y modelo IFC en Forma.
//   GET  /api/obra                               cualquier usuario con sesión
//   POST /api/obra {action:"nombre", nombre}     admin
//   POST /api/obra {action:"modelo", url}        admin: liga del IFC en Forma Docs
//   POST /api/obra {action:"actualizar"}         admin: toma la versión más reciente del IFC
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";
import { formaStatus, parseFormaLink, latestVersion, b64url } from "../lib/forma.js";

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
    };
    if (can(me, "administrar")) {
      out.forma = await formaStatus();
      out.formaUrl = o.formaUrl || "";
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
  } else {
    throw new HttpError(400, "Acción no reconocida.");
  }
  await setJson(OBRA(), o);
  res.status(200).json({ ok: true });
});
