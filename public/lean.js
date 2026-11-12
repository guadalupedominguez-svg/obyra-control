// OBYRA Control · módulo Lean: Dashboard (PPC), Look-ahead de 6 semanas con plan semanal, y Sesión Pull.
// Usa el visor, la sesión y las utilidades de app.js a través de window.OBYRA.
(function () {
  "use strict";
  var O = window.OBYRA;
  if (!O) return;
  var $ = O.$, el = O.el, api = O.api, toast = O.toast, S = O.S, f2 = O.f2;

  // ---------- Semanas ISO (lunes a domingo) ----------
  function isoSemana(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var dia = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dia);
    var ini = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    var n = Math.ceil(((t - ini) / 86400000 + 1) / 7);
    return t.getUTCFullYear() + "-W" + (n < 10 ? "0" : "") + n;
  }
  function lunes(sem) {
    var m = /^(\d{4})-W(\d{2})$/.exec(sem), y = +m[1], w = +m[2];
    var d = new Date(Date.UTC(y, 0, 4));
    var dia = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - dia + 1 + (w - 1) * 7);
    return d;
  }
  function sumar(sem, n) { var d = lunes(sem); d.setUTCDate(d.getUTCDate() + 7 * n + 3); return isoSemana(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); }
  var MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  function rango(sem) {
    var a = lunes(sem), b = new Date(a); b.setUTCDate(b.getUTCDate() + 6);
    return a.getUTCDate() + (a.getUTCMonth() !== b.getUTCMonth() ? " " + MES[a.getUTCMonth()] : "") + "–" + b.getUTCDate() + " " + MES[b.getUTCMonth()];
  }
  var corta = function (sem) { return "S" + +sem.slice(6); };
  var HOY = isoSemana(new Date());
  var hoyISO = function () { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  // ---------- Estado ----------
  var L = { cfg: null, tipos: [], acts: [], plan: [], hitos: [], semana: HOY, tab: null, hitoId: "", contr: "", resaltar: true, act: null, tar: null, cargado: false };
  var P = function (k) { return !!(S.permisos && S.permisos[k]); };
  var esContratista = function () { return S.me && S.me.rol === "contratista"; };
  var C_LEAN = { comp: "#22D3EE", ok: "#2BD483", bad: "#F2616A", restr: "#F5B83D", lista: "#3B82F6" };
  var PALETA = ["#3B82F6", "#A78BFA", "#F472B6", "#F59E0B", "#2BD483", "#22D3EE", "#F2616A", "#94A3B8"];
  function colorDe(c) {
    var lista = contratistas();
    var i = lista.indexOf(c);
    return i < 0 ? "#5B6B85" : PALETA[i % PALETA.length];
  }
  function contratistas() {
    var s = new Set();
    Object.values(S.piezas || {}).forEach(function (p) { if (p.contratista) s.add(p.contratista); });
    L.acts.forEach(function (a) { if (a.contratista) s.add(a.contratista); });
    L.hitos.forEach(function (h) { (h.tarjetas || []).forEach(function (t) { s.add(t.contratista); }); });
    return Array.from(s).sort();
  }
  function ubicaciones() {
    var s = (L.cfg && L.cfg.ubicaciones.slice()) || [];
    if (!s.length) Object.values(S.piezas || {}).forEach(function (p) { if (p.zona && s.indexOf(p.zona) < 0) s.push(p.zona); });
    L.acts.forEach(function (a) { if (a.ubicacion && s.indexOf(a.ubicacion) < 0) s.push(a.ubicacion); });
    return s;
  }
  var abiertas = function (a) { return (a.restricciones || []).filter(function (r) { return r.estado !== "liberada"; }); };
  var enSemana = function (a, sem) { return a.semanaIni <= sem && sem <= a.semanaFin; };
  var compromiso = function (sem, actId) { return L.plan.find(function (p) { return p.semana === sem && p.actId === actId; }) || null; };
  var actPorId = function (id) { return L.acts.find(function (a) { return a.id === id; }) || null; };
  var nombreAct = function (a) { return [a.partida || a.descripcion, a.ubicacion, a.eje].filter(Boolean).join(" · "); };

  function cargar() {
    return api("/api/lean").then(function (r) {
      L.cfg = r.config; L.tipos = r.tipos || []; L.acts = r.actividades || []; L.plan = r.plan || []; L.hitos = (r.hitos || []).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; });
      if (!L.hitos.some(function (h) { return h.id === L.hitoId; })) L.hitoId = L.hitos.length ? L.hitos[0].id : "";
      L.cargado = true;
      render();
    });
  }
  function accion(body, ok) {
    return api("/api/lean", body).then(function (r) { if (ok) toast(ok); return cargar().then(function () { return r; }); })
      .catch(function (e) { toast(e.message, true); throw e; });
  }

  // ---------- Módulo y pestañas ----------
  function ponerModulo(m) {
    S.modulo = m;
    O.qsa("#modulos button").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-mod") === m)); });
    $("app").classList.toggle("lean", m === "lean");
    $("lean-panel").hidden = m !== "lean";
    $("control-panel").hidden = m === "lean";
    try { localStorage.setItem("ctrl_mod", m); } catch (e) { /* nada */ }
    if (m === "lean") {
      leyenda();
      if (!L.cargado) cargar().catch(function (e) { toast(e.message, true); }); else render();
    } else {
      O.renderLegend();
    }
    if (S.viewer) setTimeout(function () { try { S.viewer.resize(); } catch (e) { /* nada */ } }, 60);
    O.paintModel(false);
  }
  function leyenda() {
    var items = [["Comprometido", C_LEAN.comp], ["Cumplido", C_LEAN.ok], ["No cumplido", C_LEAN.bad], ["Con restricción", C_LEAN.restr], ["Lista", C_LEAN.lista]];
    $("legend").replaceChildren.apply($("legend"), items.map(function (x) { return el("span", null, [el("i", { class: "dot", style: "background:" + x[1] }), x[0]]); }));
  }
  function abrirTab(t) {
    var tabs = O.qsa("#ln-tabs .tab");
    if (!tabs.some(function (b) { return b.getAttribute("data-ln") === t; })) t = "la";
    L.tab = t;
    tabs.forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-ln") === t)); });
    O.qsa("[data-lnpane]").forEach(function (p) { p.hidden = p.getAttribute("data-lnpane") !== t; });
    $("ln-semanabar").hidden = t === "pull";
    try { localStorage.setItem("ctrl_ln", t); } catch (e) { /* nada */ }
    render();
  }

  // Colores del modelo según la semana elegida (lo llama paintModel de app.js).
  window.OBYRA_LEAN = {
    colores: function () {
      var out = {};
      if (!L.cargado || L.tab === "pull") return out;
      L.acts.forEach(function (a) {
        if (!enSemana(a, L.semana) || !(a.guids || []).length) return;
        if (L.contr && a.contratista !== L.contr) return;
        var p = compromiso(L.semana, a.id), c;
        if (p && p.res) c = p.res.cumplido ? C_LEAN.ok : C_LEAN.bad;
        else if (p) c = C_LEAN.comp;
        else c = abiertas(a).length ? C_LEAN.restr : C_LEAN.lista;
        a.guids.forEach(function (g) { out[g] = c; });
      });
      return out;
    },
  };

  function render() {
    if (S.modulo !== "lean" || !L.cargado) return;
    $("ln-semana").textContent = corta(L.semana) + " · " + rango(L.semana) + (L.semana === HOY ? " (actual)" : "");
    $("ln-modo").textContent = L.cfg.modo === "takt" ? "Planeación takt" : "Planeación por zonas";
    if (L.tab === "dash") renderDash();
    if (L.tab === "la") renderLA();
    if (L.tab === "pull") renderPull();
    O.paintModel(false);
  }

  // ---------- Dashboard ----------
  function datosSemana(sem) {
    var ps = L.plan.filter(function (p) { return p.semana === sem; });
    var cal = ps.filter(function (p) { return p.res; }), cum = cal.filter(function (p) { return p.res.cumplido; });
    var val = ps.filter(function (p) { return p.sup && p.sup.estado === "validado"; }), reg = ps.filter(function (p) { return p.sup && p.sup.estado === "regresado"; });
    return { total: ps.length, cal: cal.length, cum: cum.length, val: val.length, reg: reg.length, ppc: cal.length ? Math.round(cum.length / cal.length * 100) : null, items: ps };
  }
  function renderDash() {
    var cfg = L.cfg, d = datosSemana(L.semana);
    var semanas = []; for (var i = 7; i >= 0; i--) semanas.push(sumar(L.semana, -i));
    var hist = semanas.map(function (s) { return { s: s, d: datosSemana(s) }; });
    var con = hist.slice(-6).filter(function (x) { return x.d.ppc != null; });
    var prom = con.length ? Math.round(con.reduce(function (a, x) { return a + x.d.ppc; }, 0) / con.length) : null;
    var ventana = []; for (var k = 0; k < 6; k++) ventana.push(sumar(L.semana, k));
    var actsV = L.acts.filter(function (a) { return a.semanaFin >= ventana[0] && a.semanaIni <= ventana[5]; });
    var abiertasV = [], vencidas = 0, hoy = hoyISO();
    actsV.forEach(function (a) { abiertas(a).forEach(function (r) { abiertasV.push(r); if (r.fecha && r.fecha < hoy) vencidas++; }); });
    var listas = L.acts.filter(function (a) { return (enSemana(a, sumar(L.semana, 1)) || enSemana(a, sumar(L.semana, 2))) && !abiertas(a).length; }).length;

    var kpi = function (t, v, s, cls) { return el("div", { class: "ln-kpi" }, [el("small", { text: t }), el("b", { text: v }), el("small", { class: cls || "", text: s })]); };
    var kpis = el("div", { class: "ln-kpis" }, [
      kpi("PPC " + corta(L.semana), d.ppc == null ? "—" : d.ppc + " %", d.total ? d.cum + (d.cum === 1 ? " cumplido" : " cumplidos") + " de " + d.cal + " calificados · meta " + cfg.meta + " %" : "Sin plan semanal", d.ppc != null && d.ppc >= cfg.meta ? "ln-ok" : ""),
      kpi("PPC promedio (6 semanas)", prom == null ? "—" : prom + " %", con.length + (con.length === 1 ? " semana con datos" : " semanas con datos")),
      kpi("Restricciones abiertas", String(abiertasV.length), vencidas ? vencidas + (vencidas === 1 ? " vencida" : " vencidas") : "ninguna vencida", vencidas ? "ln-bad" : ""),
      kpi("Listas para ejecutar", String(listas), "actividades sin restricciones en " + corta(sumar(L.semana, 1)) + "–" + corta(sumar(L.semana, 2))),
    ]);

    var paso = function (t, b, s, ok) { return el("div", { class: "ln-paso " + (ok ? "ok" : "warn") }, [el("small", { text: t }), el("b", { text: b }), el("small", { text: s })]); };
    var cierre = el("div", { class: "ln-card" }, [
      el("div", { class: "ln-head" }, [el("h3", { text: "Cierre de la semana " + corta(L.semana) }), el("small", { class: "muted", text: "El PPC queda oficial cuando el superintendente valida" })]),
      el("div", { class: "ln-pasos" }, [
        paso("1 · Plan semanal · PM", d.total ? d.total + " compromisos" : "Sin plan", d.total ? "establecido por el PM" : "el PM lo arma en Look-ahead", d.total > 0),
        paso("2 · Calificación · Residente", d.cal + " de " + d.total + " calificados", d.cum + " cumplidos · " + (d.cal - d.cum) + " no cumplidos", d.total > 0 && d.cal === d.total),
        paso("3 · Validación · Superintendente", d.val + " de " + d.total + " validados", d.reg ? d.reg + " regresados al residente" : "puede regresar al residente", d.total > 0 && d.val === d.total),
      ]),
    ]);

    var maxH = 120;
    var barras = el("div", { class: "ln-barras", style: "grid-template-columns: repeat(" + hist.length + ", minmax(0, 1fr))" },
      [el("div", { class: "meta", style: "bottom:" + (cfg.meta / 100 * maxH) + "px" })].concat(hist.map(function (x) {
        var v = x.d.ppc, col = v == null ? "transparent" : (v >= cfg.meta ? "#2BD483" : (v >= cfg.meta - 10 ? "#22D3EE" : "#F5B83D"));
        return el("div", { class: "col" }, [el("span", { text: v == null ? "—" : v + "%" }), el("i", { style: "height:" + ((v || 0) / 100 * maxH) + "px;background:" + col })]);
      })));
    var ejeX = el("div", { class: "ln-ejex", style: "grid-template-columns: repeat(" + hist.length + ", minmax(0, 1fr))" }, hist.map(function (x) { return el("span", { text: corta(x.s) }); }));
    var tendencia = el("figure", { class: "ln-card", style: "margin:0" }, [
      el("figcaption", { class: "ln-head" }, [el("h3", { text: "Tendencia del PPC" }), el("small", { class: "muted", text: "8 semanas · línea = meta " + cfg.meta + " %" })]), barras, ejeX]);

    var causas = {};
    hist.slice(-6).forEach(function (x) { x.d.items.forEach(function (p) { if (p.res && !p.res.cumplido) causas[p.res.causa] = (causas[p.res.causa] || 0) + 1; }); });
    var cl = Object.keys(causas).map(function (k) { return [k, causas[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
    var maxC = cl.length ? cl[0][1] : 1;
    var pareto = el("figure", { class: "ln-card", style: "margin:0" }, [
      el("figcaption", { class: "ln-head" }, [el("h3", { text: "Causas de no cumplimiento" }), el("small", { class: "muted", text: "6 semanas · " + cl.reduce(function (a, x) { return a + x[1]; }, 0) + " incumplimientos" })]),
    ].concat(cl.length ? cl.map(function (x) {
      return el("div", { class: "ln-hbar" }, [el("span", { text: x[0] }), el("div", null, [el("i", { style: "width:" + Math.round(x[1] / maxC * 100) + "%" })]), el("span", { style: "text-align:right", text: String(x[1]) })]);
    }) : [el("p", { class: "muted", text: "Sin incumplimientos registrados." })]));

    var filas = contratistas().map(function (c) {
      var ps = d.items.filter(function (p) { return p.contratista === c; });
      var cal = ps.filter(function (p) { return p.res; }), cum = cal.filter(function (p) { return p.res.cumplido; });
      var ppc = cal.length ? Math.round(cum.length / cal.length * 100) : null;
      var h = hist.slice(-6).map(function (x) { var q = x.d.items.filter(function (p) { return p.contratista === c && p.res; }); return q.length ? q.filter(function (p) { return p.res.cumplido; }).length / q.length : null; }).filter(function (v) { return v != null; });
      var r = L.acts.filter(function (a) { return a.contratista === c; }).reduce(function (n, a) { return n + abiertas(a).length; }, 0);
      if (!ps.length && !h.length && !r) return null;
      return el("tr", null, [
        el("td", null, [el("span", { style: "display:inline-flex;align-items:center;gap:8px" }, [el("i", { class: "dot", style: "border-radius:3px;background:" + colorDe(c) }), c])]),
        el("td", { class: "num", text: String(ps.length) }), el("td", { class: "num", text: String(cum.length) }),
        el("td", null, [el("div", { style: "display:flex;align-items:center;gap:8px" }, [el("div", { style: "flex:1;background:#0A0F1A;height:8px;border-radius:4px;min-width:60px" }, [el("div", { style: "height:8px;border-radius:4px;width:" + (ppc || 0) + "%;background:" + (ppc != null && ppc >= L.cfg.meta ? "#2BD483" : "#F5B83D") })]), el("span", { text: ppc == null ? "—" : ppc + " %" })])]),
        el("td", { class: "num", text: h.length ? Math.round(h.reduce(function (a, v) { return a + v; }, 0) / h.length * 100) + " %" : "—" }),
        el("td", { class: "num", text: String(r) }),
      ]);
    }).filter(Boolean);
    var tabla = el("div", { class: "ln-card" }, [
      el("div", { class: "ln-head" }, [el("h3", { text: "PPC por contratista" }), el("small", { class: "muted", text: corta(L.semana) + " y promedio de 6 semanas" })]),
      el("div", { class: "tablewrap" }, [el("table", { class: "tabla ln-tabla" }, [
        el("thead", null, [el("tr", null, ["Contratista", "Compromisos", "Cumplidos", "PPC " + corta(L.semana), "Promedio 6 sem.", "Restricciones abiertas"].map(function (h, i) { return el("th", { class: i === 1 || i === 2 || i >= 4 ? "num" : null, text: h }); }))]),
        el("tbody", null, filas.length ? filas : [el("tr", null, [el("td", { colspan: "6", class: "muted", text: "Todavía no hay plan semanal." })])]),
      ])]),
    ]);
    $("ln-dash").replaceChildren(kpis, cierre, el("div", { class: "ln-2col" }, [tendencia, pareto]), tabla);
  }

  // ---------- Look-ahead ----------
  function renderLA() {
    var semanas = []; for (var i = 0; i < 6; i++) semanas.push(sumar(L.semana, i));
    var cs = contratistas();
    var filtro = el("select", { "aria-label": "Contratista" }, [el("option", { value: "", text: "Todos los contratistas" })].concat(cs.map(function (c) { return el("option", { value: c, text: c }); })));
    filtro.value = L.contr;
    filtro.addEventListener("change", function () { L.contr = filtro.value; render(); });
    var ctrl = [filtro, el("span", { class: "muted", text: corta(semanas[0]) + " – " + corta(semanas[5]) + " · " + rango(semanas[0]).split("–")[0] + " – " + rango(semanas[5]).split("–")[1] })];
    if (esContratista()) {
      var chk = el("input", { type: "checkbox" }); chk.checked = L.resaltar;
      chk.addEventListener("change", function () { L.resaltar = chk.checked; render(); });
      ctrl.push(el("label", { class: "check" }, [chk, "Resaltar mis actividades"]));
    }
    ctrl.push(el("span", { class: "esp" }));
    if (P("planear")) {
      ctrl.push(el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Ajustes", onclick: abrirAjustes }));
      ctrl.push(el("button", { class: "btn btn-primary btn-sm", type: "button", text: "+ Nueva actividad", onclick: function () { abrirAct(null); } }));
    }

    // Rejilla: ubicaciones × 6 semanas (la primera es el plan semanal).
    var cols = "grid-template-columns: 140px repeat(6, minmax(0, 1fr))";
    var head = el("div", { class: "fila", style: cols }, [el("div", { text: L.cfg.modo === "takt" ? "Área takt" : "Zona" })].concat(semanas.map(function (s, k) {
      return el("div", { class: k === 0 ? "actual" : null }, [k === 0 ? corta(s) + " · Plan semanal" : corta(s), el("span", { style: "font-weight:400", text: rango(s) })]);
    })));
    var acts = L.acts.filter(function (a) { return !L.contr || a.contratista === L.contr; });
    var ubs = ubicaciones();
    var filas = ubs.map(function (u) {
      return el("div", { class: "fila", style: cols }, [el("div", { text: u })].concat(semanas.map(function (s, k) {
        return el("div", { class: k === 0 ? "actual" : null }, acts.filter(function (a) { return a.ubicacion === u && enSemana(a, s); }).map(function (a) { return chip(a, s); }));
      })));
    });
    var rejilla = el("div", { class: "ln-rejilla" }, [head].concat(filas.length ? filas : [el("div", { class: "ln-vacio", text: P("planear") ? "Define las ubicaciones en Ajustes o crea la primera actividad." : "Todavía no hay actividades en el look-ahead." })]));
    var notas = el("div", { class: "ln-ctrl muted", style: "font-size:12px" }, [
      el("span", { text: "Franja = contratista" }), el("span", { class: "ln-ok", text: "● Lista" }), el("span", { class: "ln-warn", text: "● Con restricciones" }), el("span", { style: "color:#22D3EE", text: "● Comprometida" }),
      el("span", { text: P("planear") ? "Clic en una actividad para editarla, ligar piezas o comprometerla." : "Clic en una actividad para ver su detalle y restricciones." }),
    ]);
    $("ln-la").replaceChildren(el("div", { class: "ln-ctrl" }, ctrl), rejilla, notas, tablaPlan(), tablaRestr(semanas));
  }
  function chip(a, s) {
    var p = compromiso(s, a.id), ab = abiertas(a).length, est, cls;
    if (p && p.res) { est = p.res.cumplido ? "✓ Cumplida" : "✕ No cumplida"; cls = p.res.cumplido ? "ln-ok" : "ln-bad"; }
    else if (p) { est = "✓ Comprometida"; cls = ""; }
    else if (ab) { est = ab + (ab === 1 ? " restricción" : " restricciones"); cls = "ln-warn"; }
    else { est = "Lista"; cls = "ln-ok"; }
    var tenue = esContratista() && L.resaltar && a.contratista !== S.me.contratista;
    var b = el("button", { type: "button", class: "ln-chip" + (tenue ? " tenue" : ""), style: "box-shadow: inset 0 3px 0 " + colorDe(a.contratista), title: a.descripcion || "" }, [
      el("b", { text: a.partida || a.descripcion || "Actividad" }), el("span", { text: [a.contratista, a.eje].filter(Boolean).join(" · ") || "—" }),
      el("em", { class: cls, style: p && !p.res ? "color:#22D3EE" : null, text: est }),
    ]);
    b.addEventListener("click", function () { abrirAct(a); });
    return b;
  }
  function tablaPlan() {
    var mio = esContratista();
    var items = L.plan.filter(function (p) { return p.semana === L.semana && (!mio || p.contratista === S.me.contratista) && (!L.contr || p.contratista === L.contr); });
    var head = mio ? ["Actividad", "Compromiso", "Resultado"] : ["Actividad", "Contratista", "Compromiso (PM)", "Residente", "Superintendente"];
    var rows = items.map(function (p) {
      var a = actPorId(p.actId) || { partida: "(actividad borrada)" };
      if (mio) return el("tr", null, [el("td", { text: nombreAct(a) }), el("td", { text: p.meta || "—" }), el("td", null, [resultado(p)])]);
      return el("tr", null, [
        el("td", { text: nombreAct(a) }), el("td", { text: p.contratista || "—" }), el("td", { text: p.meta || "—" }),
        el("td", null, [celdaResidente(p)]), el("td", null, [celdaSuper(p)]),
      ]);
    });
    return el("div", { class: "ln-card" }, [
      el("div", { class: "ln-head" }, [el("h3", { text: mio ? "Mis compromisos " + corta(L.semana) : "Plan semanal " + corta(L.semana) + " · establecido por el PM" }),
        el("small", { class: "muted", text: "1) PM compromete → 2) Residente califica → 3) Superintendente valida" })]),
      el("div", { class: "tablewrap" }, [el("table", { class: "tabla ln-tabla" }, [
        el("thead", null, [el("tr", null, head.map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", null, rows.length ? rows : [el("tr", null, [el("td", { colspan: String(head.length), class: "muted", text: P("planear") ? "Abre una actividad de la columna " + corta(L.semana) + " y comprométela." : "El PM aún no establece el plan de esta semana." })])]),
      ])]),
    ]);
  }
  function resultado(p) {
    if (!p.res) return el("span", { class: "muted", text: "Por calificar" });
    var t = p.res.cumplido ? "✓ Cumplió" : "✕ No cumplió · " + p.res.causa;
    var v = p.sup ? (p.sup.estado === "validado" ? " · validado" : " · regresado") : " · en validación";
    return el("span", { class: p.res.cumplido ? "ln-ok" : "ln-bad", text: t + v });
  }
  function celdaResidente(p) {
    var validado = p.sup && p.sup.estado === "validado";
    var hecho = p.res ? el("div", null, [el("span", { class: p.res.cumplido ? "ln-ok" : "ln-bad", text: p.res.cumplido ? "✓ Cumplió" : "✕ No cumplió" }),
      p.res.cumplido ? null : el("small", { class: "muted", style: "display:block", text: p.res.causa }),
      p.res.comentario ? el("small", { class: "muted", style: "display:block", text: p.res.comentario }) : null,
      el("small", { class: "muted", style: "display:block", text: p.res.por })]) : el("span", { class: "muted", text: "Por calificar" });
    if (!P("calificar") || validado) return hecho;
    if (p.res && !(p.sup && p.sup.estado === "regresado")) {
      return el("div", null, [hecho, el("button", { class: "linklike", type: "button", text: "Cambiar", onclick: function (ev) { ev.target.parentNode.replaceWith(formCalificar(p)); } })]);
    }
    return formCalificar(p);
  }
  function formCalificar(p) {
    var causa = el("select", { "aria-label": "Causa" }, [el("option", { value: "", text: "Causa…" })].concat(L.cfg.causas.map(function (c) { return el("option", { value: c, text: c }); })));
    var com = el("input", { type: "text", maxlength: "300", placeholder: "Comentario", "aria-label": "Comentario" });
    var mandar = function (cumplido) {
      if (!cumplido && !causa.value) { toast("Elige la causa de no cumplimiento."); causa.focus(); return; }
      accion({ action: "calificar", semana: p.semana, actId: p.actId, cumplido: cumplido, causa: causa.value, comentario: com.value }, "Calificado.");
    };
    var regresado = p.sup && p.sup.estado === "regresado";
    return el("div", { class: "acc", style: "display:grid;gap:6px" }, [
      regresado ? el("small", { class: "ln-warn", text: "Regresado por " + p.sup.por + ": " + p.sup.comentario }) : null,
      el("div", { class: "acc" }, [
        el("button", { class: "btn btn-sm", type: "button", style: "background:#2BD483;color:#04210F;border:0;font-weight:700", text: "Cumplió", onclick: function () { mandar(true); } }),
        causa, el("button", { class: "btn btn-danger btn-sm", type: "button", text: "No cumplió", onclick: function () { mandar(false); } }),
      ]),
      com,
    ]);
  }
  function celdaSuper(p) {
    if (p.sup) {
      var t = el("div", null, [el("span", { class: p.sup.estado === "validado" ? "ln-ok" : "ln-warn", text: p.sup.estado === "validado" ? "✓ Validado" : "↩ Regresado" }),
        p.sup.comentario ? el("small", { class: "muted", style: "display:block", text: p.sup.comentario }) : null, el("small", { class: "muted", style: "display:block", text: p.sup.por })]);
      return t;
    }
    if (!p.res) return el("span", { class: "muted", text: "Espera al residente" });
    if (!P("validar")) return el("span", { class: "muted", text: "Por validar" });
    var com = el("input", { type: "text", maxlength: "300", placeholder: "Comentario (obligatorio para regresar)", "aria-label": "Comentario" });
    return el("div", { style: "display:grid;gap:6px" }, [
      el("div", { class: "acc" }, [
        el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Validar", onclick: function () { accion({ action: "validar", semana: p.semana, actId: p.actId, ok: true, comentario: com.value }, "Validado."); } }),
        el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Regresar al residente", onclick: function () {
          if (!com.value.trim()) { toast("Escribe qué debe revisar el residente."); com.focus(); return; }
          accion({ action: "validar", semana: p.semana, actId: p.actId, ok: false, comentario: com.value }, "Regresado al residente.");
        } }),
      ]), com,
    ]);
  }
  function tablaRestr(semanas) {
    var hoy = hoyISO(), rows = [];
    L.acts.filter(function (a) { return a.semanaFin >= semanas[0] && a.semanaIni <= semanas[5] && (!L.contr || a.contratista === L.contr); }).forEach(function (a) {
      (a.restricciones || []).forEach(function (r) { rows.push({ a: a, r: r }); });
    });
    rows.sort(function (x, y) { return (x.r.estado === "liberada") - (y.r.estado === "liberada") || String(x.r.fecha || "9").localeCompare(String(y.r.fecha || "9")); });
    var puede = function (a) { return P("planear") || P("calificar") || P("validar") || (esContratista() && a.contratista === S.me.contratista); };
    return el("div", { class: "ln-card" }, [
      el("div", { class: "ln-head" }, [el("h3", { text: "Restricciones del look-ahead" }), el("small", { class: "muted", text: "Se agregan desde cada actividad" })]),
      el("div", { class: "tablewrap" }, [el("table", { class: "tabla ln-tabla" }, [
        el("thead", null, [el("tr", null, ["Actividad", "Restricción", "Tipo", "Responsable", "Liberar antes de", "Estado"].map(function (h) { return el("th", { text: h }); }))]),
        el("tbody", null, rows.length ? rows.map(function (x) {
          var r = x.r, lib = r.estado === "liberada", venc = !lib && r.fecha && r.fecha < hoy;
          var estado = lib ? el("span", { class: "ln-ok", text: "Liberada · " + r.liberada.por }) : el("div", { class: "acc" }, [
            el("span", { class: venc ? "ln-bad" : "ln-warn", text: venc ? "Vencida" : "Abierta" }),
            puede(x.a) ? el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Liberar", onclick: function () { accion({ action: "restr-liberar", actId: x.a.id, restrId: r.id }, "Restricción liberada."); } }) : null,
          ]);
          return el("tr", null, [el("td", { text: nombreAct(x.a) + " · " + corta(x.a.semanaIni) }), el("td", { text: r.texto }), el("td", { text: r.tipo }), el("td", { text: r.responsable || "—" }),
            el("td", { text: r.fecha ? r.fecha.split("-").reverse().join("/") : "—" }), el("td", null, [estado])]);
        }) : [el("tr", null, [el("td", { colspan: "6", class: "muted", text: "Sin restricciones en estas 6 semanas." })])]),
      ])]),
    ]);
  }

  // ---------- Diálogo de actividad ----------
  function opcionesSemanas(sel, desde, n, valor) {
    var ops = []; for (var i = 0; i < n; i++) { var s = sumar(desde, i); ops.push(el("option", { value: s, text: corta(s) + " · " + rango(s) })); }
    if (valor && !ops.some(function (o) { return o.value === valor; })) ops.unshift(el("option", { value: valor, text: corta(valor) + " · " + rango(valor) }));
    sel.replaceChildren.apply(sel, ops);
    if (valor) sel.value = valor;
  }
  function llenarListas() {
    var dl = function (id, vals) { $(id).replaceChildren.apply($(id), vals.map(function (v) { return el("option", { value: v }); })); };
    var partidas = new Set(); Object.values(S.piezas || {}).forEach(function (p) { if (p.partida) partidas.add(p.partida); }); L.acts.forEach(function (a) { if (a.partida) partidas.add(a.partida); });
    dl("la-partidas", Array.from(partidas).sort()); dl("la-contrs", contratistas()); dl("la-ubics", ubicaciones());
  }
  function abrirAct(a) {
    L.act = a ? JSON.parse(JSON.stringify(a)) : { guids: [], restricciones: [], semanaIni: L.semana, semanaFin: L.semana, ubicacion: "", partida: "", contratista: L.contr || "" };
    llenarListas();
    var ed = P("planear"), x = L.act;
    $("ln-act-t").textContent = a ? nombreAct(a) : "Nueva actividad";
    $("la-partida").value = x.partida || ""; $("la-contr").value = x.contratista || ""; $("la-ubic").value = x.ubicacion || "";
    $("la-eje").value = x.eje || ""; $("la-desc").value = x.descripcion || "";
    opcionesSemanas($("la-ini"), sumar(HOY, -2), 14, x.semanaIni); opcionesSemanas($("la-fin"), sumar(HOY, -2), 14, x.semanaFin);
    O.qsa("#ln-act-form input, #ln-act-form select").forEach(function (i) { if (!i.closest("#la-restr-form") && !i.closest("#la-plan")) i.disabled = !ed; });
    $("la-acciones").hidden = !ed; $("la-borrar").hidden = !a; $("la-usar").hidden = !ed;
    piezasTxt(); renderPlanAct(); renderRestrAct();
    $("lr-tipo").replaceChildren.apply($("lr-tipo"), L.tipos.map(function (t) { return el("option", { value: t, text: t }); }));
    var puedeRestr = a && (ed || P("calificar") || P("validar") || (esContratista() && a.contratista === S.me.contratista));
    $("la-restr-form").hidden = !puedeRestr;
    if (!$("ln-act").open) $("ln-act").showModal();
  }
  function piezasTxt() {
    var n = (L.act.guids || []).length;
    $("la-piezas").textContent = n ? n + (n === 1 ? " pieza del modelo ligada" : " piezas del modelo ligadas") : "Sin piezas del modelo";
    $("la-ver").hidden = !n;
    $("la-usar").textContent = "Usar piezas seleccionadas" + (S.sel && S.sel.size ? " (" + S.sel.size + ")" : "");
  }
  function renderPlanAct() {
    var a = L.act, box = $("la-plan");
    if (!a.id || !enSemana(a, L.semana)) {
      box.replaceChildren(el("h4", { text: "Plan semanal " + corta(L.semana) }), el("p", { class: "muted", text: a.id ? "Esta actividad no cae en " + corta(L.semana) + "." : "Guarda la actividad para poder comprometerla." }));
      return;
    }
    var p = compromiso(L.semana, a.id);
    var kids = [el("h4", { text: "Plan semanal " + corta(L.semana) })];
    if (p) {
      kids.push(el("p", { style: "margin:0", text: "Comprometida: " + (p.meta || "sin detalle") }), resultado(p));
      if (P("planear") && !p.res) kids.push(el("div", { class: "row end" }, [el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Quitar del plan", onclick: function () {
        accion({ action: "plan-quitar", semana: L.semana, actId: a.id }, "Se quitó del plan semanal.").then(function () { abrirAct(actPorId(a.id)); });
      } })]));
    } else if (P("planear")) {
      var meta = el("input", { type: "text", maxlength: "200", placeholder: "Compromiso de la semana (ej. montar 3 paneles)", "aria-label": "Compromiso" });
      kids.push(el("div", { class: "row" }, [meta, el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Comprometer en " + corta(L.semana), onclick: function () {
        accion({ action: "plan-agregar", semana: L.semana, actId: a.id, meta: meta.value }, "Agregada al plan semanal.").then(function () { abrirAct(actPorId(a.id)); });
      } })]));
    } else {
      kids.push(el("p", { class: "muted", style: "margin:0", text: "No está en el plan semanal." }));
    }
    box.replaceChildren.apply(box, kids);
  }
  function renderRestrAct() {
    var rs = L.act.restricciones || [];
    $("la-restr").replaceChildren.apply($("la-restr"), rs.length ? rs.map(function (r) {
      var lib = r.estado === "liberada";
      var puede = P("planear") || P("calificar") || P("validar") || (esContratista() && L.act.contratista === S.me.contratista);
      return el("li", null, [
        el("div", null, [el("span", { text: r.texto }), el("small", { text: [r.tipo, r.responsable, r.fecha ? "antes del " + r.fecha.split("-").reverse().join("/") : "", lib ? "liberada por " + r.liberada.por : "abierta"].filter(Boolean).join(" · ") })]),
        !lib && puede ? el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Liberar", onclick: function () {
          accion({ action: "restr-liberar", actId: L.act.id, restrId: r.id }, "Restricción liberada.").then(function () { abrirAct(actPorId(L.act.id)); });
        } }) : el("span", { class: lib ? "ln-ok" : "ln-warn", text: lib ? "✓" : "" }),
      ]);
    }) : [el("li", { class: "muted", style: "border:0;padding:0", text: "Sin restricciones." })]);
  }
  function hookDialogos() {
    $("ln-act-x").addEventListener("click", function () { $("ln-act").close(); });
    $("la-usar").addEventListener("click", function () {
      if (!S.sel || !S.sel.size) { toast("Selecciona piezas en el modelo (clic, Ctrl+clic para varias) o en la pestaña Piezas."); return; }
      L.act.guids = Array.from(S.sel); piezasTxt(); toast("Se ligarán " + L.act.guids.length + " piezas al guardar.");
    });
    $("la-ver").addEventListener("click", function () { O.focusPieces(L.act.guids || []); });
    $("ln-act-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var x = L.act;
      var act = { id: x.id, partida: $("la-partida").value, contratista: $("la-contr").value, ubicacion: $("la-ubic").value, eje: $("la-eje").value,
        descripcion: $("la-desc").value, semanaIni: $("la-ini").value, semanaFin: $("la-fin").value, guids: x.guids || [] };
      accion({ action: "act-guardar", act: act }, x.id ? "Actividad guardada." : "Actividad creada.").then(function (r) { abrirAct(actPorId(r.actividad.id)); });
    });
    $("la-borrar").addEventListener("click", function () {
      var b = $("la-borrar");
      if (b.getAttribute("data-c") !== "1") { b.setAttribute("data-c", "1"); b.textContent = "¿Borrar? Clic otra vez"; setTimeout(function () { b.removeAttribute("data-c"); b.textContent = "Borrar"; }, 4000); return; }
      accion({ action: "act-borrar", id: L.act.id }, "Actividad borrada.").then(function () { $("ln-act").close(); });
    });
    $("lr-add").addEventListener("click", function () {
      if (!$("lr-texto").value.trim()) { toast("Describe la restricción."); $("lr-texto").focus(); return; }
      accion({ action: "restr-agregar", actId: L.act.id, texto: $("lr-texto").value, tipo: $("lr-tipo").value, responsable: $("lr-resp").value, fecha: $("lr-fecha").value }, "Restricción agregada.")
        .then(function () { $("lr-texto").value = ""; $("lr-resp").value = ""; $("lr-fecha").value = ""; abrirAct(actPorId(L.act.id)); });
    });
    // Tarjeta
    $("lt-cancelar").addEventListener("click", function () { $("ln-tar").close(); });
    $("ln-tar-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var auto = $("lt-auto").checked;
      var t = { id: L.tar && L.tar.id, contratista: $("lt-contr").value, entregable: $("lt-entregable").value,
        entregaA: $("lt-entrega").value, necesita: $("lt-necesita").value, ubicacion: $("lt-ubic").value, partida: $("lt-partida").value };
      if (auto) { t.inicio = $("lt-inicio").value; t.duracion = $("lt-dur").value; } else { t.dias = diasDe(L.tar); }
      accion({ action: "tarjeta-guardar", hitoId: L.hitoId, tarjeta: t }, "Tarjeta guardada.").then(function () { $("ln-tar").close(); });
    });
    $("lt-borrar").addEventListener("click", function () {
      accion({ action: "tarjeta-borrar", hitoId: L.hitoId, id: L.tar.id }, "Tarjeta borrada.").then(function () { $("ln-tar").close(); });
    });
    // Hito
    $("lh-cancelar").addEventListener("click", function () { $("ln-hito").close(); });
    $("ln-hito-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      accion({ action: "hito-guardar", hito: { id: $("ln-hito").getAttribute("data-id") || undefined, nombre: $("lh-nombre").value, fecha: $("lh-fecha").value } }, "Hito guardado.")
        .then(function (r) { L.hitoId = r.hito.id; $("ln-hito").close(); render(); });
    });
    $("lh-borrar").addEventListener("click", function () {
      var b = $("lh-borrar");
      if (b.getAttribute("data-c") !== "1") { b.setAttribute("data-c", "1"); b.textContent = "¿Borrar con sus tarjetas?"; setTimeout(function () { b.removeAttribute("data-c"); b.textContent = "Borrar hito"; }, 4000); return; }
      accion({ action: "hito-borrar", id: $("ln-hito").getAttribute("data-id") }, "Hito borrado.").then(function () { $("ln-hito").close(); });
    });
    // Ajustes
    $("lc-cancelar").addEventListener("click", function () { $("ln-cfg").close(); });
    $("ln-cfg-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var lineas = function (id) { return $(id).value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean); };
      accion({ action: "config", modo: $("lc-modo").value, ubicaciones: lineas("lc-ubic"), causas: lineas("lc-causas"), meta: Number($("lc-meta").value) }, "Ajustes guardados.")
        .then(function () { $("ln-cfg").close(); });
    });
  }
  function abrirAjustes() {
    $("lc-modo").value = L.cfg.modo;
    $("lc-ubic").value = ubicaciones().join("\n");
    $("lc-causas").value = L.cfg.causas.join("\n");
    $("lc-meta").value = L.cfg.meta;
    $("ln-cfg").showModal();
  }

  // ---------- Sesión Pull (semanas de 6 días: lunes a sábado) ----------
  var DIA = ["D", "L", "M", "M", "J", "V", "S"];
  var fISO = function (d) { return d.toISOString().slice(0, 10); };
  var aF = function (s) { return new Date(s + "T12:00:00Z"); };
  function diasHabiles(inicio, n) {
    var out = [], d = aF(inicio);
    while (out.length < n && out.length < 400) { if (d.getUTCDay() !== 0) out.push(fISO(d)); d.setUTCDate(d.getUTCDate() + 1); }
    return out;
  }
  function moverHabiles(f, n) { // n días hábiles hacia adelante (o atrás)
    var d = aF(f), paso = n < 0 ? -1 : 1, k = Math.abs(n);
    while (k > 0) { d.setUTCDate(d.getUTCDate() + paso); if (d.getUTCDay() !== 0) k--; }
    return fISO(d);
  }
  function entreHabiles(a, b) { // días hábiles de a hasta b (con signo)
    if (a === b) return 0;
    var paso = a < b ? 1 : -1, n = 0, d = aF(a);
    while (fISO(d) !== b && Math.abs(n) < 2000) { d.setUTCDate(d.getUTCDate() + paso); if (d.getUTCDay() !== 0) n += paso; }
    return n;
  }
  function diasDe(t) {
    if (t.dias && t.dias.length) return t.dias;
    return t.semana ? diasHabiles(fISO(lunes(t.semana)), t.duracion || 1) : [];
  }
  function diasSemana(sem) { var l = lunes(sem); return [0, 1, 2, 3, 4, 5].map(function (k) { var d = new Date(l); d.setUTCDate(d.getUTCDate() + k); return fISO(d); }); }
  var hoyF = hoyISO;

  function renderPull() {
    var hito = L.hitos.find(function (h) { return h.id === L.hitoId; }) || null;
    var sel = el("select", { "aria-label": "Hito" }, L.hitos.length ? L.hitos.map(function (h) { return el("option", { value: h.id, text: h.nombre + " · " + h.fecha.split("-").reverse().join("/") }); }) : [el("option", { value: "", text: "Sin hitos" })]);
    sel.value = L.hitoId;
    sel.addEventListener("change", function () { L.hitoId = sel.value; render(); });
    var ctrl = [el("label", { class: "check" }, ["Hito ", sel]), el("span", { class: "muted", style: "font-size:13px", text: "Se planea de derecha a izquierda: desde el hito hacia hoy" }), el("span", { class: "esp" })];
    if (P("planear")) {
      ctrl.push(el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ Hito", onclick: function () { abrirHito(null); } }));
      if (hito) ctrl.push(el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Editar hito", onclick: function () { abrirHito(hito); } }));
    }
    if (hito && (P("planear") || esContratista())) ctrl.push(el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "+ Tarjeta", onclick: function () { abrirTarjeta(null, null, null); } }));
    if (hito && P("planear")) ctrl.push(el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Pasar al look-ahead", onclick: function () {
      var n = (hito.tarjetas || []).filter(function (t) { return !t.actId; }).length;
      if (!n) { toast("No hay tarjetas nuevas que pasar."); return; }
      accion({ action: "pasar", hitoId: hito.id }).then(function (r) { toast(r.creadas + (r.creadas === 1 ? " actividad creada" : " actividades creadas") + " en el look-ahead."); });
    } }));
    if (!hito) {
      $("ln-pull").replaceChildren(el("div", { class: "ln-ctrl" }, ctrl), el("div", { class: "ln-vacio", text: P("planear") ? "Crea un hito (por ejemplo «Fachadas terminadas») para empezar la sesión pull." : "El PM aún no crea hitos para la sesión pull." }));
      return;
    }
    // Semanas: de la actual a la del hito, más las que ocupen las tarjetas.
    var fin = isoSemana(new Date(hito.fecha + "T12:00:00"));
    var semanas = [], s = HOY;
    for (var i = 0; i < 16 && s <= fin; i++) { semanas.push(s); s = sumar(s, 1); }
    (hito.tarjetas || []).forEach(function (t) { diasDe(t).forEach(function (f) { var w = isoSemana(aF(f)); if (semanas.indexOf(w) < 0) semanas.push(w); }); });
    semanas.sort();
    var dias = [];
    semanas.forEach(function (w) { dias = dias.concat(diasSemana(w)); });
    var cols = "grid-template-columns: 130px repeat(" + dias.length + ", minmax(84px, 1fr)) 84px";
    var hoy = hoyF();
    var cabDias = dias.map(function (f) {
      var d = aF(f);
      return el("div", { class: "dia" + (d.getUTCDay() === 6 ? " sab" : "") + (f === hoy ? " hoy" : "") + (f === hito.fecha ? " dhito" : "") }, [DIA[d.getUTCDay()] + " " + d.getUTCDate()]);
    });
    // La fila de días va en la misma rejilla que la de semanas (debajo).
    var cab = el("div", { class: "fila cab", style: cols }, [el("div", { style: "grid-row: span 2", text: "Contratista" })]
      .concat(semanas.map(function (w) { return el("div", { class: "sem", style: "grid-column: span 6" }, [el("b", { text: corta(w) }), " ", el("span", { text: rango(w) })]); }))
      .concat([el("div", { class: "hito", style: "grid-row: span 2", text: "Hito · " + hito.fecha.split("-").reverse().slice(0, 2).join("/") })])
      .concat(cabDias));
    var filas = contratistas().map(function (c) {
      return el("div", { class: "fila", style: cols }, [el("div", { class: "contr" }, [el("span", { style: "display:inline-flex;gap:8px;align-items:center" }, [el("i", { class: "dot", style: "border-radius:3px;background:" + colorDe(c) }), c])])]
        .concat(dias.map(function (f) { return celdaPull(hito, c, f); })).concat([el("div", { class: "hito" })]));
    });
    $("ln-pull").replaceChildren(el("div", { class: "ln-ctrl" }, ctrl), el("div", { class: "ln-pull" }, [cab].concat(filas)),
      el("p", { class: "muted", style: "margin:0;font-size:12px", text: "Cada post-it es un día de la tarea. Arrastra un post-it para mover ese día; con Shift + arrastrar se mueve la tarea completa. Doble clic en un día vacío crea una tarjeta que empieza ahí. Las tarjetas ya pasadas al look-ahead quedan atenuadas." }));
  }
  var TINTE = ["#BFDBFE", "#DDD6FE", "#FBCFE8", "#FDE68A", "#BBF7D0", "#A5F3FC", "#FECACA", "#E2E8F0"];
  function tinte(c) { var i = contratistas().indexOf(c); return i < 0 ? "#E2E8F0" : TINTE[i % TINTE.length]; }
  function puedeMover(t) { return !t.actId && (P("planear") || (esContratista() && t.contratista === S.me.contratista)); }
  function celdaPull(hito, c, f) {
    var dow = aF(f).getUTCDay();
    var postits = [];
    (hito.tarjetas || []).forEach(function (t) {
      if (t.contratista !== c) return;
      var ds = diasDe(t), k = ds.indexOf(f);
      if (k < 0) return;
      var b = el("button", { type: "button", class: "ln-postit" + (t.actId ? " pasada" : "") + (k === ds.length - 1 ? " ultimo" : ""), style: "background:" + tinte(c), draggable: puedeMover(t) ? "true" : null,
        title: t.entregable + " · día " + (k + 1) + " de " + ds.length + (t.entregaA ? " · entrega a " + t.entregaA : "") + (t.necesita ? " · necesita: " + t.necesita : "") }, [
        el("b", { text: t.entregable }), el("small", { text: (k + 1) + "/" + ds.length + (k === ds.length - 1 && t.entregaA ? " → " + t.entregaA : "") }),
      ]);
      b.addEventListener("click", function () { abrirTarjeta(t, null, null); });
      b.addEventListener("dragstart", function (ev) { ev.dataTransfer.setData("text/plain", t.id + "|" + f); ev.dataTransfer.effectAllowed = "move"; });
      postits.push(b);
    });
    var cel = el("div", { class: "dia" + (dow === 6 ? " sab" : "") + (f === hito.fecha ? " dhito" : ""), "data-c": c, "data-f": f }, postits);
    var permitido = P("planear") || (esContratista() && c === S.me.contratista);
    if (permitido) {
      cel.addEventListener("dragover", function (ev) { ev.preventDefault(); cel.classList.add("soltar"); });
      cel.addEventListener("dragleave", function () { cel.classList.remove("soltar"); });
      cel.addEventListener("drop", function (ev) {
        ev.preventDefault(); cel.classList.remove("soltar");
        var dato = ev.dataTransfer.getData("text/plain").split("|");
        var t = (hito.tarjetas || []).find(function (x) { return x.id === dato[0]; });
        if (!t || !puedeMover(t)) return;
        var ds = diasDe(t).slice(), desde = dato[1];
        var nuevos;
        if (ev.shiftKey) {
          // Mueve la tarea completa los mismos días hábiles.
          var delta = entreHabiles(desde, f);
          nuevos = ds.map(function (x) { return moverHabiles(x, delta); });
        } else {
          if (ds.indexOf(f) >= 0 && f !== desde) { toast("Esa tarea ya tiene ese día."); return; }
          nuevos = ds.map(function (x) { return x === desde ? f : x; });
        }
        var cambioC = P("planear") && c !== t.contratista;
        if (nuevos.join() === ds.join() && !cambioC) return;
        var nt = Object.assign({}, t, { dias: nuevos.sort(), contratista: cambioC ? c : t.contratista });
        accion({ action: "tarjeta-guardar", hitoId: hito.id, tarjeta: nt });
      });
      cel.addEventListener("dblclick", function (ev) { if (ev.target === cel) abrirTarjeta(null, c, f); });
    }
    return cel;
  }
  function textoDias(ds, manual) {
    if (!ds.length) return "";
    var fmt = function (f) { return f.split("-").reverse().slice(0, 2).join("/"); };
    return "Días: " + fmt(ds[0]) + " – " + fmt(ds[ds.length - 1]) + " · " + ds.length + (ds.length === 1 ? " día hábil" : " días hábiles") + (manual ? " (ajustados a mano)" : "");
  }
  function actualizarDiasTarjeta() {
    var auto = $("lt-auto").checked;
    var ds = auto && $("lt-inicio").value && +$("lt-dur").value > 0 ? diasHabiles($("lt-inicio").value, +$("lt-dur").value) : (L.tar ? diasDe(L.tar) : []);
    $("lt-dias").textContent = textoDias(ds, !auto);
  }
  function abrirTarjeta(t, c, f) {
    var hito = L.hitos.find(function (h) { return h.id === L.hitoId; });
    if (!hito) return;
    L.tar = t;
    llenarListas();
    var ds = t ? diasDe(t) : [];
    var manual = !!(t && ds.length && diasHabiles(ds[0], ds.length).join() !== ds.join());
    $("ln-tar-t").textContent = t ? "Tarjeta · " + t.contratista : "Nueva tarjeta";
    $("lt-entregable").value = t ? t.entregable : "";
    $("lt-inicio").value = t ? ds[0] || "" : (f || hoyF());
    $("lt-dur").value = t ? ds.length || t.duracion || "" : "";
    $("lt-auto").checked = !manual;
    $("lt-contr").value = t ? t.contratista : (c || (esContratista() ? S.me.contratista : ""));
    $("lt-entrega").value = (t && t.entregaA) || ""; $("lt-necesita").value = (t && t.necesita) || "";
    $("lt-ubic").value = (t && t.ubicacion) || ""; $("lt-partida").value = (t && t.partida) || "";
    var ed = !t || puedeMover(t);
    O.qsa("#ln-tar-form input, #ln-tar-form select").forEach(function (i) { i.disabled = !ed; });
    $("lt-contr").disabled = !ed || esContratista();
    var syncAuto = function () { var a = $("lt-auto").checked; $("lt-inicio").disabled = !ed || !a; $("lt-dur").disabled = !ed || !a; actualizarDiasTarjeta(); };
    $("lt-auto").onchange = syncAuto; $("lt-inicio").oninput = actualizarDiasTarjeta; $("lt-dur").oninput = actualizarDiasTarjeta;
    syncAuto();
    $("lt-borrar").hidden = !t || !ed;
    $("ln-tar-form").querySelector("button[type=submit]").hidden = !ed;
    $("ln-tar").showModal();
  }
  function abrirHito(h) {
    $("ln-hito").setAttribute("data-id", h ? h.id : "");
    $("ln-hito-t").textContent = h ? "Editar hito" : "Nuevo hito";
    $("lh-nombre").value = h ? h.nombre : ""; $("lh-fecha").value = h ? h.fecha : "";
    $("lh-borrar").hidden = !h;
    $("ln-hito").showModal();
  }

  // ---------- Arranque ----------
  O.qsa("#modulos button").forEach(function (b) { b.addEventListener("click", function () { ponerModulo(b.getAttribute("data-mod")); }); });
  O.qsa("#ln-tabs .tab").forEach(function (b) { b.addEventListener("click", function () { abrirTab(b.getAttribute("data-ln")); }); });
  $("ln-prev").addEventListener("click", function () { L.semana = sumar(L.semana, -1); render(); });
  $("ln-next").addEventListener("click", function () { L.semana = sumar(L.semana, 1); render(); });
  $("ln-hoy").addEventListener("click", function () { L.semana = HOY; render(); });
  hookDialogos();
  O.alIniciar.push(function () {
    var t = null, m = null;
    try { t = localStorage.getItem("ctrl_ln"); m = localStorage.getItem("ctrl_mod"); } catch (e) { /* nada */ }
    L.tab = t || (P("dashboardLean") ? "dash" : "la");
    O.qsa("#ln-tabs .tab").forEach(function (b) { b.setAttribute("aria-selected", "false"); });
    abrirTab(L.tab);
    if (m === "lean") ponerModulo("lean");
  });
  window.OBYRA_LEAN._semana = { isoSemana: isoSemana, sumar: sumar, rango: rango }; // para pruebas
})();
