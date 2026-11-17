// Piezas del modelo y su avance.
//   GET  /api/piezas
//       Catálogo de piezas (las que tienen contratista o clave en el modelo) y su avance.
//       Un contratista solo recibe las suyas.
//   POST /api/piezas {action:"catalogo", version, piezas:[...]}     admin: guarda las piezas leídas del modelo
//   POST /api/piezas {action:"reportar", guids, estatus, pct?, comentario?}
//       Contratista: el avance se aplica de inmediato y queda «sin validar».
//   POST /api/piezas {action:"validar", guids, comentario?}          residente/superintendente: valida el avance
//   POST /api/piezas {action:"rechazar", guids, comentario}          residente/superintendente: no valida; regresa a como estaba
//   POST /api/piezas {action:"enviar", guids, estimacion}            contratista: envía su generador (lo Terminado y validado);
//                                                                    queda Por aprobar, primero con el residente
//   POST /api/piezas {action:"gen-validar", guids, comentario?}      residente: valida el generador → pasa al superintendente
//   POST /api/piezas {action:"gen-regresar", guids, comentario}      residente: no lo valida → regresa a Terminado
//   POST /api/piezas {action:"aprobar", guids, comentario?}          superintendente: aprueba la estimación → Estimado
//   POST /api/piezas {action:"regresar", guids, comentario}          superintendente: no aprueba → regresa a Terminado
//   POST /api/piezas {action:"descartar", guids}                     admin: quita lo pendiente sin decidir
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson, hgetallJson, hmgetJson, hsetJson } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";

const CATALOGO = () => key("piezas", "catalogo");
const AVANCE = () => key("avance");

export const ESTATUS = ["Planeado", "Liberado", "En ejecución", "Terminado", "Estimado", "Pagado"];
// Lo que puede reportar cada quien. Estimado y Pagado salen del flujo de estimación, no del reporte.
const REPORTABLE = { contratista: ["Planeado", "Liberado", "En ejecución", "Terminado"] };

const NUM = ["area", "areaBruta", "volumen", "largo", "alto", "espesor"];
const TXT = { marca: 40, contratista: 60, clave: 40, partida: 60, concepto: 120, zona: 60, takt: 60, eje: 30, nivel: 60, categoria: 60, tipo: 160 };

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

