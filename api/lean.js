// Módulo Lean: look-ahead de 6 semanas, plan semanal, PPC y sesión pull.
//   GET  /api/lean                       configuración, actividades, plan semanal e hitos
//   POST /api/lean {action, ...}
//     config          {modo, ubicaciones[], causas[], meta}            PM / admin
//     act-guardar     {act:{id?, partida, contratista, ubicacion, eje, descripcion, semanaIni, semanaFin, guids[]}}  PM / admin
//     act-borrar      {id}                                              PM / admin
//     restr-agregar   {actId, texto, tipo, responsable, fecha}          cualquiera (contratista: solo en lo suyo)
//     restr-liberar   {actId, restrId}                                  PM, residente, superintendente o el contratista dueño
//     plan-agregar    {semana, actId, meta}                             PM / admin (plan semanal)
//     plan-quitar     {semana, actId}                                   PM / admin (solo si no se ha calificado)
//     calificar       {semana, actId, cumplido, causa?, comentario?}    residente (paso 1)
//     validar         {semana, actId, ok, comentario?}                  superintendente (paso 2: valida o regresa)
//     hito-guardar    {hito:{id?, nombre, fecha}}                       PM / admin
//     hito-borrar     {id}                                              PM / admin
//     tarjeta-guardar {hitoId, tarjeta:{id?, contratista, entregable, inicio, duracion, dias?[], entregaA, necesita, ubicacion, partida}}
//                     dias: fechas hábiles (lunes a sábado) acomodadas a mano; sin dias se acomodan solas desde inicio + duracion
//                     guids: piezas del modelo que se ejecutan con la tarjeta (pasan a la actividad)
//                     marcas: marcas de pieza (parámetro Marca); se ligan solas a las piezas del catálogo con esa marca
//                     contratista: solo sus tarjetas; PM / admin: todas
//     tarjeta-borrar  {hitoId, id}
//     pasar           {hitoId}                                          PM / admin: tarjetas → actividades del look-ahead
import crypto from "node:crypto";
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson, hgetJson, hgetallJson, hsetJson, hdel } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";

const CONFIG = () => key("lean", "config");
const ACTS = () => key("lean", "act");
const PLAN = () => key("lean", "plan");
const HITOS = () => key("lean", "hitos");

export const CAUSAS = ["Material no disponible", "Predecesora no terminada", "Mano de obra insuficiente", "Falta de información / RFI", "Clima", "Equipo", "Cambio de prioridad"];
export const TIPOS = ["Material", "Mano de obra", "Equipo", "Información / diseño", "Predecesora", "Permiso", "Otro"];
const SEMANA = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const URN_GUID = /^[0-9A-Za-z_$]{22}$/;
const id = () => crypto.randomBytes(6).toString("hex");
const ahora = () => new Date().toISOString();
const firma = (me) => ({ por: me.nombre, email: me.email, at: ahora() });

