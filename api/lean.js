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
//     quitar-piezas   {hitoId, quitar:[{tarId, guids[]}]}               desasigna piezas (repetidas) de tarjetas;
//                     si la pieza venía por marca se quita esa marca     PM / admin; contratista: solo sus tarjetas
//     pasar           {hitoId}                                          PM / admin: tarjetas → actividades del look-ahead
//                     (una tarjeta que salió del look-ahead actualiza su actividad en vez de crear otra)
//     takt-importar   {ubicaciones[], acts:[{clave, partida, contratista, ubicacion, descripcion, semanaIni, semanaFin}], hitos:[{nombre, fecha}]}
//                     PM / admin: carga el takt plan (Excel) al look-ahead. Volver a importar actualiza por «clave»
//                     y quita lo que ya no está en el plan (si no tiene compromisos calificados).
//     act-duplicar    {id}                                              PM / admin: copia de la actividad (sin compromisos)
//     tarjeta-duplicar {hitoId, id}                                     copia de la tarjeta en el mismo hito (sin liga al look-ahead)
//     restaurar       {id}                                              PM / admin: regresa algo borrado desde la papelera
//                     (lo borrado se guarda 30 días; GET lo devuelve en «papelera» a quien puede planear)
//     pull-desde-plan {hitoId}                                          PM / admin: tarjetas de la sesión pull a partir de las
//                     actividades del look-ahead que terminan antes del hito y aún no acaban
import crypto from "node:crypto";
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { key, getJson, setJson, hgetJson, hgetallJson, hmgetJson, hsetJson, hdel } from "../lib/store.js";
import { requireUser, can } from "../lib/users.js";

const CONFIG = () => key("lean", "config");
const ACTS = () => key("lean", "act");
const PLAN = () => key("lean", "plan");
const HITOS = () => key("lean", "hitos");
const PAPELERA = () => key("lean", "papelera");
const AVANCE = () => key("avance");
const DIAS_PAPELERA = 30;
async function aPapelera(me, item) {
  const lim = Date.now() - DIAS_PAPELERA * 864e5;
  const lista = ((await getJson(PAPELERA())) || []).filter((x) => Date.parse(x.borrado.at) > lim);
  lista.unshift({ id: id(), ...item, borrado: firma(me) });
  await setJson(PAPELERA(), lista.slice(0, 100));
}
async function papelera() {
  const lim = Date.now() - DIAS_PAPELERA * 864e5;
  return ((await getJson(PAPELERA())) || []).filter((x) => Date.parse(x.borrado.at) > lim);
}

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
export function lunesDe(sem) {
  const m = /^(\d{4})-W(\d{2})$/.exec(sem), d = new Date(Date.UTC(+m[1], 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1) + (+m[2] - 1) * 7);
  return deFecha(d);
}
const semanasEntre = (a, b) => Math.round((aFecha(lunesDe(b)) - aFecha(lunesDe(a))) / (7 * 86400000)) + 1;
// Tarjetas anteriores sin días: se acomodan desde el lunes de su semana.
export function diasDeTarjeta(t) {
  if (Array.isArray(t.dias) && t.dias.length) return t.dias;
  if (!t.semana) return [];
  const m = /^(\d{4})-W(\d{2})$/.exec(t.semana), d = new Date(Date.UTC(+m[1], 0, 4));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() || 7) - 1) + (+m[2] - 1) * 7);
  return diasHabiles(deFecha(d), t.duracion || 1);
}

