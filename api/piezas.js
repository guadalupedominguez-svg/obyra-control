// Piezas del modelo y su avance.
//   GET  /api/piezas
//       Catálogo de piezas (las que tienen contratista o clave en el modelo) y su avance.
//       Un contratista solo recibe las suyas.
//   POST /api/piezas {action:"catalogo", version, piezas:[...]}     admin: guarda las piezas leídas del modelo
//   POST /api/piezas {action:"reportar", guids, estatus, pct?, comentario?}
//   POST /api/piezas {action:"aprobar", guids, comentario?}
//   POST /api/piezas {action:"rechazar", guids, comentario}
//   POST /api/piezas {action:"estimar", guids, estimacion}
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson, hgetallJson, hmgetJson, hsetJson } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";

const CATALOGO = () => key("piezas", "catalogo");
const AVANCE = () => key("avance");

export const ESTATUS = ["Planeado", "Liberado", "En ejecución", "Terminado", "Estimado", "Pagado"];
// Lo que puede reportar cada quien. Estimado y Pagado salen del flujo de estimación, no del reporte.
const REPORTABLE = { contratista: ["En ejecución", "Terminado"], aprobador: ["Planeado", "Liberado", "En ejecución", "Terminado"] };

const NUM = ["area", "areaBruta", "volumen", "largo", "alto", "espesor"];
const TXT = { marca: 40, contratista: 60, clave: 40, partida: 60, concepto: 120, zona: 60, eje: 30, nivel: 60, categoria: 60, tipo: 160 };

function cleanPieza(p) {
  const guid = String(p.guid || "");
  if (!/^[0-9A-Za-z_$]{22}$/.test(guid)) return null; // GlobalId de IFC
  const o = { dbId: Number.isInteger(p.dbId) ? p.dbId : null };
  for (const [k, max] of Object.entries(TXT)) o[k] = p[k] == null ? "" : String(p[k]).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
  o.contratista = o.contratista.toUpperCase();
  for (const k of NUM) { const n = Number(p[k]); o[k] = Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null; }
  return [guid, o];
}

function checkGuids(v) {
  const list = Array.isArray(v) ? [...new Set(v.map(String))] : [];
  if (!list.length) throw new HttpError(400, "Selecciona al menos una pieza.");
  if (list.length > 500) throw new HttpError(400, "Máximo 500 piezas por operación.");
  return list;
}

const evento = (me, accion, extra) => ({ at: new Date().toISOString(), por: me.nombre, email: me.email, rol: me.rol, accion, ...extra });
function push(rec, ev) {
  rec.hist = [...(rec.hist || []), ev].slice(-50);
  return rec;
}

export default route(["GET", "POST"], async (req, res) => {
  const me = await requireUser(req);

  if (req.method === "GET") {
    const cat = (await getJson(CATALOGO())) || { piezas: {}, version: null, at: null };
    const avance = await hgetallJson(AVANCE());
    let piezas = cat.piezas || {};
    if (!can(me, "verTodo")) {
      piezas = Object.fromEntries(Object.entries(piezas).filter(([, p]) => p.contratista === me.contratista));
    }
    const av = {};
    for (const g of Object.keys(piezas)) if (avance[g]) av[g] = avance[g];
    res.status(200).json({ version: cat.version, at: cat.at, piezas, avance: av, estatus: ESTATUS });
    return;
  }

  const body = await readJson(req);

  if (body.action === "catalogo") {
    if (!can(me, "administrar")) throw new HttpError(403, "Solo un administrador puede actualizar las piezas del modelo.");
    const list = Array.isArray(body.piezas) ? body.piezas : [];
    if (list.length > 20000) throw new HttpError(400, "Demasiadas piezas (máximo 20,000).");
    const piezas = Object.fromEntries(list.map(cleanPieza).filter(Boolean));
    await setJson(CATALOGO(), { version: cleanText(body.version, 40, "La versión"), at: new Date().toISOString(), por: me.email, piezas });
    res.status(200).json({ ok: true, total: Object.keys(piezas).length });
    return;
  }

  const guids = checkGuids(body.guids);
  const cat = (await getJson(CATALOGO())) || { piezas: {} };
  const recs = await hmgetJson(AVANCE(), guids);
  const comentario = cleanText(body.comentario, 500, "El comentario");
  const cambios = {};
  const omitidas = [];

  guids.forEach((g, i) => {
    const p = cat.piezas[g];
    if (!p) { omitidas.push(g); return; }
    const rec = recs[i] || { estatus: "Planeado", pct: 0 };

    if (body.action === "reportar") {
      if (!can(me, "reportar")) throw new HttpError(403, "Tu rol no puede reportar avance.");
      const esContratista = me.rol === "contratista";
      if (esContratista && p.contratista !== me.contratista) { omitidas.push(g); return; }
      const est = String(body.estatus || "");
      if (!(esContratista ? REPORTABLE.contratista : REPORTABLE.aprobador).includes(est)) throw new HttpError(400, "Estatus no válido para reportar.");
      if (["Estimado", "Pagado"].includes(rec.estatus)) { omitidas.push(g); return; }
      let pct = est === "Terminado" ? 100 : Number(body.pct || 0);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, "El porcentaje debe estar entre 0 y 100.");
      pct = Math.round(pct);
      if (esContratista) {
        // El contratista propone; queda pendiente hasta que el residente o el superintendente apruebe.
        rec.pend = { estatus: est, pct, comentario, por: me.nombre, email: me.email, at: new Date().toISOString() };
        delete rec.rechazo;
        push(rec, evento(me, "reporta", { estatus: est, pct, comentario }));
      } else {
        // Quien puede aprobar registra el avance directo.
        Object.assign(rec, { estatus: est, pct, aprobado: { por: me.nombre, at: new Date().toISOString() } });
        delete rec.pend; delete rec.rechazo;
        push(rec, evento(me, "registra", { estatus: est, pct, comentario }));
      }
    } else if (body.action === "aprobar" || body.action === "rechazar") {
      if (!can(me, "aprobar")) throw new HttpError(403, "Tu rol no puede aprobar avance.");
      if (!rec.pend) { omitidas.push(g); return; }
      if (body.action === "aprobar") {
        Object.assign(rec, { estatus: rec.pend.estatus, pct: rec.pend.pct, aprobado: { por: me.nombre, at: new Date().toISOString() } });
        push(rec, evento(me, "aprueba", { estatus: rec.pend.estatus, pct: rec.pend.pct, comentario }));
      } else {
        if (!comentario) throw new HttpError(400, "Escribe el motivo del rechazo para que el contratista sepa qué corregir.");
        rec.rechazo = { motivo: comentario, por: me.nombre, at: new Date().toISOString(), estatus: rec.pend.estatus };
        push(rec, evento(me, "rechaza", { estatus: rec.pend.estatus, comentario }));
      }
      delete rec.pend;
    } else if (body.action === "estimar") {
      if (!can(me, "estimar")) throw new HttpError(403, "Tu rol no puede asignar estimaciones.");
      const est = cleanText(body.estimacion, 30, "La estimación", { required: true }).toUpperCase();
      if (rec.estatus !== "Terminado" || rec.pend) { omitidas.push(g); return; }
      Object.assign(rec, { estatus: "Estimado", estimacion: est });
      push(rec, evento(me, "estima", { estimacion: est }));
    } else {
      throw new HttpError(400, "Acción no reconocida.");
    }
    cambios[g] = rec;
  });

  await hsetJson(AVANCE(), cambios);
  res.status(200).json({ ok: true, actualizadas: Object.keys(cambios).length, omitidas: omitidas.length, avance: cambios });
});