const ahora = () => new Date().toISOString();
// Avance del contratista que el residente aún no valida (lo de antes de este flujo cuenta como validado).
const sinValidar = (rec) => !!rec.porValidar;

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
      if (me.rol === "contratista" && p.contratista !== me.contratista) { omitidas.push(g); return; }
      const est = String(body.estatus || "");
      if (!REPORTABLE.contratista.includes(est)) throw new HttpError(400, "Estatus no válido para reportar.");
      // Lo que ya va a estimar (o se estimó) ya no se mueve desde aquí.
      if (rec.pend || ["Estimado", "Pagado"].includes(rec.estatus)) { omitidas.push(g); return; }
      let pct = est === "Terminado" ? 100 : est === "En ejecución" ? Number(body.pct || 0) : 0;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new HttpError(400, "El porcentaje debe estar entre 0 y 100.");
      pct = Math.round(pct);
      // Se aplica de inmediato; se guarda cómo estaba por si el residente no lo valida.
      if (!sinValidar(rec)) rec.antes = { estatus: rec.estatus || "Planeado", pct: rec.pct || 0 };
      rec.porValidar = { por: me.nombre, email: me.email, at: ahora(), comentario };
      Object.assign(rec, { estatus: est, pct });
      delete rec.rechazo; delete rec.validado;
      push(rec, evento(me, "reporta", { estatus: est, pct, comentario }));
    } else if (body.action === "validar" || body.action === "rechazar") {
      if (!can(me, "aprobar")) throw new HttpError(403, "Tu rol no puede validar avance.");
      // Compatibilidad: una propuesta del flujo anterior (pendiente que no es estimación) se valida igual.
      if (rec.pend && rec.pend.estatus !== "Estimado") {
        if (body.action === "validar") Object.assign(rec, { estatus: rec.pend.estatus, pct: rec.pend.pct });
        else if (!comentario) throw new HttpError(400, "Escribe el motivo para que el contratista sepa qué corregir.");
        else rec.rechazo = { motivo: comentario, por: me.nombre, at: ahora(), estatus: rec.pend.estatus };
        push(rec, evento(me, body.action === "validar" ? "valida" : "rechaza", { estatus: rec.pend.estatus, pct: rec.pend.pct, comentario }));
        delete rec.pend;
        if (body.action === "validar") rec.validado = { por: me.nombre, at: ahora() };
        cambios[g] = rec; return;
      }
      if (!sinValidar(rec)) { omitidas.push(g); return; }
      if (body.action === "validar") {
        rec.validado = { por: me.nombre, at: ahora() };
        push(rec, evento(me, "valida", { estatus: rec.estatus, pct: rec.pct, comentario }));
      } else {
        if (!comentario) throw new HttpError(400, "Escribe el motivo para que el contratista sepa qué corregir.");
        const propuesto = { estatus: rec.estatus, pct: rec.pct };
        Object.assign(rec, rec.antes || { estatus: "Planeado", pct: 0 });
        rec.rechazo = { motivo: comentario, por: me.nombre, at: ahora(), estatus: propuesto.estatus, pct: propuesto.pct };
        push(rec, evento(me, "rechaza", { estatus: propuesto.estatus, pct: propuesto.pct, comentario }));
      }
      delete rec.porValidar; delete rec.antes;
    } else if (body.action === "enviar") {
      // El contratista manda a estimar lo terminado y validado: queda Por aprobar del superintendente.
      if (!can(me, "enviarEstimacion")) throw new HttpError(403, "Tu rol no puede enviar a estimar.");
      if (me.rol === "contratista" && p.contratista !== me.contratista) { omitidas.push(g); return; }
      const est = cleanText(body.estimacion, 30, "La estimación", { required: true }).toUpperCase();
      if (rec.estatus !== "Terminado" || rec.pend || sinValidar(rec)) { omitidas.push(g); return; }
      rec.pend = { estatus: "Estimado", estimacion: est, etapa: "residente", por: me.nombre, email: me.email, at: ahora(), comentario };
      delete rec.rechazo;
      push(rec, evento(me, "envia", { estimacion: est, comentario }));
    } else if (body.action === "gen-validar" || body.action === "gen-regresar") {
      // El residente revisa el generador del contratista.
      if (!can(me, "validarGenerador")) throw new HttpError(403, "Solo el residente valida generadores.");
      if (!rec.pend || rec.pend.estatus !== "Estimado" || rec.pend.etapa !== "residente") { omitidas.push(g); return; }
      if (body.action === "gen-validar") {
        Object.assign(rec.pend, { etapa: "superintendente", validadoPor: me.nombre, validadoAt: ahora() });
        push(rec, evento(me, "valida-generador", { estimacion: rec.pend.estimacion, comentario }));
      } else {
        if (!comentario) throw new HttpError(400, "Escribe el motivo para que el contratista sepa qué corregir.");
        rec.rechazo = { motivo: comentario, por: me.nombre, at: ahora(), estimacion: rec.pend.estimacion };
        push(rec, evento(me, "regresa", { estimacion: rec.pend.estimacion, comentario }));
        delete rec.pend;
      }
    } else if (body.action === "aprobar" || body.action === "regresar") {
      if (!can(me, "autorizar")) throw new HttpError(403, "Solo el superintendente aprueba estimaciones.");
      // Lo enviado antes de que existiera la validación del residente (sin etapa) llega directo al superintendente.
      if (!rec.pend || rec.pend.estatus !== "Estimado" || (rec.pend.etapa && rec.pend.etapa !== "superintendente")) { omitidas.push(g); return; }
      if (body.action === "aprobar") {
        Object.assign(rec, { estatus: "Estimado", pct: 100, estimacion: rec.pend.estimacion, aprobado: { por: me.nombre, at: ahora() } });
        push(rec, evento(me, "estima", { estimacion: rec.pend.estimacion, comentario }));
      } else {
        if (!comentario) throw new HttpError(400, "Escribe el motivo para que el contratista sepa qué corregir.");
        rec.rechazo = { motivo: comentario, por: me.nombre, at: ahora(), estimacion: rec.pend.estimacion };
        push(rec, evento(me, "regresa", { estimacion: rec.pend.estimacion, comentario }));
      }
      delete rec.pend;
    } else if (body.action === "descartar") {
      // Administrador: quita lo pendiente sin decidir (propuesta anterior o estimación enviada).
      if (!can(me, "administrar")) throw new HttpError(403, "Solo un administrador puede descartar pendientes.");
      if (!rec.pend) { omitidas.push(g); return; }
      push(rec, evento(me, "descarta", { estatus: rec.pend.estatus, pct: rec.pend.pct, estimacion: rec.pend.estimacion, comentario }));
      delete rec.pend;
    } else {
      throw new HttpError(400, "Acción no reconocida.");
    }
    cambios[g] = rec;
  });

  await hsetJson(AVANCE(), cambios);
  res.status(200).json({ ok: true, actualizadas: Object.keys(cambios).length, omitidas: omitidas.length, avance: cambios });
});