// ---- Cumplimiento automático por el avance del modelo ----
// Un compromiso del plan semanal cuya actividad tiene piezas ligadas se califica solo con el estatus que esas piezas
// tienen en Control de obra: se cumple si todas quedaron terminadas a más tardar el domingo de su semana; si la semana
// termina y falta alguna, no se cumple. Lo que el residente califica a mano o el superintendente ya validó no se toca.
const TERMINADO = ["Terminado", "Estimado", "Pagado"];
export const CAUSA_AUTO = "Elementos sin terminar";
function fechaTerminado(rec) {
  if (!rec || !TERMINADO.includes(rec.estatus)) return null;
  const ev = (rec.hist || []).filter((e) => e.accion === "reporta" && e.estatus === "Terminado").pop();
  return ev ? Date.parse(ev.at) : (rec.at ? Date.parse(rec.at) : 0);
}
function pctPieza(rec) {
  if (!rec) return 0;
  if (TERMINADO.includes(rec.estatus)) return 100;
  if (rec.estatus === "En ejecución") return Math.max(0, Math.min(100, Number(rec.pct) || 0));
  return 0;
}
// Fin de la semana: domingo 23:59 hora del centro de México (lunes 06:00 UTC).
const finSemana = (sem) => Date.parse(lunesDe(sem) + "T00:00:00Z") + 7 * 864e5 + 6 * 36e5;
export function evaluarAuto(p, act, avance, ahoraMs = Date.now()) {
  const guids = (act && act.guids) || [];
  if (!guids.length) return null;
  const fin = finSemana(p.semana);
  let hechas = 0, suma = 0;
  for (const g of guids) {
    const rec = avance[g], f = fechaTerminado(rec);
    if (f != null && f < fin) hechas++;
    suma += f != null && f >= fin ? 99 : pctPieza(rec); // terminada después de su semana: no cuenta como a tiempo
  }
  const info = { hechas, total: guids.length, pct: Math.round(suma / guids.length), cerrada: ahoraMs >= fin };
  info.cumplido = hechas === guids.length ? true : info.cerrada ? false : null; // null = la semana sigue en curso
  return info;
}
async function aplicarAuto(planObj, acts) {
  const ps = Object.entries(planObj).filter(([, p]) => acts[p.actId] && (acts[p.actId].guids || []).length);
  if (!ps.length) return;
  const guids = [...new Set(ps.flatMap(([, p]) => acts[p.actId].guids))];
  const recs = guids.length ? await hmgetJson(AVANCE(), guids) : [];
  const avance = {}; guids.forEach((g, i) => { if (recs[i]) avance[g] = recs[i]; });
  const cambios = {};
  for (const [k, p] of ps) {
    const info = evaluarAuto(p, acts[p.actId], avance);
    p.auto = { hechas: info.hechas, total: info.total, pct: info.pct };
    if (p.sup && p.sup.estado === "validado") continue; // ya es oficial
    if (p.res && !p.res.auto) continue; // el residente lo calificó a mano
    const antes = JSON.stringify(p.res || null);
    if (info.cumplido === null) p.res = null;
    else p.res = { cumplido: info.cumplido, causa: info.cumplido ? "" : CAUSA_AUTO, comentario: info.hechas + " de " + info.total + " elementos terminados en su semana",
      auto: true, por: "Avance del modelo", at: p.res && p.res.auto && p.res.cumplido === info.cumplido ? p.res.at : new Date().toISOString() };
    if (JSON.stringify(p.res || null) !== antes) { const { auto, ...guardar } = p; cambios[k] = guardar; }
  }
  if (Object.keys(cambios).length) await hsetJson(PLAN(), cambios);
}

// Piezas de una tarjeta, EN ORDEN DE EJECUCIÓN: primero las de las marcas en el orden escrito
// (el orden en que se seleccionaron), luego las elegidas en el modelo que no tienen marca.
// Ajuste manual de en qué días de la tarea se ejecuta cada pieza: {guid: [díaIni, díaFin]} (1 = primer día
// de la tarea). Las piezas sin ajuste se reparten solas. Se recorta a la duración y a las piezas de la tarjeta.
function limpiarReparto(rep, guids, n) {
  const out = {};
  if (!rep || typeof rep !== "object") return out;
  const tiene = new Set(guids || []);
  for (const [g, r] of Object.entries(rep).slice(0, 2000)) {
    if (!tiene.has(g) || !Array.isArray(r)) continue;
    let a = Math.round(Number(r[0])), b = Math.round(Number(r[1]));
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    a = Math.min(Math.max(a, 1), n); b = Math.min(Math.max(b, 1), n);
    out[g] = a <= b ? [a, b] : [b, a];
  }
  return out;
}

