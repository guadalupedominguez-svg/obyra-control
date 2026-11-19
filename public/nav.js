// OBYRA Control · barra lateral por secciones e Inicio («lo que me toca»).
// Las secciones reusan los módulos de siempre: Avance, Aprobaciones, Estimaciones y Configuraciones son pestañas
// de Control de obra; Planeación e Indicadores son el módulo Lean (look-ahead + pull, y dashboard).
(function () {
  "use strict";
  var O = window.OBYRA, S = O.S, el = O.el, $ = O.$;
  var SECS = {
    inicio: { titulo: "Inicio" },
    avance: { mod: "control", tab: "piezas", titulo: "Avance de obra" },
    aprobaciones: { mod: "control", tab: "aprobar", titulo: "Aprobaciones" },
    estimaciones: { mod: "control", tab: "generador", titulo: "Estimaciones · generadores" },
    planeacion: { mod: "lean", ln: ["la", "pull"], titulo: "Planeación" },
    indicadores: { mod: "lean", ln: ["dash"], titulo: "Indicadores" },
    configuraciones: { mod: "control", tab: "admin", titulo: "Configuraciones" },
  };
  var ICONOS = {
    bandeja: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 12l3 3 5-6"/>',
    doc: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
    escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
    regresar: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
    reloj: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    moneda: '<circle cx="12" cy="12" r="9"/><path d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .9-3 2s1.3 1.7 3 2 3 .9 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"/>',
    calendario: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    lego: '<rect x="2" y="13" width="20" height="7" rx="1"/><path d="M5 13v-1.5h3V13M16 13v-1.5h3V13"/><rect x="9" y="6" width="10" height="7" rx="1"/><path d="M11 6V4.5h2.5V6M15 6V4.5h2.5V6"/>',
    alerta: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
    rayo: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
    grafica: '<path d="M3 20h18"/><path d="M6 20v-7M11 20V5M16 20v-10M21 20v-4"/>',
    check: '<path d="M5 12l5 5 9-10"/>',
    tabla: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>',
    sol: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    nube: '<path d="M7 18h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.2 3.2 0 0 0 7 18z"/>',
    lluvia: '<path d="M7 14h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.2 3.2 0 0 0 7 14z"/><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>',
    tormenta: '<path d="M7 14h10a4 4 0 0 0 .4-8 6 6 0 0 0-11.6 1.6A3.2 3.2 0 0 0 7 14z"/><path d="M12 14l-2 4h3l-2 4"/>',
  };
  function icono(n, t) {
    var s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("width", t || 22); s.setAttribute("height", t || 22); s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
    s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
    s.innerHTML = ICONOS[n] || ""; // trazos fijos de este archivo
    return s;
  }
  var actual = null;

  function boton(sec) { return document.querySelector('#nav-lat [data-sec="' + sec + '"]'); }
  function irA(sec) {
    if (!SECS[sec] || !boton(sec)) sec = "inicio";
    var cfg = SECS[sec], app = $("app");
    actual = sec;
    Object.keys(SECS).forEach(function (k) { app.classList.toggle("sec-" + k, k === sec); });
    O.qsa("#nav-lat .nav-item[data-sec]").forEach(function (b) {
      if (b.getAttribute("data-sec") === sec) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
    });
    $("inicio").hidden = sec !== "inicio";
    try { localStorage.setItem("ctrl_sec", sec); } catch (e) { /* nada */ }
    if (sec === "inicio") { renderInicio(); return; }
    var L = window.OBYRA_LEAN;
    if (cfg.mod === "lean" && L && L.ponerModulo) {
      L.ponerModulo("lean");
      var t = null; try { t = localStorage.getItem("ctrl_ln"); } catch (e) { /* nada */ }
      L.abrirTab(cfg.ln.indexOf(t) >= 0 ? t : cfg.ln[0]);
      $("ln-titulo").textContent = cfg.titulo;
    } else {
      if (L && L.ponerModulo && S.modulo !== "control") L.ponerModulo("control");
      if (S.abrirTab) S.abrirTab(cfg.tab);
      $("panel-titulo").textContent = cfg.titulo;
    }
    moverControles(cfg.mod === "lean" ? "lean-panel" : "control-panel");
    if (S.viewer) setTimeout(function () { try { S.viewer.resize(); } catch (e) { /* nada */ } }, 60);
  }

  // ---------- Controles del modelo en el panel, en desplegables ----------
  function moverControles(panelId) {
    var c = $("multi"), panel = $(panelId), nav = panel && panel.querySelector("nav.tabs");
    if (c && nav && nav.nextSibling !== c) panel.insertBefore(c, nav.nextSibling);
  }
  function resumenes() {
    var on = function (id) { var b = $(id); return b && b.getAttribute("aria-pressed") === "true"; };
    var m = [on("vertodo-btn") ? "Todo el modelo" : "Solo lo filtrado"];
    if (on("etiq-btn")) m.push("etiquetas");
    if (on("zonas-btn")) m.push("zonas");
    if (S.zonaAislada) m.push("aislada: " + S.zonaAislada);
    $("desp-modelo-res").textContent = m.join(" · ");
    var n = S.sel ? S.sel.size : 0;
    $("desp-sel-res").textContent = (on("multi-btn") ? "Múltiple" : "Una a la vez") + (n ? " · " + n + " seleccionada" + (n === 1 ? "" : "s") : "");
    var act = O.qsa("#desp-filtros select").filter(function (x) { return !x.hidden && x.isConnected && x.value; }).length;
    var rf = $("desp-filtros-res"); if (rf) rf.textContent = act ? act + (act === 1 ? " activo" : " activos") : "Ninguno";
  }
  var tRes = null;
  function resumirLuego() { clearTimeout(tRes); tRes = setTimeout(resumenes, 30); }
  ["multi", "desp-filtros"].forEach(function (id) {
    var n = $(id); if (!n) return;
    n.addEventListener("click", resumirLuego); n.addEventListener("change", resumirLuego);
  });
  if ($("viewer")) $("viewer").addEventListener("click", resumirLuego);
  // Cada desplegable recuerda si lo dejaste abierto; de inicio, todos cerrados.
  O.qsa("details.desp").forEach(function (d) {
    try { if (localStorage.getItem("ctrl_desp_" + d.id) === "1") d.open = true; } catch (e) { /* nada */ }
    d.addEventListener("toggle", function () { try { localStorage.setItem("ctrl_desp_" + d.id, d.open ? "1" : "0"); } catch (e) { /* nada */ } });
  });

  // ---------- Inicio ----------
  var leanCache = null;
  function tarjeta(o) {
    // El botón es texto con una línea inferior en degradado del color de la tarjeta, y un punto
    // junto al título cuando hay algo pendiente (todos los perfiles).
    var linea = true;
    var b = el("button", { type: "button", class: linea ? "ini-accion" : "btn " + (o.primario ? "btn-primary" : ""), text: o.accion });
    b.addEventListener("click", o.fn);
    return el("div", { class: "ini-card " + (o.tono || "") }, [
      el("div", { class: "ini-card-top" }, [el("span", { class: "ini-ico " + (o.tono || "") }, [icono(o.icono)]), el("span", { class: "muted", text: o.titulo }),
        linea && o.n > 0 ? el("i", { class: "ini-punto", "aria-hidden": "true" }) : null]),
      el("b", { class: "ini-num", text: String(o.n) }),
      el("p", { class: "ini-desc", text: o.desc }),
      b,
    ]);
  }
  function kpi(ic, titulo, valor, tono) {
    return el("div", { class: "ini-kpi" }, [el("span", { class: "muted ini-kpi-t" }, [icono(ic, 16), titulo]), el("b", { class: tono || "", text: valor })]);
  }
  function renderInicio() {
    if (actual !== "inicio" || !S.piezas) return;
    var P = S.permisos || {}, gs = Object.keys(S.piezas), cards = [];
    var tonos = { avance: ["bandeja", "t-cian"], generador: ["doc", "t-violeta"], estimacion: ["escudo", "t-verde"] };
    var descCola = {
      avance: "Avance que capturó el contratista y espera tu validación.",
      generador: "Generadores que el contratista mandó a estimar.",
      estimacion: "Estimaciones que el residente ya validó: apruébalas o regrésalas.",
    };
    O.colasMias().forEach(function (k) {
      var n = O.enCola(k).length;
      cards.push(tarjeta({ icono: tonos[k][0], tono: tonos[k][1], titulo: O.COLAS[k].nombre, n: n, desc: n ? descCola[k] : "Nada pendiente por ahora.", accion: "Revisar", primario: n > 0,
        fn: function () { irA("aprobaciones"); O.abrirCola(k); } }));
    });
    if (P.reportar) {
      var regresados = gs.filter(function (g) { var r = O.rec(g); return r.rechazo && !r.porValidar; }).length;
      var espera = gs.filter(function (g) { return !!O.rec(g).porValidar; }).length;
      cards.push(tarjeta({ icono: "regresar", tono: "t-rojo", titulo: "Regresados por el residente", n: regresados, desc: regresados ? "Revisa el motivo y vuelve a reportarlos." : "No tienes elementos regresados.", accion: "Ir a Avance", primario: regresados > 0, fn: function () { irA("avance"); } }));
      cards.push(tarjeta({ icono: "reloj", tono: "t-ambar", titulo: "Esperando validación", n: espera, desc: "Avance que ya capturaste y el residente aún no revisa.", accion: "Ver en Avance", fn: function () { irA("avance"); } }));
    }
    if (P.enviarEstimacion) {
      var listos = gs.filter(O.estimable).length;
      cards.push(tarjeta({ icono: "tabla", tono: "t-verde", titulo: "Elementos validados", n: listos, desc: "Terminado y validado: ya puedes armar tu generador.", accion: "Armar generador", primario: listos > 0, fn: function () { irA("estimaciones"); } }));
      // Generadores ya creados (enviados): por número de estimación, los que esperan aprobación y los ya estimados.
      var porAprobar = {}, estimados = {};
      gs.forEach(function (g) {
        var r = O.rec(g);
        if (r.pend && r.pend.estatus === "Estimado" && r.pend.estimacion) porAprobar[r.pend.estimacion] = 1;
        else if (r.estimacion) estimados[r.estimacion] = 1;
      });
      var nPA = Object.keys(porAprobar).length, nEs = Object.keys(estimados).length;
      cards.push(tarjeta({ icono: "doc", tono: "t-violeta", titulo: "Generadores creados", n: nPA + nEs,
        desc: nPA + nEs ? nPA + " por aprobar · " + nEs + " estimados" : "Aún no has enviado generadores.", accion: "Revisar generadores",
        fn: function () {
          irA("estimaciones");
          var v = document.getElementById("g-vista");
          if (v) { v.value = nPA ? "poraprobar" : "estimadas"; v.dispatchEvent(new Event("change")); }
        } }));
      // Estimaciones que ya aprobó el superintendente (Estimado / Pagado), por número de estimación.
      cards.push(tarjeta({ icono: "moneda", tono: "t-ambar", titulo: "Estimaciones aprobadas", n: nEs,
        desc: nEs ? "Ya las aprobó el superintendente: " + Object.keys(estimados).sort().join(", ") : "Aún no tienes estimaciones aprobadas.", accion: "Ver estimaciones",
        fn: function () {
          irA("estimaciones");
          var v = document.getElementById("g-vista");
          if (v) { v.value = "estimadas"; v.dispatchEvent(new Event("change")); }
        } }));
    }
    // Avance general (promedio por elemento) y por estatus.
    var suma = 0, porEst = {};
    gs.forEach(function (g) { suma += O.avancePieza(g); var e = O.rec(g).estatus || "Planeado"; porEst[e] = (porEst[e] || 0) + 1; });
    var pct = gs.length ? Math.round(suma / gs.length * 10) / 10 : 0;
    var barra = el("div", { class: "ini-barra", role: "img", "aria-label": "Elementos por estatus" }, O.ORDEN.filter(function (e) { return porEst[e]; }).map(function (e) {
      return el("i", { style: "flex:" + porEst[e] + ";background:" + O.COLOR[e], title: e + ": " + porEst[e] });
    }));
    var leyenda = el("div", { class: "ini-ley" }, O.ORDEN.filter(function (e) { return porEst[e]; }).map(function (e) {
      return el("span", null, [el("i", { style: "background:" + O.COLOR[e] }), e + " " + porEst[e]]);
    }));

    var hoy = new Date(), fecha = hoy.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    var semFn = window.OBYRA_LEAN && window.OBYRA_LEAN._semana, sem = semFn ? semFn.isoSemana(hoy) : "";
    var nombre = (S.me && S.me.nombre || "").split(" ")[0];
    var h = hoy.getHours(), saludo = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
    var kpis = el("div", { class: "ini-kpis" }, [
      kpi("lego", "Avance " + (S.obra && S.obra.nombre || ""), pct + " %"),
      kpi("check", "Elementos terminados", String((porEst.Terminado || 0) + (porEst.Estimado || 0) + (porEst.Pagado || 0)) + " de " + gs.length),
      el("div", { class: "ini-kpi", id: "ini-k-restr" }, [el("span", { class: "muted ini-kpi-t" }, [icono("alerta", 16), "Restricciones abiertas"]), el("b", { text: "…" })]),
      el("div", { class: "ini-kpi", id: "ini-k-hito" }, [el("span", { class: "muted ini-kpi-t" }, [icono("rayo", 16), "Próximo hito"]), el("b", { text: "…" })]),
    ]);
    var semana = el("section", { class: "ini-box", id: "ini-semana" }, [el("h2", { text: "Esta semana en obra" }), el("p", { class: "muted", text: "Cargando el plan…" })]);
    var avance = el("section", { class: "ini-box" }, [
      el("h2", { text: "Cómo va la obra" }), barra, leyenda,
      el("button", { type: "button", class: "btn", text: "Ver en el modelo", onclick: function () { irA("avance"); } }),
    ]);
    $("inicio").replaceChildren(
      el("div", { class: "ini-head" }, [el("h1", { text: saludo + (nombre ? ", " + nombre : "") }), el("span", { class: "muted", text: fecha + (sem ? " · Semana " + +sem.slice(6) : "") + (S.obra ? " · " + S.obra.nombre : "") })]),
      el("div", { class: "ini-cards" }, cards),
      kpis,
      el("div", { class: "ini-2col" }, [semana, P.reportar ? el("div", { class: "ini-col" }, [avance, el("section", { class: "ini-box", id: "ini-clima" }, [el("h2", { text: "Clima en obra" }), el("p", { class: "muted", text: "Consultando el pronóstico…" })])]) : avance])
    );
    pintarSemana(sem);
    if (P.reportar) pintarClima();
  }
  // Pronóstico del clima según la ubicación del proyecto en ACC (lo calcula /api/clima).
  var climaCache = null;
  function climaDe(c) {
    if (c === 0) return ["sol", "Despejado"];
    if (c <= 2) return ["sol", "Parcialmente nublado"];
    if (c === 3) return ["nube", "Nublado"];
    if (c === 45 || c === 48) return ["nube", "Niebla"];
    if (c >= 95) return ["tormenta", "Tormenta"];
    if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return ["lluvia", "Lluvia"];
    if (c >= 71 && c <= 86) return ["nube", "Nieve"];
    return ["nube", "Nublado"];
  }
  function pintarClima() {
    var hacer = function (d) {
      var box = $("ini-clima"); if (!box) return;
      if (!d || d.error) { box.replaceChildren(el("h2", { text: "Clima en obra" }), el("p", { class: "muted", text: (d && d.error) || "No se pudo consultar el clima." })); return; }
      var hoy = d.actual ? climaDe(d.actual.codigo) : null;
      var dias = (d.dias || []).map(function (x, i) {
        var c = climaDe(x.codigo), f = new Date(x.fecha + "T12:00:00");
        return el("div", { class: "clima-dia" + (x.lluvia >= 60 ? " lluvioso" : ""), title: c[1] }, [
          el("span", { class: "muted", text: i === 0 ? "Hoy" : f.toLocaleDateString("es-MX", { weekday: "short" }) }),
          icono(c[0], 22),
          el("b", { text: Math.round(x.max) + "°" }), el("span", { class: "muted", text: Math.round(x.min) + "°" }),
          el("small", { text: (x.lluvia || 0) + " % lluvia" }),
        ]);
      });
      box.replaceChildren(
        el("h2", { text: "Clima en obra" }),
        hoy ? el("div", { class: "clima-hoy" }, [icono(hoy[0], 34), el("div", null, [el("b", { text: Math.round(d.actual.temp) + " °C · " + hoy[1] }), el("span", { class: "muted", text: d.lugar + " · viento " + Math.round(d.actual.viento) + " km/h" })])]) : el("span", { class: "muted", text: d.lugar }),
        el("div", { class: "clima-dias" }, dias)
      );
    };
    if (climaCache) hacer(climaCache);
    O.api("/api/clima").then(function (d) { climaCache = d; hacer(d); }).catch(function () { hacer(null); });
  }
  function pintarSemana(sem) {
    var hacer = function (d) {
      var box = $("ini-semana"); if (!box) return;
      var mio = S.me && S.me.contratista;
      var acts = (d.actividades || []).filter(function (a) { return a.semanaIni <= sem && a.semanaFin >= sem && (!mio || a.contratista === mio); });
      var plan = (d.plan || []).filter(function (p) { return p.semana === sem; });
      var porAct = {}; plan.forEach(function (p) { porAct[p.actId] = p; });
      acts.sort(function (a, b) { return (porAct[b.id] ? 1 : 0) - (porAct[a.id] ? 1 : 0); });
      var filas = acts.slice(0, 8).map(function (a) {
        var p = porAct[a.id], estado;
        if (p && p.res) estado = el("span", { class: p.res.cumplido ? "ln-ok" : "ln-bad", text: p.res.cumplido ? "Cumplió" : "No cumplió" });
        else if (p && p.auto) estado = el("span", { style: "color:var(--accent)", text: p.auto.hechas + " / " + p.auto.total + " (" + p.auto.pct + " %)" });
        else if (p) estado = el("span", { style: "color:var(--accent)", text: "Comprometida" });
        else if ((a.restricciones || []).some(function (r) { return r.estado !== "liberada"; })) estado = el("span", { class: "ln-warn", text: "Con restricción" });
        else estado = el("span", { class: "muted", text: (a.guids || []).length ? "Lista" : "Sin elementos ligados" });
        return el("div", { class: "ini-act" }, [
          el("div", null, [el("b", { text: a.descripcion || a.partida || "Actividad" }), el("small", { class: "muted", text: [a.ubicacion, a.contratista].filter(Boolean).join(" · ") })]),
          estado,
        ]);
      });
      var abiertas = 0; (d.actividades || []).forEach(function (a) { (a.restricciones || []).forEach(function (r) { if (r.estado !== "liberada" && (!mio || a.contratista === mio)) abiertas++; }); });
      var hoyF = new Date().toISOString().slice(0, 10);
      var hito = (d.hitos || []).filter(function (x) { return x.fecha >= hoyF; }).sort(function (a, b) { return a.fecha < b.fecha ? -1 : 1; })[0];
      var kr = $("ini-k-restr"), kh = $("ini-k-hito");
      if (kr) kr.lastChild.textContent = String(abiertas);
      if (kh) kh.lastChild.textContent = hito ? hito.nombre + " · " + new Date(hito.fecha + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" }) : "—";
      var ir = el("button", { type: "button", class: "btn", text: "Ver la semana día por día", onclick: function () { irA("planeacion"); if (window.OBYRA_LEAN.vista) window.OBYRA_LEAN.vista("dia"); } });
      box.replaceChildren.apply(box, [el("h2", { text: "Esta semana en obra" + (plan.length ? " · " + plan.length + (plan.length === 1 ? " compromiso" : " compromisos") : "") })]
        .concat(filas.length ? filas : [el("p", { class: "muted", text: mio ? "No tienes actividades en el look-ahead esta semana." : "No hay actividades en el look-ahead esta semana." })])
        .concat(acts.length > 8 ? [el("small", { class: "muted", text: "y " + (acts.length - 8) + " más" })] : [], [ir]));
    };
    if (leanCache) hacer(leanCache);
    O.api("/api/lean").then(function (d) { leanCache = d; hacer(d); }).catch(function () {
      var box = $("ini-semana"); if (box) box.replaceChildren(el("h2", { text: "Esta semana en obra" }), el("p", { class: "muted", text: "No se pudo cargar el plan." }));
    });
  }

  // Insignias: Aprobaciones (lo que me toca validar) e Inicio (eso + lo regresado al contratista).
  var tPend = null;
  O.alCambiarAvance = function () {
    var mias = O.colasMias(), n = mias.reduce(function (s, k) { return s + O.enCola(k).length; }, 0);
    var b = $("nav-badge-ap"); if (b) { b.textContent = n; b.hidden = !n; }
    var reg = S.permisos && S.permisos.reportar ? Object.keys(S.piezas || {}).filter(function (g) { var r = O.rec(g); return r.rechazo && !r.porValidar; }).length : 0;
    var bi = $("nav-badge-inicio"); if (bi) { bi.textContent = n + reg; bi.hidden = !(n + reg); }
    if (actual === "inicio") { clearTimeout(tPend); tPend = setTimeout(renderInicio, 150); }
    resumirLuego();
  };

  O.qsa("#nav-lat .nav-item[data-sec]").forEach(function (b) { b.addEventListener("click", function () { irA(b.getAttribute("data-sec")); }); });
  var plegada = false;
  try { plegada = localStorage.getItem("ctrl_nav_plegada") === "1"; } catch (e) { /* nada */ }
  function plegar(v) {
    plegada = v; $("app").classList.toggle("nav-plegada", v);
    $("nav-plegar").setAttribute("aria-label", v ? "Mostrar los nombres" : "Plegar la barra");
    $("nav-plegar").title = v ? "Mostrar los nombres" : "Plegar la barra";
    try { localStorage.setItem("ctrl_nav_plegada", v ? "1" : "0"); } catch (e) { /* nada */ }
    if (S.viewer) setTimeout(function () { try { S.viewer.resize(); } catch (e) { /* nada */ } }, 220);
  }
  $("nav-plegar").addEventListener("click", function () { plegar(!plegada); });
  plegar(plegada);
  O.irA = irA;
  O.alIniciar.push(function () {
    var s = null; try { s = localStorage.getItem("ctrl_sec"); } catch (e) { /* nada */ }
    irA(s || "inicio");
    O.alCambiarAvance();
    resumenes();
  });
})();