function semana(v, name) {
  const s = String(v || "");
  if (!SEMANA.test(s)) throw new HttpError(400, `${name}: semana no válida (formato 2026-W46).`);
  return s;
}
// Días hábiles de obra: lunes a sábado.
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const aFecha = (s) => new Date(s + "T12:00:00Z");
const deFecha = (d) => d.toISOString().slice(0, 10);
const habil = (s) => aFecha(s).getUTCDay() !== 0;
export function diasHabiles(inicio, n) {
  const out = [], d = aFecha(inicio);
  while (out.length < n && out.length < 400) { if (d.getUTCDay() !== 0) out.push(deFecha(d)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}
export function semanaDe(fecha) {
  const t = aFecha(fecha), dia = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dia);
  const n = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
  return t.getUTCFullYear() + "-W" + String(n).padStart(2, "0");
}
// Tarjetas anteriores sin días: se acomodan desde el lunes de su semana.
export function diasDeTarjeta(t) {
  if (Array.isArray(t.dias) && t.dias.length) return t.dias;
  if (!t.semana) return [];
  const m = /^(\d{4})-W(\d{2})$/.exec(t.semana), d = new Date(Date.UTC(+m[1], 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1) + (+m[2] - 1) * 7);
  return diasHabiles(deFecha(d), t.duracion || 1);
}

// Piezas de una tarjeta: las elegidas en el modelo más las que tienen las marcas indicadas.
async function ligarPiezas(marcasIn, guidsIn) {
  const marcas = [...new Set((Array.isArray(marcasIn) ? marcasIn : String(marcasIn || "").split(/[,;\n]+/))
    .map((x) => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, 300);
  const guids = new Set((Array.isArray(guidsIn) ? guidsIn : []).map(String).filter((g) => URN_GUID.test(g)));
  if (marcas.length) {
    const cat = (await getJson(key("piezas", "catalogo"))) || { piezas: {} };
    for (const [g, p] of Object.entries(cat.piezas || {})) if (marcas.includes(String(p.marca || "").toUpperCase())) guids.add(g);
  }
  return { marcas, guids: [...guids].slice(0, 2000) };
}

function lista(v, max, maxLen) {
  return (Array.isArray(v) ? v : []).map((x) => String(x).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, maxLen)).filter(Boolean).slice(0, max);
}
const upper = (v, max, name) => cleanText(v, max, name).toUpperCase();
function pedirPlan(me) { if (!can(me, "planear")) throw new HttpError(403, "Solo el PM puede hacer esto."); }

async function config() {
  const c = (await getJson(CONFIG())) || {};
  return {
    modo: c.modo === "takt" ? "takt" : "zonas",
    ubicaciones: c.ubicaciones || [],
    causas: c.causas && c.causas.length ? c.causas : CAUSAS,
    meta: Number.isFinite(c.meta) ? c.meta : 80,
  };
}

export default route(["GET", "POST"], async (req, res) => {
  const me = await requireUser(req);

  if (req.method === "GET") {
    const [cfg, acts, plan, hitos] = await Promise.all([config(), hgetallJson(ACTS()), hgetallJson(PLAN()), hgetallJson(HITOS())]);
    res.status(200).json({ config: cfg, tipos: TIPOS, actividades: Object.values(acts), plan: Object.values(plan), hitos: Object.values(hitos) });
    return;
  }

  const b = await readJson(req);
  const out = { ok: true };

  switch (b.action) {
    case "config": {
      pedirPlan(me);
      const c = await config();
      if (b.modo !== undefined) c.modo = b.modo === "takt" ? "takt" : "zonas";
      if (b.ubicaciones !== undefined) c.ubicaciones = lista(b.ubicaciones, 200, 60);
      if (b.causas !== undefined) c.causas = lista(b.causas, 30, 60);
      if (b.meta !== undefined) {
        const m = Number(b.meta);
        if (!Number.isFinite(m) || m < 1 || m > 100) throw new HttpError(400, "La meta de PPC debe estar entre 1 y 100.");
        c.meta = Math.round(m);
      }
      await setJson(CONFIG(), c);
      out.config = c;
      break;
    }

    case "act-guardar": {
      pedirPlan(me);
      const a = b.act || {};
      const prev = a.id ? await hgetJson(ACTS(), String(a.id)) : null;
      if (a.id && !prev) throw new HttpError(404, "La actividad ya no existe.");
      const ini = semana(a.semanaIni, "Inicio"), fin = semana(a.semanaFin || a.semanaIni, "Fin");
      if (fin < ini) throw new HttpError(400, "La semana de fin es anterior a la de inicio.");
      const act = {
        ...(prev || { id: id(), restricciones: [], creada: firma(me) }),
        partida: upper(a.partida, 60, "La partida"),
        contratista: upper(a.contratista, 60, "El contratista"),
        ubicacion: cleanText(a.ubicacion, 60, "La ubicación", { required: true }),
        eje: cleanText(a.eje, 30, "El eje"),
        descripcion: cleanText(a.descripcion, 300, "La descripción"),
        semanaIni: ini, semanaFin: fin,
        guids: (Array.isArray(a.guids) ? a.guids : []).map(String).filter((g) => URN_GUID.test(g)).slice(0, 2000),
        actualizada: firma(me),
      };
      if (!act.partida && !act.descripcion) throw new HttpError(400, "Escribe la partida o una descripción.");
      await hsetJson(ACTS(), { [act.id]: act });
      out.actividad = act;
      break;
    }

    case "act-borrar": {
      pedirPlan(me);
      const aid = String(b.id || "");
      const plan = await hgetallJson(PLAN());
      if (Object.values(plan).some((p) => p.actId === aid && p.res)) throw new HttpError(409, "La actividad ya tiene compromisos calificados; no se puede borrar.");
      await hdel(ACTS(), aid);
      for (const [k, p] of Object.entries(plan)) if (p.actId === aid) await hdel(PLAN(), k);
      break;
    }

    case "restr-agregar":
    case "restr-liberar": {
      const act = await hgetJson(ACTS(), String(b.actId || ""));
      if (!act) throw new HttpError(404, "La actividad ya no existe.");
      const esDueño = me.rol === "contratista" && me.contratista === act.contratista;
      if (b.action === "restr-agregar") {
        if (me.rol === "contratista" && !esDueño) throw new HttpError(403, "Solo puedes agregar restricciones a tus actividades.");
        const r = {
          id: id(),
          texto: cleanText(b.texto, 300, "La restricción", { required: true }),
          tipo: TIPOS.includes(b.tipo) ? b.tipo : "Otro",
          responsable: cleanText(b.responsable, 60, "El responsable"),
          fecha: /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha || "")) ? b.fecha : "",
          estado: "abierta", creada: firma(me),
        };
        act.restricciones = [...(act.restricciones || []), r].slice(-100);
        out.restriccion = r;
      } else {
        if (!(can(me, "planear") || can(me, "calificar") || can(me, "validar") || esDueño)) throw new HttpError(403, "Tu rol no puede liberar restricciones.");
        const r = (act.restricciones || []).find((x) => x.id === b.restrId);
        if (!r) throw new HttpError(404, "La restricción ya no existe.");
        r.estado = "liberada"; r.liberada = firma(me);
      }
      await hsetJson(ACTS(), { [act.id]: act });
      out.actividad = act;
      break;
    }

    case "plan-agregar":
    case "plan-quitar": {
      pedirPlan(me);
      const sem = semana(b.semana, "Semana");
      const act = await hgetJson(ACTS(), String(b.actId || ""));
      if (!act) throw new HttpError(404, "La actividad ya no existe.");
      const k = sem + "|" + act.id;
      const prev = await hgetJson(PLAN(), k);
      if (b.action === "plan-quitar") {
        if (prev && prev.res) throw new HttpError(409, "Ese compromiso ya fue calificado; no se puede quitar.");
        await hdel(PLAN(), k);
        break;
      }
      if (prev && prev.res) throw new HttpError(409, "Ese compromiso ya fue calificado.");
      const p = { semana: sem, actId: act.id, contratista: act.contratista, meta: cleanText(b.meta, 200, "El compromiso"), ...firma(me), res: null, sup: null };
      await hsetJson(PLAN(), { [k]: p });
      out.compromiso = p;
      break;
    }

    case "calificar":
    case "validar": {
      const sem = semana(b.semana, "Semana");
      const k = sem + "|" + String(b.actId || "");
      const p = await hgetJson(PLAN(), k);
      if (!p) throw new HttpError(404, "Ese compromiso no está en el plan semanal.");
      const cfg = await config();
      if (b.action === "calificar") {
        if (!can(me, "calificar")) throw new HttpError(403, "Solo el residente califica el plan semanal.");
        if (p.sup && p.sup.estado === "validado") throw new HttpError(409, "El superintendente ya validó este compromiso.");
        const cumplido = Boolean(b.cumplido);
        const causa = cumplido ? "" : cleanText(b.causa, 60, "La causa", { required: true });
        if (!cumplido && !cfg.causas.includes(causa)) throw new HttpError(400, "Elige una causa de la lista.");
        p.res = { cumplido, causa, comentario: cleanText(b.comentario, 300, "El comentario"), ...firma(me) };
        p.sup = null; // si estaba regresado, vuelve a esperar al superintendente
      } else {
        if (!can(me, "validar")) throw new HttpError(403, "Solo el superintendente valida el plan semanal.");
        if (!p.res) throw new HttpError(409, "Primero lo debe calificar el residente.");
        const ok = Boolean(b.ok);
        const comentario = cleanText(b.comentario, 300, "El comentario", { required: !ok });
        p.sup = { estado: ok ? "validado" : "regresado", comentario, ...firma(me) };
      }
      await hsetJson(PLAN(), { [k]: p });
      out.compromiso = p;
      break;
    }

    case "hito-guardar": {
      pedirPlan(me);
      const h = b.hito || {};
      const prev = h.id ? await hgetJson(HITOS(), String(h.id)) : null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(h.fecha || ""))) throw new HttpError(400, "Pon la fecha del hito.");
      const hito = { ...(prev || { id: id(), tarjetas: [], creado: firma(me) }), nombre: cleanText(h.nombre, 120, "El nombre del hito", { required: true }), fecha: h.fecha };
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.hito = hito;
      break;
    }

    case "hito-borrar": {
      pedirPlan(me);
      await hdel(HITOS(), String(b.id || ""));
      break;
    }

    case "tarjeta-guardar":
    case "tarjeta-borrar": {
      const hito = await hgetJson(HITOS(), String(b.hitoId || ""));
      if (!hito) throw new HttpError(404, "El hito ya no existe.");
      const t = b.action === "tarjeta-guardar" ? b.tarjeta || {} : { id: b.id };
      const prev = t.id ? (hito.tarjetas || []).find((x) => x.id === t.id) : null;
      if (t.id && !prev) throw new HttpError(404, "La tarjeta ya no existe.");
      const propia = (c) => me.rol === "contratista" && c === me.contratista;
      if (!can(me, "planear") && !(prev ? propia(prev.contratista) : me.rol === "contratista")) throw new HttpError(403, "Solo puedes mover tus tarjetas.");
      if (prev && prev.actId) throw new HttpError(409, "Esa tarjeta ya pasó al look-ahead.");
      if (b.action === "tarjeta-borrar") {
        hito.tarjetas = hito.tarjetas.filter((x) => x.id !== t.id);
      } else {
        const contratista = me.rol === "contratista" ? me.contratista : upper(t.contratista, 60, "El contratista");
        if (!contratista) throw new HttpError(400, "Elige el contratista.");
        // Días: a mano (lista de fechas) o automáticos desde el inicio y la duración.
        let dias;
        if (Array.isArray(t.dias) && t.dias.length) {
          dias = [...new Set(t.dias.map(String))].filter((f) => FECHA.test(f) && !isNaN(aFecha(f)));
          if (dias.some((f) => !habil(f))) throw new HttpError(400, "Los domingos no son días de trabajo; mueve ese día.");
          dias.sort();
        } else {
          const dur = Math.round(Number(t.duracion));
          if (!Number.isFinite(dur) || dur < 1 || dur > 300) throw new HttpError(400, "La duración debe ser de 1 a 300 días.");
          let inicio = String(t.inicio || "");
          if (!FECHA.test(inicio)) throw new HttpError(400, "Pon la fecha de inicio.");
          dias = diasHabiles(inicio, dur);
        }
        if (!dias.length || dias.length > 300) throw new HttpError(400, "La tarea debe tener de 1 a 300 días.");
        const tarjeta = {
          ...(prev || { id: id(), creada: firma(me) }),
          contratista,
          entregable: cleanText(t.entregable, 120, "El entregable", { required: true }),
          dias, inicio: dias[0], fin: dias[dias.length - 1], duracion: dias.length,
          semana: semanaDe(dias[dias.length - 1]), // semana de entrega
          entregaA: cleanText(t.entregaA, 60, "Entrega a"),
          necesita: cleanText(t.necesita, 300, "Lo que necesita"),
          ubicacion: cleanText(t.ubicacion, 60, "La ubicación"),
          partida: upper(t.partida, 60, "La partida"),
          ...(await ligarPiezas(t.marcas, t.guids)),
          actualizada: firma(me),
        };
        hito.tarjetas = prev ? hito.tarjetas.map((x) => (x.id === prev.id ? tarjeta : x)) : [...(hito.tarjetas || []), tarjeta].slice(-300);
        out.tarjeta = tarjeta;
      }
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.hito = hito;
      break;
    }

    case "pasar": {
      pedirPlan(me);
      const hito = await hgetJson(HITOS(), String(b.hitoId || ""));
      if (!hito) throw new HttpError(404, "El hito ya no existe.");
      const nuevas = {};
      for (const t of hito.tarjetas || []) {
        if (t.actId) continue;
        const act = {
          id: id(), restricciones: [], creada: firma(me), actualizada: firma(me),
          partida: t.partida, contratista: t.contratista, ubicacion: t.ubicacion || hito.nombre, eje: "",
          descripcion: t.entregable + (t.entregaA ? " · entrega a " + t.entregaA : ""),
          semanaIni: semanaDe(diasDeTarjeta(t)[0] || t.inicio), semanaFin: t.semana, guids: t.guids || [], origen: { hito: hito.id, tarjeta: t.id },
        };
        if (t.necesita) act.restricciones.push({ id: id(), texto: t.necesita, tipo: "Otro", responsable: t.contratista, fecha: "", estado: "abierta", creada: firma(me) });
        nuevas[act.id] = act;
        t.actId = act.id;
      }
      await hsetJson(ACTS(), nuevas);
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.creadas = Object.keys(nuevas).length;
      out.hito = hito;
      break;
    }

    default:
      throw new HttpError(400, "Acción no reconocida.");
  }
  res.status(200).json(out);
});