async function ligarPiezas(marcasIn, guidsIn) {
  const marcas = [...new Set((Array.isArray(marcasIn) ? marcasIn : String(marcasIn || "").split(/[,;\n]+/))
    .map((x) => String(x).trim().toUpperCase()).filter(Boolean))].slice(0, 300);
  // Primero las piezas en el orden en que se eligieron (orden de montaje); después las de las marcas
  // escritas que aún no estén, en el orden escrito.
  const orden = [];
  for (const g of (Array.isArray(guidsIn) ? guidsIn : []).map(String)) if (URN_GUID.test(g)) orden.push(g);
  if (marcas.length) {
    const cat = (await getJson(key("piezas", "catalogo"))) || { piezas: {} };
    const porMarca = {};
    for (const [g, p] of Object.entries(cat.piezas || {})) {
      const m = String(p.marca || "").toUpperCase();
      if (marcas.includes(m)) (porMarca[m] = porMarca[m] || []).push(g);
    }
    for (const m of marcas) for (const g of porMarca[m] || []) orden.push(g);
  }
  return { marcas, guids: [...new Set(orden)].slice(0, 2000) };
}

function lista(v, max, maxLen) {
  return (Array.isArray(v) ? v : []).map((x) => String(x).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, maxLen)).filter(Boolean).slice(0, max);
}
const upper = (v, max, name) => cleanText(v, max, name).toUpperCase();
const lista2 = (arr) => [...new Set(arr.map((x) => String(x || "").trim()).filter(Boolean))].slice(0, 200).map((x) => x.slice(0, 60));
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
    await aplicarAuto(plan, acts);
    const out = { config: cfg, tipos: TIPOS, actividades: Object.values(acts), plan: Object.values(plan), hitos: Object.values(hitos) };
    if (can(me, "planear")) out.papelera = await papelera();
    res.status(200).json(out);
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
      const act = await hgetJson(ACTS(), aid);
      if (act) await aPapelera(me, { tipo: "actividad", act, plan: Object.values(plan).filter((p) => p.actId === aid) });
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
      const hito = {
        ...(prev || { id: id(), tarjetas: [], creado: firma(me) }),
        nombre: cleanText(h.nombre, 120, "El nombre del hito", { required: true }), fecha: h.fecha,
        // Zonas que abarca el hito: sirven para detectar piezas que ninguna tarjeta cubre.
        alcance: lista(Array.isArray(h.alcance) ? h.alcance : String(h.alcance || "").split(/[,;\n]+/), 50, 60),
      };
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.hito = hito;
      break;
    }

    case "hito-borrar": {
      pedirPlan(me);
      const h = await hgetJson(HITOS(), String(b.id || ""));
      if (h) await aPapelera(me, { tipo: "hito", hito: h });
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
        await aPapelera(me, { tipo: "tarjeta", hitoId: hito.id, hitoNombre: hito.nombre, tarjeta: prev });
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
        tarjeta.reparto = limpiarReparto(t.reparto, tarjeta.guids, dias.length);
        hito.tarjetas = prev ? hito.tarjetas.map((x) => (x.id === prev.id ? tarjeta : x)) : [...(hito.tarjetas || []), tarjeta].slice(-300);
        out.tarjeta = tarjeta;
      }
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.hito = hito;
      break;
    }

    case "quitar-piezas": {
      const hito = await hgetJson(HITOS(), String(b.hitoId || ""));
      if (!hito) throw new HttpError(404, "El hito ya no existe.");
      const pedidos = Array.isArray(b.quitar) ? b.quitar.slice(0, 300) : [];
      if (!pedidos.length) throw new HttpError(400, "No hay piezas que quitar.");
      const cat = (await getJson(key("piezas", "catalogo"))) || { piezas: {} };
      const marcaDe = (g) => String((cat.piezas[g] && cat.piezas[g].marca) || "").toUpperCase();
      let cambiadas = 0;
      for (const q of pedidos) {
        const t = (hito.tarjetas || []).find((x) => x.id === q.tarId);
        if (!t) continue;
        if (!can(me, "planear") && !(me.rol === "contratista" && t.contratista === me.contratista)) throw new HttpError(403, "Solo puedes cambiar tus tarjetas.");
        if (t.actId) throw new HttpError(409, `«${t.entregable}» ya pasó al look-ahead; quita las piezas desde la actividad.`);
        const fuera = new Set((Array.isArray(q.guids) ? q.guids : []).map(String));
        if (!fuera.size) continue;
        // Las piezas que venían por marca se quitan quitando la marca; las sueltas, quitando la pieza.
        const marcasFuera = new Set([...fuera].map(marcaDe).filter(Boolean));
        const marcas = (t.marcas || []).filter((m) => !marcasFuera.has(String(m).toUpperCase()));
        // Se conserva el orden de montaje de las que se quedan.
        const sueltas = (t.guids || []).filter((g) => !fuera.has(g) && !marcasFuera.has(marcaDe(g)));
        Object.assign(t, await ligarPiezas(marcas, sueltas), { actualizada: firma(me) });
        t.reparto = limpiarReparto(t.reparto, t.guids, (t.dias || []).length || t.duracion || 1);
        cambiadas++;
      }
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.cambiadas = cambiadas;
      out.hito = hito;
      break;
    }

    case "pasar": {
      pedirPlan(me);
      const hito = await hgetJson(HITOS(), String(b.hitoId || ""));
      if (!hito) throw new HttpError(404, "El hito ya no existe.");
      const nuevas = {};
      const actsPrev = await hgetallJson(ACTS());
      for (const t of hito.tarjetas || []) {
        if (t.actId) continue;
        // Si la tarjeta salió del look-ahead, se actualiza esa actividad con lo acordado en la sesión.
        if (t.deAct && actsPrev[t.deAct]) {
          const a = actsPrev[t.deAct];
          Object.assign(a, { semanaIni: semanaDe(diasDeTarjeta(t)[0] || t.inicio), semanaFin: t.semana, actualizada: firma(me) });
          if ((t.guids || []).length) a.guids = t.guids;
          if (t.necesita && !(a.restricciones || []).some((r) => r.texto === t.necesita)) (a.restricciones = a.restricciones || []).push({ id: id(), texto: t.necesita, tipo: "Otro", responsable: t.contratista, fecha: "", estado: "abierta", creada: firma(me) });
          nuevas[a.id] = a; t.actId = a.id;
          continue;
        }
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

    case "act-duplicar": {
      pedirPlan(me);
      const a = await hgetJson(ACTS(), String(b.id || ""));
      if (!a) throw new HttpError(404, "La actividad ya no existe.");
      const copia = {
        ...a, id: id(), creada: firma(me), actualizada: firma(me),
        descripcion: ((a.descripcion || a.partida || "") + " (copia)").slice(0, 300),
        // Sin la clave del takt plan: reimportar el Excel no la toca. Las restricciones abiertas se copian como nuevas.
        restricciones: (a.restricciones || []).filter((r) => r.estado !== "liberada").map((r) => ({ ...r, id: id(), creada: firma(me) })),
      };
      delete copia.takt;
      await hsetJson(ACTS(), { [copia.id]: copia });
      out.actividad = copia;
      break;
    }

    case "tarjeta-duplicar": {
      const hito = await hgetJson(HITOS(), String(b.hitoId || ""));
      if (!hito) throw new HttpError(404, "El hito ya no existe.");
      const t = (hito.tarjetas || []).find((x) => x.id === String(b.id || ""));
      if (!t) throw new HttpError(404, "La tarjeta ya no existe.");
      if (!can(me, "planear") && !(me.rol === "contratista" && t.contratista === me.contratista)) throw new HttpError(403, "Solo puedes copiar tus tarjetas.");
      const copia = { ...JSON.parse(JSON.stringify(t)), id: id(), creada: firma(me), actualizada: firma(me), entregable: (t.entregable + " (copia)").slice(0, 120) };
      delete copia.actId; delete copia.deAct; // la copia es nueva: no está ligada al look-ahead
      if ((hito.tarjetas || []).length >= 300) throw new HttpError(409, "El hito ya tiene 300 tarjetas.");
      hito.tarjetas = [...(hito.tarjetas || []), copia];
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.tarjeta = copia; out.hito = hito;
      break;
    }

    case "restaurar": {
      pedirPlan(me);
      const lista = (await getJson(PAPELERA())) || [];
      const x = lista.find((y) => y.id === String(b.id || ""));
      if (!x) throw new HttpError(404, "Eso ya no está en la papelera.");
      if (x.tipo === "actividad") {
        const ya = await hgetJson(ACTS(), x.act.id);
        const act = ya ? { ...x.act, id: id() } : x.act;
        await hsetJson(ACTS(), { [act.id]: act });
        const pl = {};
        for (const p of x.plan || []) pl[p.semana + "|" + act.id] = { ...p, actId: act.id };
        if (Object.keys(pl).length) await hsetJson(PLAN(), pl);
        out.actividad = act;
      } else if (x.tipo === "tarjeta") {
        const hito = await hgetJson(HITOS(), x.hitoId);
        if (!hito) throw new HttpError(409, "El hito de esa tarjeta ya no existe; restaura primero el hito.");
        const t = (hito.tarjetas || []).some((y) => y.id === x.tarjeta.id) ? { ...x.tarjeta, id: id() } : x.tarjeta;
        hito.tarjetas = [...(hito.tarjetas || []), t];
        await hsetJson(HITOS(), { [hito.id]: hito });
        out.tarjeta = t; out.hito = hito;
      } else if (x.tipo === "hito") {
        const h = (await hgetJson(HITOS(), x.hito.id)) ? { ...x.hito, id: id() } : x.hito;
        await hsetJson(HITOS(), { [h.id]: h });
        out.hito = h;
      } else throw new HttpError(400, "No se puede restaurar eso.");
      await setJson(PAPELERA(), lista.filter((y) => y.id !== x.id));
      break;
    }

    case "takt-importar": {
      pedirPlan(me);
      const lista = Array.isArray(b.acts) ? b.acts.slice(0, 3000) : [];
      if (!lista.length) throw new HttpError(400, "El takt plan no trae actividades.");
      const prev = await hgetallJson(ACTS());
      const porClave = {};
      for (const a of Object.values(prev)) if (a.takt) porClave[a.takt] = a;
      const nuevas = {}, vistas = new Set();
      for (const a of lista) {
        const clave = cleanText(a.clave, 120, "La clave", { required: true });
        if (vistas.has(clave)) continue;
        vistas.add(clave);
        const ini = semana(a.semanaIni, "Inicio"), fin = semana(a.semanaFin || a.semanaIni, "Fin");
        const ant = porClave[clave];
        nuevas[(ant && ant.id) || id()] = {
          ...(ant || { restricciones: [], guids: [], creada: firma(me) }),
          id: (ant && ant.id) || undefined,
          takt: clave,
          partida: upper(a.partida, 60, "La partida"),
          contratista: upper(a.contratista, 60, "El contratista"),
          ubicacion: cleanText(a.ubicacion, 60, "La ubicación", { required: true }),
          eje: (ant && ant.eje) || "",
          descripcion: cleanText(a.descripcion, 300, "La descripción"),
          semanaIni: ini, semanaFin: fin < ini ? ini : fin,
          actualizada: firma(me),
        };
      }
      for (const [k, v] of Object.entries(nuevas)) v.id = k;
      await hsetJson(ACTS(), nuevas);
      // Lo que ya no está en el plan se quita, salvo que tenga compromisos calificados (no en una carga parcial).
      const plan = await hgetallJson(PLAN());
      let quitadas = 0;
      for (const a of b.parcial ? [] : Object.values(prev)) {
        if (!a.takt || vistas.has(a.takt)) continue;
        if (Object.values(plan).some((p) => p.actId === a.id && p.res)) continue;
        await aPapelera(me, { tipo: "actividad", act: a, plan: Object.values(plan).filter((p) => p.actId === a.id) });
        await hdel(ACTS(), a.id);
        for (const [k, p] of Object.entries(plan)) if (p.actId === a.id) await hdel(PLAN(), k);
        quitadas++;
      }
      // Áreas takt y modo takt.
      const c = await config();
      if (Array.isArray(b.ubicaciones) && b.ubicaciones.length) {
        c.ubicaciones = lista2(c.ubicaciones.concat(b.ubicaciones));
        c.modo = "takt";
        await setJson(CONFIG(), c);
      }
      // Hitos del plan (por nombre; no se tocan sus tarjetas).
      const hs = await hgetallJson(HITOS());
      const hNuevos = {};
      for (const h of (Array.isArray(b.hitos) ? b.hitos : []).slice(0, 50)) {
        const nombre = cleanText(h.nombre, 80, "El nombre del hito", { required: true });
        const fecha = String(h.fecha || "");
        if (!FECHA.test(fecha)) continue;
        const ant = Object.values(hs).find((x) => x.nombre === nombre);
        const x = ant ? { ...ant, fecha } : { id: id(), nombre, fecha, tarjetas: [], creado: firma(me) };
        hNuevos[x.id] = x;
      }
      if (Object.keys(hNuevos).length) await hsetJson(HITOS(), hNuevos);
      out.importadas = Object.keys(nuevas).length;
      out.quitadas = quitadas;
      out.hitos = Object.keys(hNuevos).length;
      out.config = c;
      break;
    }

    case "pull-desde-plan": {
      pedirPlan(me);
      const hito = await hgetJson(HITOS(), String(b.hitoId || ""));
      if (!hito) throw new HttpError(404, "El hito ya no existe.");
      const semHito = semanaDe(hito.fecha), hoy = semanaDe(deFecha(new Date()));
      const acts = Object.values(await hgetallJson(ACTS()));
      const yaTiene = new Set((hito.tarjetas || []).map((t) => t.deAct).filter(Boolean));
      let creadas = 0;
      for (const a of acts.sort((x, y) => (x.semanaIni < y.semanaIni ? -1 : 1))) {
        if (yaTiene.has(a.id) || a.semanaFin > semHito || a.semanaFin < hoy) continue;
        // Desde el lunes de su semana (o desde hoy si ya empezó), seis días hábiles por semana.
        let inicio = lunesDe(a.semanaIni > hoy ? a.semanaIni : hoy);
        if (a.semanaIni <= hoy) inicio = deFecha(new Date(Math.max(aFecha(inicio), aFecha(deFecha(new Date())))));
        if (!habil(inicio)) inicio = diasHabiles(inicio, 2)[1] || inicio;
        const dur = Math.max(1, semanasEntre(a.semanaIni > hoy ? a.semanaIni : hoy, a.semanaFin) * 6);
        const dias = diasHabiles(inicio, Math.min(dur, 120));
        (hito.tarjetas = hito.tarjetas || []).push({
          id: id(), contratista: a.contratista || "", entregable: a.descripcion || a.partida, partida: a.partida || "",
          ubicacion: a.ubicacion || "", entregaA: "", necesita: (a.restricciones || []).filter((r) => r.estado !== "liberada").map((r) => r.texto).join("; ").slice(0, 300),
          inicio: dias[0], duracion: dias.length, dias, semana: semanaDe(dias[dias.length - 1]),
          guids: a.guids || [], marcas: [], deAct: a.id, creada: firma(me),
        });
        creadas++;
      }
      await hsetJson(HITOS(), { [hito.id]: hito });
      out.creadas = creadas;
      out.hito = hito;
      break;
    }

    default:
      throw new HttpError(400, "Acción no reconocida.");
  }
  res.status(200).json(out);
});
