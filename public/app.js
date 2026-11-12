// OBYRA Control · app web (sin frameworks).
// Avance por pieza sobre el modelo IFC de Forma, aprobación del residente y generador de estimaciones.
(function () {
  "use strict";

  // ---------- Utilidades ----------
  var $ = function (id) { return document.getElementById(id); };
  var qsa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") e.textContent = attrs[k];
      else if (k === "class") e.className = attrs[k];
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function api(path, body) {
    var opt = { credentials: "same-origin", headers: {} };
    if (body !== undefined) { opt.method = "POST"; opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch(path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (r.status === 401 && path !== "/api/session") { showLogin(); }
        if (!r.ok) {
          var e = new Error(j.error || "El servidor no respondió correctamente (código " + r.status + ")" + (r.status === 413 || r.status >= 500 ? ". Puede ser por el tamaño del archivo." : "."));
          e.status = r.status; throw e;
        }
        return j;
      });
    });
  }
  var toastT = null;
  function toast(msg, err, ms) {
    var t = $("toast");
    // Con una ventana abierta (modal), el aviso tiene que ir dentro de ella; si no, queda oculto detrás.
    var host = document.querySelector("dialog[open]") || document.body;
    if (t.parentNode !== host) host.appendChild(t);
    t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || (err ? 8000 : 3500));
  }
  var nf2 = new Intl.NumberFormat("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var nf0 = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 });
  var f2 = function (n) { return n == null || !isFinite(n) ? "—" : nf2.format(n); };
  var fecha = function (iso) { return iso ? new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" }) : "—"; };

  // Colores por estatus (los mismos tonos de OBYRA).
  var COLOR = {
    "Planeado": "#5B6B85",
    "Liberado": "#3B82F6",
    "En ejecución": "#F5B83D",
    "Por aprobar": "#F472B6",
    "Terminado": "#2BD483",
    "Estimado": "#22D3EE",
    "Pagado": "#A78BFA",
  };
  var ORDEN = ["Planeado", "Liberado", "En ejecución", "Terminado", "Por aprobar", "Estimado", "Pagado"];

  // ---------- Estado ----------
  var S = {
    me: null, permisos: {}, roles: {}, obra: null,
    piezas: {}, avance: {}, version: null,
    sel: new Set(), apSel: new Set(), gSel: new Set(), envios: [],
    viewer: null, model: null, guid2db: new Map(), db2guid: new Map(),
    syncing: false, tab: "piezas",
  };
  var rec = function (g) { return S.avance[g] || { estatus: "Planeado", pct: 0 }; };
  var estado = function (g) { var r = rec(g); return r.pend ? "Por aprobar" : (r.estatus || "Planeado"); };

  // ---------- Inicio ----------
  function boot() {
    var q = new URLSearchParams(location.search);
    var forma = q.get("forma");
    if (forma) {
      history.replaceState(null, "", "/");
      var msg = { cuenta: "Tu cuenta de Autodesk quedó conectada. Ya puedes enviar generadores a Forma.", conectado: "Forma quedó conectado.", cancelado: "Se canceló la conexión con Forma.", invalido: "La conexión con Forma no se pudo verificar. Inténtalo de nuevo.", error: "Autodesk rechazó la conexión. Revisa la app de APS y la URL de retorno.", "sin-permiso": "Tu usuario no tiene permiso para esa conexión." }[forma];
      if (msg) setTimeout(function () { toast(msg, forma !== "conectado" && forma !== "cuenta"); }, 300);
    }
    api("/api/session").then(function (s) {
      if (!s.loggedIn) { showLogin(s.config); return; }
      S.me = s.user; S.permisos = s.permisos; S.roles = s.roles; S.autodesk = s.autodesk || { conectada: false };
      startApp();
    }).catch(function () { showLogin(); });
  }

  function showLogin(config) {
    $("app").hidden = true; $("login").hidden = false;
    var c = $("login-config");
    if (config && (!config.store || !config.secret)) {
      c.textContent = "Falta configurar el servidor: " + [!config.store && "base de datos (KV_REST_API_URL y KV_REST_API_TOKEN)", !config.secret && "SESSION_SECRET"].filter(Boolean).join(" y ") + ".";
      c.hidden = false;
    }
    setTimeout(function () { $("login-email").focus(); }, 50);
  }

  $("login-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var err = $("login-error"); err.hidden = true;
    $("login-btn").disabled = true;
    api("/api/session", { action: "login", email: $("login-email").value, password: $("login-pass").value })
      .then(function () { location.reload(); })
      .catch(function (e) { err.textContent = e.message; err.hidden = false; $("login-btn").disabled = false; });
  });

  function startApp() {
    $("login").hidden = true; $("app").hidden = false;
    $("user-name").textContent = S.me.nombre;
    $("user-rol").textContent = S.me.rolNombre + (S.me.contratista ? " · " + S.me.contratista : "");
    qsa("[data-perm]").forEach(function (n) { if (!S.permisos[n.getAttribute("data-perm")]) n.remove(); });
    // El formulario de avance solo existe para el contratista (los demás no tienen el permiso "reportar").
    if ($("reporte")) {
      $("r-btn").textContent = "Enviar avance para aprobación";
      $("r-hint").textContent = "El residente o el superintendente revisa y aprueba el reporte antes de que cuente para el generador.";
      fillSelect($("r-estatus"), ["En ejecución", "Terminado"]);
    }
    $("ap-intro").textContent = S.permisos.aprobar
      ? "Avance reportado que espera tu revisión. Revisa en obra o en el modelo y aprueba o rechaza con el motivo."
      : "Avance reportado que espera la revisión del residente o del superintendente. Solo ellos pueden aprobar o rechazar.";
    fillSelect($("f-estatus"), [["", "Todos los estatus"]].concat(ORDEN.map(function (e) { return [e, e]; })));
    renderLegend();
    renderCuenta();
    setupTabs();
    Promise.all([api("/api/obra" + (S.permisos.administrar ? "?revisar=1" : "")), loadPiezas()]).then(function (r) {
      S.obra = r[0];
      $("obra-nombre").textContent = S.obra.nombre;
      document.title = S.obra.nombre + " · OBYRA Control";
      if (S.permisos.administrar) renderAdmin();
      startViewer();
      avisoVersion(S.obra.nueva);
      (window.OBYRA.alIniciar || []).forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    }).catch(function (e) { toast(e.message, true); });
  }

  function fillSelect(sel, items) {
    sel.replaceChildren.apply(sel, items.map(function (it) {
      var v = Array.isArray(it) ? it[0] : it, t = Array.isArray(it) ? it[1] : it;
      return el("option", { value: v, text: t });
    }));
  }

  function renderLegend() {
    $("legend").replaceChildren.apply($("legend"), ORDEN.map(function (e) {
      return el("span", null, [el("i", { class: "dot", style: "background:" + COLOR[e] }), e]);
    }));
  }

  function setupTabs() {
    var tabs = qsa(".tab");
    function open(name) {
      tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-tab") === name)); });
      qsa(".tabpane").forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== name; });
      if (name === "generador") renderGenerador();
      if (name === "aprobar") renderAprobar();
      if (name === "admin") loadUsers();
      var antes = S.tab; S.tab = name;
      // Piezas y Generador muestran en el modelo lo mismo que su lista; las demás pestañas, todas las piezas.
      if (antes !== name) paintModel(name === "piezas" || name === "generador");
      try { localStorage.setItem("ctrl_tab", name); } catch (e) { /* sin almacenamiento */ }
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { open(t.getAttribute("data-tab")); }); });
    var last = null;
    try { last = localStorage.getItem("ctrl_tab"); } catch (e) { /* nada */ }
    open(tabs.some(function (t) { return t.getAttribute("data-tab") === last; }) ? last : "piezas");
  }

  $("btn-logout").addEventListener("click", function () {
    api("/api/session", { action: "logout" }).finally(function () { location.reload(); });
  });
  $("btn-pass").addEventListener("click", function () { $("pass-error").hidden = true; $("pass-form").reset(); $("pass").showModal(); });
  $("pass-cancel").addEventListener("click", function () { $("pass").close(); });
  $("pass-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    api("/api/session", { action: "password", actual: $("pass-actual").value, nueva: $("pass-nueva").value })
      .then(function () { $("pass").close(); toast("Contraseña actualizada."); })
      .catch(function (e) { $("pass-error").textContent = e.message; $("pass-error").hidden = false; });
  });

  // ---------- Piezas ----------
  function loadPiezas() {
    return api("/api/piezas").then(function (r) {
      S.piezas = r.piezas || {}; S.avance = r.avance || {}; S.version = r.version;
      var contratistas = Array.from(new Set(Object.values(S.piezas).map(function (p) { return p.contratista; }).filter(Boolean))).sort();
      if ($("f-contratista")) {
        var prev = $("f-contratista").value;
        fillSelect($("f-contratista"), [["", "Todos los contratistas"]].concat(contratistas.map(function (c) { return [c, c]; })));
        $("f-contratista").value = contratistas.indexOf(prev) >= 0 ? prev : "";
      }
      if ($("ap-contratista")) {
        var apPrev = $("ap-contratista").value;
        fillSelect($("ap-contratista"), [["", "Todos los contratistas"]].concat(contratistas.map(function (c) { return [c, c]; })));
        $("ap-contratista").value = contratistas.indexOf(apPrev) >= 0 ? apPrev : "";
      }
      var gPrev = $("g-contratista").value;
      if (S.me.rol === "contratista") fillSelect($("g-contratista"), [[S.me.contratista, S.me.contratista]]);
      else fillSelect($("g-contratista"), [["", "Todos los contratistas"]].concat(contratistas.map(function (c) { return [c, c]; })));
      if (gPrev && contratistas.indexOf(gPrev) >= 0) $("g-contratista").value = gPrev;
      updateBadge();
      renderLista();
      paintModel();
    });
  }

  function filtradas() {
    var c = $("f-contratista") ? $("f-contratista").value : "";
    var e = $("f-estatus").value;
    var n = e === "Estimado" ? $("f-estnum").value : "";
    var q = $("f-buscar").value.trim().toLowerCase();
    return Object.keys(S.piezas).filter(function (g) {
      var p = S.piezas[g];
      if (c && p.contratista !== c) return false;
      if (e && estado(g) !== e) return false;
      if (n && rec(g).estimacion !== n) return false;
      if (q && [p.marca, p.clave, p.zona, p.eje, p.concepto].join(" ").toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) {
      var pa = S.piezas[a], pb = S.piezas[b];
      return (pa.contratista + pa.clave + pa.marca).localeCompare(pb.contratista + pb.clave + pb.marca, "es", { numeric: true });
    });
  }

  function pill(est, label) {
    return el("span", { class: "pill" }, [el("i", { class: "dot", style: "background:" + (COLOR[est] || COLOR.Planeado) }), label || est]);
  }

  // Con el estatus "Estimado" aparece el filtro por número de estimación.
  function syncEstnumPiezas() {
    var sel = $("f-estnum"), c = $("f-contratista") ? $("f-contratista").value : "";
    sel.hidden = $("f-estatus").value !== "Estimado";
    if (sel.hidden) return;
    var prev = sel.value;
    var nums = Array.from(new Set(Object.keys(S.piezas).filter(function (g) { return !c || S.piezas[g].contratista === c; })
      .map(function (g) { return rec(g).estatus === "Estimado" ? rec(g).estimacion : ""; }).filter(Boolean)))
      .sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
    fillSelect(sel, [["", "Todas las estimaciones"]].concat(nums.map(function (x) { return [x, "Estimación " + x]; })));
    sel.value = nums.indexOf(prev) >= 0 ? prev : "";
  }

  function renderLista() {
    syncEstnumPiezas();
    var list = filtradas();
    var ul = $("lista");
    $("list-count").textContent = nf0.format(list.length) + (list.length === 1 ? " pieza" : " piezas");
    if (!Object.keys(S.piezas).length) {
      ul.replaceChildren(el("li", { class: "empty", text: S.permisos.administrar
        ? "Todavía no hay piezas. En Configuración, conecta Forma, pega la liga del IFC y usa «Leer piezas del modelo»."
        : (S.me.rol === "contratista" ? "Aún no hay piezas asignadas a " + S.me.contratista + " en el modelo." : "Todavía no se han leído las piezas del modelo.") }));
      updateSel();
      return;
    }
    if (!list.length) { ul.replaceChildren(el("li", { class: "empty", text: "Ninguna pieza coincide con el filtro." })); updateSel(); return; }
    ul.replaceChildren.apply(ul, list.map(function (g) {
      var p = S.piezas[g], r = rec(g), est = estado(g);
      var cb = el("input", { type: "checkbox", "aria-label": "Seleccionar " + (p.marca || g) });
      cb.checked = S.sel.has(g);
      cb.addEventListener("click", function (ev) { ev.stopPropagation(); toggleSel(g, cb.checked); });
      var notes = [];
      if (r.pend) notes.push(el("span", { class: "note warn", text: "Propuesto: " + r.pend.estatus + (r.pend.estatus !== "Terminado" && r.pend.pct ? " " + r.pend.pct + " %" : "") + " · " + r.pend.por }));
      if (r.rechazo) notes.push(el("span", { class: "note bad", text: "Rechazado: " + r.rechazo.motivo }));
      var li = el("li", { class: S.sel.has(g) ? "sel" : "" }, [
        cb,
        el("span", { class: "m", text: (p.marca || "(sin marca)") + " · " + (p.clave || "sin clave") }),
        pill(est, est + (est === "En ejecución" && r.pct ? " " + r.pct + " %" : "")),
        el("span", { class: "s", text: [p.contratista, p.zona, p.eje && "Eje " + p.eje, p.nivel].filter(Boolean).join(" · ") }),
      ].concat(notes));
      li.addEventListener("click", function () { focusPieces([g]); });
      li.addEventListener("dblclick", function () { showDetalle(g); });
      return li;
    }));
    updateSel();
  }

  ["f-contratista", "f-estatus", "f-estnum"].forEach(function (id) { if ($(id)) $(id).addEventListener("change", function () { renderLista(); paintModel(true); }); });
  $("f-buscar").addEventListener("input", function () { renderLista(); paintModel(false); });
  $("sel-all").addEventListener("change", function () {
    var list = filtradas();
    if ($("sel-all").checked) list.forEach(function (g) { S.sel.add(g); }); else S.sel.clear();
    renderLista(); selectInViewer();
  });
  $("btn-ver-sel").addEventListener("click", function () {
    if (!S.sel.size) { toast("Selecciona piezas en la lista o en el modelo."); return; }
    focusPieces(Array.from(S.sel));
  });

  function toggleSel(g, on) {
    if (on) S.sel.add(g); else S.sel["delete"](g);
    renderLista(); selectInViewer();
  }
  function updateSel() {
    if ($("reporte")) { $("reporte").hidden = !S.sel.size; $("sel-count").textContent = nf0.format(S.sel.size); }
    var list = filtradas();
    $("sel-all").checked = list.length > 0 && list.every(function (g) { return S.sel.has(g); });
  }

  if ($("reporte")) {
    var syncPct = function () { var t = $("r-estatus").value === "Terminado"; $("r-pct").disabled = t; if (t) $("r-pct").value = ""; };
    $("r-estatus").addEventListener("change", syncPct); syncPct();
    $("reporte").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var guids = Array.from(S.sel);
      $("r-btn").disabled = true;
      api("/api/piezas", { action: "reportar", guids: guids, estatus: $("r-estatus").value, pct: Number($("r-pct").value || 0), comentario: $("r-coment").value })
        .then(function (r) {
          Object.assign(S.avance, r.avance);
          toast(nf0.format(r.actualizadas) + (r.actualizadas === 1 ? " pieza actualizada" : " piezas actualizadas") + (r.omitidas ? " · " + r.omitidas + " sin cambio (ya estimadas o de otro contratista)" : "") + ".");
          S.sel.clear(); $("r-coment").value = "";
          updateBadge(); renderLista(); paintModel(); selectInViewer();
        })
        .catch(function (e) { toast(e.message, true); })
        .finally(function () { $("r-btn").disabled = false; });
    });
  }

  function showDetalle(g) {
    var p = S.piezas[g], r = rec(g);
    $("d-titulo").textContent = (p.marca || "(sin marca)") + " · " + (p.clave || "sin clave");
    var datos = [
      ["Contratista", p.contratista], ["Partida", p.partida], ["Concepto", p.concepto], ["Zona", p.zona], ["Eje", p.eje], ["Nivel", p.nivel],
      ["Estatus", estado(g) + (r.pct && r.estatus === "En ejecución" ? " (" + r.pct + " %)" : "")], ["Estimación", r.estimacion],
      ["Área (m²)", f2(p.area)], ["Volumen (m³)", f2(p.volumen)], ["Largo (m)", f2(p.largo)], ["Alto (m)", f2(p.alto)], ["Espesor (m)", f2(p.espesor)],
      ["GlobalId", g],
    ];
    $("d-datos").replaceChildren.apply($("d-datos"), datos.reduce(function (acc, d) { acc.push(el("dt", { text: d[0] }), el("dd", { text: d[1] || "—" })); return acc; }, []));
    var h = (r.hist || []).slice().reverse();
    $("d-hist").replaceChildren.apply($("d-hist"), h.length ? h.map(function (e) {
      var verbo = { reporta: "reportó", registra: "registró", aprueba: "aprobó", rechaza: "rechazó", estima: "asignó a la estimación" }[e.accion] || e.accion;
      var que = e.accion === "estima" ? e.estimacion : (e.estatus || "") + (e.pct && e.estatus !== "Terminado" ? " " + e.pct + " %" : "");
      return el("li", null, [e.por + " " + verbo + " " + que, el("small", { text: fecha(e.at) + (e.comentario ? " · " + e.comentario : "") })]);
    }) : [el("li", { text: "Sin movimientos." })]);
    $("detalle").showModal();
  }

  // ---------- Por aprobar ----------
  function pendientes() { return Object.keys(S.piezas).filter(function (g) { return rec(g).pend; }); }
  // Pendientes que se ven en la pestaña, según el filtro de contratista.
  function pendientesVista() {
    var c = $("ap-contratista") ? $("ap-contratista").value : "";
    return pendientes().filter(function (g) { return !c || S.piezas[g].contratista === c; });
  }
  function updateBadge() {
    var b = $("badge-aprobar"); if (!b) return;
    var n = pendientes().length; b.textContent = n; b.hidden = !n;
  }
  function renderAprobar() {
    if (!$("lista-ap")) return;
    var list = pendientesVista().sort(function (a, b) { return rec(a).pend.at < rec(b).pend.at ? -1 : 1; });
    S.apSel.forEach(function (g) { if (list.indexOf(g) < 0) S.apSel["delete"](g); });
    $("ap-count").textContent = nf0.format(list.length) + (list.length === 1 ? " pendiente" : " pendientes");
    if ($("ap-all")) $("ap-all").checked = list.length > 0 && list.every(function (g) { return S.apSel.has(g); });
    if (!list.length) { $("lista-ap").replaceChildren(el("li", { class: "empty", text: $("ap-contratista") && $("ap-contratista").value ? "Este contratista no tiene avance pendiente de aprobar." : "No hay avance pendiente de aprobar." })); return; }
    $("lista-ap").replaceChildren.apply($("lista-ap"), list.map(function (g) {
      var p = S.piezas[g], pe = rec(g).pend;
      var cb = el("span"); // sin casilla para quien solo consulta
      if (S.permisos.aprobar) {
        cb = el("input", { type: "checkbox", "aria-label": "Seleccionar " + (p.marca || g) });
        cb.checked = S.apSel.has(g);
        cb.addEventListener("click", function (ev) { ev.stopPropagation(); if (cb.checked) S.apSel.add(g); else S.apSel["delete"](g); renderAprobar(); });
      }
      var li = el("li", { class: S.apSel.has(g) ? "sel" : "" }, [
        cb,
        el("span", { class: "m", text: (p.marca || "(sin marca)") + " · " + p.contratista }),
        pill(pe.estatus, pe.estatus + (pe.estatus !== "Terminado" && pe.pct ? " " + pe.pct + " %" : "")),
        el("span", { class: "s", text: [p.clave, p.zona, p.eje && "Eje " + p.eje, "de " + estado(g).replace("Por aprobar", rec(g).estatus || "Planeado")].filter(Boolean).join(" · ") }),
        el("span", { class: "note", text: pe.por + " · " + fecha(pe.at) + (pe.comentario ? " · " + pe.comentario : "") }),
      ]);
      li.addEventListener("click", function () { focusPieces([g]); });
      li.addEventListener("dblclick", function () { showDetalle(g); });
      return li;
    }));
  }
  if ($("ap-contratista")) $("ap-contratista").addEventListener("change", function () { S.apSel.clear(); renderAprobar(); });
  if ($("ap-all")) {
    $("ap-all").addEventListener("change", function () {
      pendientesVista().forEach(function (g) { if ($("ap-all").checked) S.apSel.add(g); else S.apSel["delete"](g); });
      renderAprobar();
    });
    var decide = function (action) {
      var guids = Array.from(S.apSel);
      if (!guids.length) { toast("Selecciona al menos un avance."); return; }
      api("/api/piezas", { action: action, guids: guids, comentario: $("ap-coment").value })
        .then(function (r) {
          Object.assign(S.avance, r.avance);
          S.apSel.clear(); $("ap-coment").value = "";
          toast(nf0.format(r.actualizadas) + (action === "aprobar" ? " aprobados." : " rechazados."));
          updateBadge(); renderAprobar(); renderLista(); paintModel();
        })
        .catch(function (e) { toast(e.message, true); });
    };
    $("ap-ok").addEventListener("click", function () { decide("aprobar"); });
    $("ap-no").addEventListener("click", function () { decide("rechazar"); });
  }

  // ---------- Generador ----------
  function genFilas() {
    var c = $("g-contratista").value, vista = $("g-vista").value;
    return Object.keys(S.piezas).filter(function (g) {
      var p = S.piezas[g], r = rec(g);
      if (c && p.contratista !== c) return false;
      if (vista === "porestimar") return !r.estimacion; // cualquier estatus: lo que resta por estimar
      if (vista === "estimadas") {
        var n = $("g-estnum").value;
        return !!r.estimacion && (!n || r.estimacion === n);
      }
      return true;
    }).sort(function (a, b) {
      var pa = S.piezas[a], pb = S.piezas[b];
      return (pa.contratista + pa.clave + pa.marca).localeCompare(pb.contratista + pb.clave + pb.marca, "es", { numeric: true });
    });
  }
  // Lista de estimaciones (de las piezas del contratista elegido) para la vista "Estimadas".
  function syncEstimaciones() {
    var sel = $("g-estnum"), vista = $("g-vista").value, c = $("g-contratista").value;
    sel.hidden = vista !== "estimadas";
    var marcar = $("g-marcar"); if (marcar) marcar.parentNode.hidden = vista !== "porestimar";
    $("g-hint").hidden = vista !== "porestimar";
    if (vista !== "estimadas") return;
    var prev = sel.value;
    var nums = Array.from(new Set(Object.keys(S.piezas).filter(function (g) { return !c || S.piezas[g].contratista === c; })
      .map(function (g) { return rec(g).estimacion; }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
    fillSelect(sel, [["", "Todas las estimaciones"]].concat(nums.map(function (n) { return [n, "Estimación " + n]; })));
    sel.value = nums.indexOf(prev) >= 0 ? prev : "";
  }
  function renderGenerador() {
    syncEstimaciones();
    var filas = genFilas();
    var grupos = {};
    filas.forEach(function (g) {
      var p = S.piezas[g], k = p.contratista + "|" + (p.clave || "(sin clave)");
      var x = grupos[k] || (grupos[k] = { contratista: p.contratista, clave: p.clave || "(sin clave)", partida: p.partida, piezas: 0, area: 0, volumen: 0 });
      x.piezas++; x.area += p.area || 0; x.volumen += p.volumen || 0;
    });
    var gs = Object.values(grupos);
    $("g-resumen").replaceChildren.apply($("g-resumen"), gs.length ? gs.map(function (x) {
      return el("div", { class: "g-card" }, [
        el("b", { text: x.clave + (x.partida ? " · " + x.partida : "") }), el("b", { text: f2(x.area) + " m²" }),
        el("span", { class: "s", text: x.contratista + " · " + x.piezas + (x.piezas === 1 ? " pieza" : " piezas") }), el("span", { class: "s", text: f2(x.volumen) + " m³" }),
      ]);
    }) : [el("p", { class: "muted", text: { porestimar: "No quedan piezas por estimar.", estimadas: "Todavía no hay piezas estimadas." }[$("g-vista").value] || "No hay piezas." })]);
    // En el panel solo marca, estatus y estimación; el detalle completo está en "Ver generador".
    // En "Sin estimar", quien estima puede marcar las piezas que van en una misma estimación.
    var conCasillas = !!(S.permisos.estimar && $("g-vista").value === "porestimar");
    var elegibles = filas.filter(estimable);
    S.gSel.forEach(function (g) { if (!conCasillas || elegibles.indexOf(g) < 0) S.gSel["delete"](g); });
    var todas = null;
    if (conCasillas) {
      todas = el("input", { type: "checkbox", "aria-label": "Seleccionar todas las terminadas" });
      todas.checked = elegibles.length > 0 && elegibles.every(function (g) { return S.gSel.has(g); });
      todas.disabled = !elegibles.length;
      todas.addEventListener("change", function () { elegibles.forEach(function (g) { if (todas.checked) S.gSel.add(g); else S.gSel["delete"](g); }); renderGenerador(); selectGenEnModelo(); });
    }
    var head = el("tr", null, (conCasillas ? [el("th", { class: "chk" }, [todas])] : []).concat(["Marca", "Estatus", "Estimación"].map(function (h) { return el("th", { text: h }); })));
    var rows = filas.map(function (g) {
      var p = S.piezas[g], r = rec(g), est = estado(g);
      var celdas = [];
      if (conCasillas) {
        var ok = estimable(g);
        var cb = el("input", { type: "checkbox", "aria-label": "Incluir " + (p.marca || g) + " en la estimación", title: ok ? "" : "Solo se estiman piezas terminadas y aprobadas" });
        cb.checked = S.gSel.has(g); cb.disabled = !ok;
        cb.addEventListener("click", function (ev) { ev.stopPropagation(); if (cb.checked) S.gSel.add(g); else S.gSel["delete"](g); renderGenerador(); selectGenEnModelo(); });
        celdas.push(el("td", { class: "chk" }, [cb]));
      }
      var tr = el("tr", { class: "click" + (S.gSel.has(g) ? " sel" : "") }, celdas.concat([
        el("td", { text: p.marca || "—" }),
        el("td", null, [pill(est, est + (est === "En ejecución" && r.pct ? " " + r.pct + " %" : ""))]),
        el("td", { text: r.estimacion || "—" }),
      ]));
      tr.addEventListener("click", function () { focusPieces([g]); });
      return tr;
    });
    $("g-tabla").replaceChildren(el("thead", null, [head]), el("tbody", null, rows));
    actualizarMarcar();
  }
  function estimable(g) { var r = rec(g); return r.estatus === "Terminado" && !r.pend; }
  // Piezas seleccionadas con la casilla (si hay); si no, null.
  function genSeleccion() { var sel = genFilas().filter(function (g) { return S.gSel.has(g); }); return sel.length ? sel : null; }
  function actualizarMarcar() {
    var b = $("g-marcar"); if (!b || b.getAttribute("data-confirm")) return;
    var n = S.gSel.size;
    b.textContent = n ? "Marcar " + n + (n === 1 ? " seleccionada" : " seleccionadas") + " como estimado" : "Marcar como estimado";
    $("g-ver").textContent = n ? "Ver generador (" + n + (n === 1 ? " seleccionada)" : " seleccionadas)") : "Ver generador";
  }
  function selectGenEnModelo() {
    if (!S.viewer || !S.model) return;
    S.syncing = true;
    S.viewer.select(Array.from(S.gSel).map(function (g) { return S.guid2db.get(g); }).filter(function (x) { return x != null; }), S.model);
    S.syncing = false;
  }
  ["g-contratista", "g-vista", "g-estnum"].forEach(function (id) { $(id).addEventListener("change", function () { S.gSel.clear(); renderGenerador(); paintModel(true); }); });

  // ---------- Vista previa del generador y Excel ----------
  var GP = null; // { filas, img:{data,w,h}, titulo, sub, archivo }
  var COLS = [
    ["Contratista", "contratista"], ["Clave", "clave"], ["Concepto", "concepto"], ["Marca", "marca"], ["Zona", "zona"], ["Eje", "eje"], ["Nivel", "nivel"],
    ["Largo (m)", "largo", 1], ["Espesor (m)", "espesor", 1], ["Alto (m)", "alto", 1], ["Área (m²)", "area", 1], ["Volumen (m³)", "volumen", 1],
    ["Estatus", "_estatus"], ["Estimación", "_estimacion"],
  ];
  function valor(g, k) {
    if (k === "_estatus") return estado(g);
    if (k === "_estimacion") return rec(g).estimacion || "";
    return S.piezas[g][k];
  }
  function resumenDe(filas) {
    var res = {};
    filas.forEach(function (g) {
      var p = S.piezas[g], k = p.contratista + "|" + (p.clave || "");
      var x = res[k] || (res[k] = { contratista: p.contratista, partida: p.partida || "", clave: p.clave || "(sin clave)", concepto: p.concepto || "", pzas: 0, area: 0, volumen: 0 });
      x.pzas++; x.area += p.area || 0; x.volumen += p.volumen || 0;
    });
    return Object.values(res);
  }
  function descripcionVista() {
    var v = $("g-vista").value;
    if (v === "porestimar") return "Sin estimar";
    if (v === "estimadas") return $("g-estnum").value ? "Estimación " + $("g-estnum").value : "Todas las estimadas";
    return "Todas las piezas";
  }

  // Centro de cada pieza en pantalla (pixeles del visor), para poner su marca sobre la foto.
  function puntosDePiezas(guids) {
    var v = S.viewer, m = S.model, it = m.getInstanceTree(), fl = m.getFragmentList(), out = [];
    var caja = new THREE.Box3(), tmp = new THREE.Box3();
    guids.forEach(function (g) {
      var id = S.guid2db.get(g); if (id == null) return;
      caja.makeEmpty();
      it.enumNodeFragments(id, function (f) { fl.getWorldBounds(f, tmp); caja.union(tmp); }, true);
      if (caja.isEmpty()) return;
      var p = v.worldToClient(caja.getCenter(new THREE.Vector3()));
      out.push({ guid: g, marca: S.piezas[g].marca || "(sin marca)", x: p.x, y: p.y, color: COLOR[estado(g)] || COLOR.Planeado });
    });
    return out;
  }

  // Dibuja las etiquetas de marca sobre la foto, moviéndolas si se enciman, con una línea hacia la pieza.
  // Devuelve la imagen y dónde quedó cada pieza (para ubicarla al hacer zoom).
  function etiquetar(dataUrl, w, h, puntos, sx, sy) {
    var k = w / 1600; // tamaños pensados para 1600 px de ancho
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        var ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        ctx.font = "bold " + Math.round(15 * k) + "px Arial"; ctx.textBaseline = "middle";
        var padX = 7 * k, alto = 24 * k, gap = 4 * k;
        var dentro = puntos.map(function (pt) { return { guid: pt.guid, marca: pt.marca, color: pt.color, x: pt.x * sx, y: pt.y * sy }; })
          .filter(function (pt) { return pt.x >= 0 && pt.y >= 0 && pt.x <= w && pt.y <= h; }); // fuera de cuadro: sin etiqueta
        // Obstáculos: los puntos de todas las piezas (para no taparlos) y las etiquetas ya colocadas.
        var puestas = dentro.map(function (pt) { return { x: pt.x - 6 * k, y: pt.y - 6 * k, w: 12 * k, h: 12 * k }; });
        var choca = function (r) { return puestas.some(function (q) { return r.x < q.x + q.w + gap && q.x < r.x + r.w + gap && r.y < q.y + q.h + gap && q.y < r.y + r.h + gap; }); };
        var coloc = [];
        dentro.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (pt) {
          var tw = ctx.measureText(pt.marca).width + padX * 2;
          var caja = function (dx, dy) { return { x: Math.min(Math.max(pt.x - tw / 2 + dx, 2), w - tw - 2), y: Math.min(Math.max(pt.y + dy, 2), h - alto - 2), w: tw, h: alto }; };
          var r = null, lado = tw / 2 + 22 * k;
          // Primero arriba, luego a los lados y abajo, cada vez más lejos.
          [-36, -66, -96, -126, -156].some(function (dy, k) {
            var dyAbajo = [14, 44, 74, 104, 134][k];
            return [[0, dy], [-lado, -12 + dy / 3], [lado, -12 + dy / 3], [0, dyAbajo], [-lado, dy], [lado, dy]].some(function (d) {
              var c = caja(d[0], d[1] * k); if (!choca(c)) { r = c; return true; } return false;
            });
          });
          if (!r) r = caja(0, -36 * k);
          puestas.push(r); coloc.push({ pt: pt, r: r });
        });
        // Líneas con contorno blanco para que se vean sobre piezas oscuras, después los puntos y al final las etiquetas.
        var ancla = function (c) { var r = c.r, cx = Math.min(Math.max(c.pt.x, r.x + 4 * k), r.x + r.w - 4 * k); return { x: cx, y: r.y > c.pt.y ? r.y : (r.y + r.h < c.pt.y ? r.y + r.h : r.y + r.h / 2) }; };
        [["#FFFFFF", 4], ["#111A2B", 1.5]].forEach(function (st) {
          ctx.strokeStyle = st[0]; ctx.lineWidth = st[1] * k;
          coloc.forEach(function (c) { var a = ancla(c); ctx.beginPath(); ctx.moveTo(c.pt.x, c.pt.y); ctx.lineTo(a.x, a.y); ctx.stroke(); });
        });
        coloc.forEach(function (c) {
          ctx.beginPath(); ctx.arc(c.pt.x, c.pt.y, 4 * k, 0, Math.PI * 2);
          ctx.fillStyle = "#111A2B"; ctx.fill(); ctx.lineWidth = 2 * k; ctx.strokeStyle = "#FFFFFF"; ctx.stroke();
        });
        coloc.forEach(function (c) {
          var r = c.r;
          ctx.fillStyle = "rgba(17,26,43,.94)";
          if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, 5 * k); ctx.fill(); } else ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.fillStyle = c.pt.color; ctx.fillRect(r.x + 3 * k, r.y + r.h - 3 * k, r.w - 6 * k, 3 * k);
          ctx.fillStyle = "#FFFFFF"; ctx.fillText(c.pt.marca, r.x + padX, r.y + r.h / 2 - k);
        });
        var pts = {};
        dentro.forEach(function (pt) { if (pt.guid) pts[pt.guid] = { x: pt.x, y: pt.y }; });
        resolve({ data: cv.toDataURL("image/png"), pts: pts });
      };
      img.onerror = function () { resolve({ data: dataUrl, pts: {} }); };
      img.src = dataUrl;
    });
  }

  // Foto del modelo tal como lo deja la pestaña Generador: solo las piezas de la tabla, con su color de estatus
  // y una etiqueta con la marca de cada pieza para ubicarla en la tabla.
  function capturarModelo(guids) {
    var v = S.viewer;
    if (!v || !S.model) return Promise.resolve(null);
    v.clearSelection();
    paintModel(true, guids && guids.length ? guids : null); // solo las piezas que van en el generador
    return new Promise(function (resolve) {
      var listo = false;
      function tomar() {
        if (listo) return; listo = true;
        v.removeEventListener(Autodesk.Viewing.FINAL_FRAME_RENDERED_CHANGED_EVENT, onFrame);
        var c = v.canvas || v.container.querySelector("canvas");
        var cw = (c && c.clientWidth) || 1200, ch = (c && c.clientHeight) || 800;
        var w = 2400, h = Math.round(w * ch / cw); // resolución alta para poder hacer zoom
        var puntos = [];
        try { puntos = puntosDePiezas(guids || []); } catch (e) { puntos = []; }
        v.getScreenShot(w, h, function (url) {
          fetch(url).then(function (r) { return r.blob(); }).then(function (b) {
            var fr = new FileReader();
            fr.onload = function () {
              etiquetar(fr.result, w, h, puntos, w / cw, h / ch).then(function (r) { resolve({ data: r.data, pts: r.pts, w: w, h: h }); });
            };
            fr.onerror = function () { resolve(null); };
            fr.readAsDataURL(b);
          }).catch(function () { resolve(null); });
        });
      }
      function onFrame(e) { if (e.value && e.value.finalFrame) setTimeout(tomar, 150); }
      v.addEventListener(Autodesk.Viewing.FINAL_FRAME_RENDERED_CHANGED_EVENT, onFrame);
      setTimeout(tomar, 3000); // por si el visor no avisa
    });
  }

  $("g-ver").addEventListener("click", function () {
    var filas = genSeleccion() || genFilas();
    if (!filas.length) { toast("No hay piezas en el generador con este filtro."); return; }
    var btn = $("g-ver"); btn.disabled = true; btn.textContent = "Preparando vista…";
    capturarModelo(filas).then(function (img) {
      if (genSeleccion()) { paintModel(false); selectGenEnModelo(); } // regresa el modelo a como estaba
      var c = $("g-contratista").value;
      var grupos = agrupar(filas);
      GP = {
        filas: filas, img: img, grupos: grupos,
        titulo: "Generador" + (c ? " · " + c : ""),
        sub: [S.obra ? S.obra.nombre : "", descripcionVista(), filas.length + (filas.length === 1 ? " pieza" : " piezas"),
          grupos.length > 1 ? grupos.length + " generadores" : "", new Date().toLocaleDateString("es-MX", { dateStyle: "long" })].filter(Boolean).join(" · "),
      };
      if (grupos.length === 1) grupos[0].img = img; // la foto ya es justo de ese generador
      renderPrevia(); textoBotones(); renderGruposPrevia();
      cargarEnvios().then(renderGruposPrevia);
      $("gen-prev").showModal();
    }).finally(function () { btn.disabled = false; btn.textContent = "Ver generador"; actualizarMarcar(); });
  });
  $("gp-cerrar").addEventListener("click", function () { $("gen-prev").close(); });
  $("gen-prev").addEventListener("close", cerrarZoom);

  // ---------- Vista ampliada (zoom) de la referencia visual ----------
  // La imagen ya trae las marcas dibujadas, así que al acercar se conservan.
  var Z = { s: 1, tx: 0, ty: 0, fit: 1 };
  function zVisor() { return $("gp-visor"); }
  function aplicarZ() { $("gp-lienzo").style.transform = "translate(" + Z.tx + "px," + Z.ty + "px) scale(" + Z.s + ")"; }
  function ajustarZ() {
    var v = zVisor(), W = GP.img.w, H = GP.img.h, cw = v.clientWidth, ch = v.clientHeight;
    Z.fit = Math.min(cw / W, ch / H) * 0.96;
    Z.s = Z.fit; Z.tx = (cw - W * Z.s) / 2; Z.ty = (ch - H * Z.s) / 2;
    aplicarZ();
  }
  function zoomZ(f, mx, my) {
    var ns = Math.min(Math.max(Z.s * f, Z.fit * 0.6), Math.max(Z.fit * 8, 2.5));
    Z.tx = mx - (mx - Z.tx) * ns / Z.s; Z.ty = my - (my - Z.ty) * ns / Z.s; Z.s = ns;
    aplicarZ();
  }
  function abrirZoom(g) {
    if (!GP || !GP.img) return;
    var abierto = $("gen-prev").classList.contains("gp-zoom");
    if (!abierto) {
      $("gen-prev").classList.add("gp-zoom");
      zVisor().hidden = false;
      $("gp-zimg").src = GP.img.data; $("gp-zimg").width = GP.img.w; $("gp-zimg").height = GP.img.h;
      ajustarZ();
    }
    qsa("#gp-tabla tbody tr").forEach(function (tr) { tr.classList.toggle("sel", !!g && tr.getAttribute("data-guid") === g); });
    var an = $("gp-anillo"); an.hidden = true;
    if (!g) return;
    var p = GP.img.pts && GP.img.pts[g];
    if (!p) { toast("Esa pieza no quedó dentro de la vista del modelo."); return; }
    var v = zVisor(), cw = v.clientWidth, ch = v.clientHeight;
    Z.s = Math.max(Z.s, Z.fit * 3);
    Z.tx = cw / 2 - p.x * Z.s; Z.ty = ch / 2 - p.y * Z.s;
    aplicarZ();
    var d = Math.round(GP.img.w / 22);
    an.style.left = p.x + "px"; an.style.top = p.y + "px"; an.style.width = d + "px"; an.style.height = d + "px";
    an.hidden = false; an.style.animation = "none"; void an.offsetWidth; an.style.animation = "";
  }
  function cerrarZoom() {
    $("gen-prev").classList.remove("gp-zoom");
    zVisor().hidden = true; $("gp-anillo").hidden = true;
    qsa("#gp-tabla tbody tr.sel").forEach(function (tr) { tr.classList.remove("sel"); });
  }
  (function () {
    var v = zVisor(), arr = null;
    var rel = function (ev) { var r = v.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    v.addEventListener("wheel", function (ev) { ev.preventDefault(); var p = rel(ev); zoomZ(ev.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y); }, { passive: false });
    v.addEventListener("dblclick", function (ev) { if (ev.target.closest(".gp-ctrl")) return; var p = rel(ev); zoomZ(2, p.x, p.y); });
    v.addEventListener("pointerdown", function (ev) {
      if (ev.target.closest(".gp-ctrl")) return;
      arr = { x: ev.clientX, y: ev.clientY, tx: Z.tx, ty: Z.ty }; v.setPointerCapture(ev.pointerId); v.classList.add("arrastrando");
    });
    v.addEventListener("pointermove", function (ev) { if (!arr) return; Z.tx = arr.tx + ev.clientX - arr.x; Z.ty = arr.ty + ev.clientY - arr.y; aplicarZ(); });
    var fin = function () { arr = null; v.classList.remove("arrastrando"); };
    v.addEventListener("pointerup", fin); v.addEventListener("pointercancel", fin);
    $("gp-mas").addEventListener("click", function () { zoomZ(1.4, v.clientWidth / 2, v.clientHeight / 2); });
    $("gp-menos").addEventListener("click", function () { zoomZ(1 / 1.4, v.clientWidth / 2, v.clientHeight / 2); });
    $("gp-ajustar").addEventListener("click", ajustarZ);
    $("gp-salir").addEventListener("click", cerrarZoom);
    window.addEventListener("resize", function () { if ($("gen-prev").classList.contains("gp-zoom")) ajustarZ(); });
  })();

  function renderPrevia() {
    $("gp-titulo").textContent = GP.titulo;
    $("gp-sub").textContent = GP.sub;
    var head = el("tr", null, COLS.map(function (c) { return el("th", { class: c[2] ? "num" : null, text: c[0] }); }).concat([el("th", { class: "refh", text: "Referencia visual" })]));
    var tot = { area: 0, volumen: 0 };
    var rows = GP.filas.map(function (g, i) {
      var p = S.piezas[g]; tot.area += p.area || 0; tot.volumen += p.volumen || 0;
      var tds = COLS.map(function (c) { var x = valor(g, c[1]); return el("td", { class: c[2] ? "num" : null, text: c[2] ? f2(x) : (x || "—") }); });
      if (i === 0) {
        tds.push(el("td", { class: "ref", rowspan: String(GP.filas.length) }, [
          GP.img ? el("img", { src: GP.img.data, alt: "Vista del modelo con las " + GP.filas.length + " piezas del generador", title: "Clic para ampliar", onclick: function (ev) { ev.stopPropagation(); abrirZoom(); } })
                 : el("p", { class: "muted", text: "No se pudo tomar la vista del modelo. Espera a que cargue el modelo e intenta de nuevo." }),
        ]));
      }
      var tr = el("tr", { class: "click", "data-guid": g }, tds);
      // Con vista del modelo: el renglón ubica la pieza en la vista ampliada. Sin vista: lleva a la pieza en el modelo.
      tr.addEventListener("click", function () { if (GP.img) abrirZoom(g); else { $("gen-prev").close(); focusPieces([g]); } });
      return tr;
    });
    var foot = el("tr", null, COLS.map(function (c) {
      if (c[1] === "contratista") return el("td", { text: "Total" });
      if (c[1] === "area") return el("td", { class: "num", text: f2(tot.area) });
      if (c[1] === "volumen") return el("td", { class: "num", text: f2(tot.volumen) });
      return el("td");
    }).concat([el("td")]));
    $("gp-tabla").replaceChildren(el("thead", null, [head]), el("tbody", null, rows), el("tfoot", null, [foot]));
    cerrarZoom();

    var res = resumenDe(GP.filas);
    $("gp-resumen").replaceChildren(
      el("thead", null, [el("tr", null, ["Contratista", "Partida", "Clave", "Concepto", "Pzas", "Área (m²)", "Volumen (m³)"].map(function (h, i) { return el("th", { class: i >= 4 ? "num" : null, text: h }); }))]),
      el("tbody", null, res.map(function (x) {
        return el("tr", null, [el("td", { text: x.contratista }), el("td", { text: x.partida || "—" }), el("td", { text: x.clave }), el("td", { text: x.concepto || "—" }),
          el("td", { class: "num", text: nf0.format(x.pzas) }), el("td", { class: "num", text: f2(x.area) }), el("td", { class: "num", text: f2(x.volumen) })]);
      }))
    );
  }

  // ExcelJS se carga solo al descargar (permite poner la imagen dentro del archivo).
  var EXCELJS = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
  var excelPromise = null;
  function loadExcel() {
    if (window.ExcelJS) return Promise.resolve();
    if (excelPromise) return excelPromise;
    excelPromise = new Promise(function (resolve, reject) {
      var s = el("script", { src: EXCELJS });
      s.onload = resolve;
      s.onerror = function () { excelPromise = null; reject(new Error("No se pudo cargar el generador de Excel. Revisa tu conexión.")); };
      document.head.appendChild(s);
    });
    return excelPromise;
  }

  // Un generador por cada combinación de contratista y estimación (las piezas sin estimación van juntas).
  function agrupar(filas) {
    var m = {}, hoy = new Date().toISOString().slice(0, 10);
    filas.forEach(function (g) {
      var p = S.piezas[g], est = rec(g).estimacion || "";
      var k = p.contratista + "|" + est;
      (m[k] || (m[k] = { contratista: p.contratista, estimacion: est, filas: [] })).filas.push(g);
    });
    return Object.values(m).sort(function (a, b) { return (a.contratista + a.estimacion).localeCompare(b.contratista + b.estimacion, "es", { numeric: true }); })
      .map(function (x) {
        var etiqueta = x.estimacion ? "Estimación " + x.estimacion : "Sin estimar";
        x.titulo = "Generador · " + x.contratista + " · " + etiqueta;
        x.sub = [S.obra ? S.obra.nombre : "", x.filas.length + (x.filas.length === 1 ? " pieza" : " piezas"), new Date().toLocaleDateString("es-MX", { dateStyle: "long" })].filter(Boolean).join(" · ");
        x.archivo = ("Generador_" + x.contratista + "_" + (x.estimacion || "SinEstimar")).replace(/[^\w-]+/g, "_") + "_" + hoy + ".xlsx";
        return x;
      });
  }

  // Arma el Excel de cada generador; la foto de cada uno se toma con solo sus piezas.
  function prepararArchivos(btn, verbo) {
    var gs = GP.grupos, out = [], i = 0;
    var siguiente = function () {
      if (i >= gs.length) return Promise.resolve(out);
      var G = gs[i++];
      btn.textContent = gs.length > 1 ? verbo + " " + i + " de " + gs.length + "…" : verbo + "…";
      var foto = G.img !== undefined || !S.viewer ? Promise.resolve(G.img || GP.img) : capturarModelo(G.filas).then(function (img) { G.img = img; return img; });
      return foto.then(function () { return construirExcel(G); }).then(function (buf) { out.push({ archivo: G.archivo, buf: buf, G: G }); return siguiente(); });
    };
    return loadExcel().then(siguiente).finally(function () { if (gs.length > 1 && S.viewer) paintModel(false); });
  }
  function textoBotones() {
    var n = GP ? GP.grupos.length : 1;
    $("gp-excel").textContent = n > 1 ? "Descargar " + n + " Excel" : "Descargar Excel";
    if ($("gp-forma")) {
      var b = $("gp-forma");
      if (!S.autodesk.conectada) {
        // Sin cuenta propia de Autodesk no se puede enviar: el botón lleva a conectarla.
        b.textContent = "Conectar mi cuenta de Autodesk"; b.disabled = false;
        b.title = "Los generadores se suben a Forma con tu propia cuenta de Autodesk";
        return;
      }
      b.textContent = n > 1 ? "Enviar " + n + " a Forma" : "Enviar a Forma";
      b.disabled = false;
      b.title = "Elige la carpeta de Forma de cada contratista y se suben con tu cuenta de Autodesk";
    }
  }
  // Carpeta de Forma de un contratista; si no tiene, la general.
  function carpetaDe(c) {
    var o = S.obra || {};
    return (o.carpetas && o.carpetas[c]) || o.carpeta || null;
  }
  function renderCuenta() {
    var p = $("g-cuenta"); if (!p) return;
    if (S.autodesk.conectada) {
      p.replaceChildren("Tu cuenta de Autodesk está conectada para enviar generadores a Forma · ",
        el("button", { class: "linklike", type: "button", text: "Desconectar", onclick: function () {
          api("/api/session", { action: "autodesk-desconectar" }).then(function () { S.autodesk = { conectada: false }; renderCuenta(); toast("Tu cuenta de Autodesk se desconectó de la app."); })
            .catch(function (e) { toast(e.message, true); });
        } }));
    } else {
      p.replaceChildren("Para enviar generadores a Forma ", el("a", { href: "/api/forma/cuenta", text: "conecta tu cuenta de Autodesk" }), ".");
    }
  }

  $("gp-excel").addEventListener("click", function () {
    if (!GP) return;
    var btn = $("gp-excel"); btn.disabled = true;
    prepararArchivos(btn, "Generando").then(function (archivos) {
      // Varias descargas seguidas: el navegador puede pedir permiso la primera vez.
      archivos.forEach(function (f, k) {
        setTimeout(function () {
          var url = URL.createObjectURL(new Blob([f.buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
          var a = el("a", { href: url, download: f.archivo }); document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
        }, k * 600);
      });
      if (archivos.length > 1) toast(archivos.length + " archivos descargados. Si el navegador lo pregunta, permite las descargas múltiples.");
    }).catch(function (e) { toast(e.message || "No se pudo generar el Excel.", true); })
      .finally(function () { btn.disabled = false; textoBotones(); });
  });

  function aBase64(buf) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(String(fr.result).split(",")[1]); };
      fr.onerror = function () { reject(new Error("No se pudo preparar el archivo.")); };
      fr.readAsDataURL(new Blob([buf]));
    });
  }
  if ($("gp-forma")) {
    $("gp-forma").addEventListener("click", function () {
      if (!GP) return;
      if (!S.autodesk.conectada) { location.href = "/api/forma/cuenta"; return; }
      var btn = $("gp-forma"); btn.disabled = true;
      var enviados = [];
      // Primero se elige (o confirma) la carpeta de cada contratista en el explorador de Forma.
      var contrs = Array.from(new Set(GP.grupos.map(function (G) { return G.contratista; })));
      var elegir = function (i) {
        if (i >= contrs.length) return Promise.resolve(true);
        var c = contrs[i], actual = carpetaDe(c);
        return elegirCarpeta({ contratista: c, titulo: "¿En qué carpeta guardo los generadores de " + c + "?" + (contrs.length > 1 ? " (" + (i + 1) + " de " + contrs.length + ")" : ""),
          ruta: S.obra.carpetas && S.obra.carpetas[c] ? actual.ruta : null })
          .then(function (sel) {
            if (!sel) return false;
            return guardarCarpeta(c, sel).then(function () { return elegir(i + 1); });
          });
      };
      elegir(0).then(function (ok) {
        if (!ok) { toast("Envío cancelado."); return "cancelado"; }
        renderGruposPrevia();
        return prepararArchivos(btn, "Preparando");
      }).then(function (archivos) {
        if (archivos === "cancelado") return;
        var k = 0;
        var uno = function () {
          if (k >= archivos.length) return Promise.resolve();
          var f = archivos[k++];
          btn.textContent = archivos.length > 1 ? "Enviando " + k + " de " + archivos.length + "…" : "Enviando…";
          var tot = f.G.filas.reduce(function (a, g) { var p = S.piezas[g]; a.area += p.area || 0; a.volumen += p.volumen || 0; return a; }, { area: 0, volumen: 0 });
          return aBase64(f.buf).then(function (b64) {
            return api("/api/envio", { nombre: f.archivo, base64: b64, contratista: f.G.contratista, estimacion: f.G.estimacion, piezas: f.G.filas.length, area: tot.area, volumen: tot.volumen });
          })
            .then(function (r) { enviados.push(r); return uno(); });
        };
        return uno();
      }).then(function () {
        if (!enviados.length) return; // se canceló al elegir carpeta
        var cs = Array.from(new Set(enviados.map(function (x) { return "«" + x.carpeta + "»"; }))).join(", ");
        toast(enviados.length === 1
          ? "«" + enviados[0].nombre + "» quedó en la carpeta " + cs + " de Forma" + (enviados[0].nuevo ? "." : " como versión " + enviados[0].version + ".")
          : enviados.length + " generadores quedaron en Forma: " + cs + ".", false, 8000);
      }).catch(function (e) {
        toast((enviados.length ? enviados.length + " enviados antes del error. " : "") + (e.message || "No se pudo enviar a Forma."), true, 20000);
      }).finally(function () { btn.disabled = false; textoBotones(); cargarEnvios().then(renderGruposPrevia); });
    });
  }

  // ---------- Bitácora de envíos a Forma ----------
  function cargarEnvios() {
    return api("/api/envio").then(function (r) { S.envios = r.envios || []; }).catch(function () { /* sin bitácora */ });
  }
  // Último envío del mismo contratista y estimación (los "Sin estimar" cambian de nombre por día).
  function ultimoEnvio(G) {
    return S.envios.filter(function (e) { return e.contratista === G.contratista && (e.estimacion || "") === (G.estimacion || ""); })
      .sort(function (a, b) { return a.ultimo.at < b.ultimo.at ? 1 : -1; })[0] || null;
  }
  function renderGruposPrevia() {
    if (!GP) return;
    $("gp-grupos").replaceChildren.apply($("gp-grupos"), GP.grupos.map(function (G) {
      var dest = carpetaDe(G.contratista);
      var e = ultimoEnvio(G), nombre = G.contratista + " · " + (G.estimacion || "Sin estimar") + (dest ? " → «" + dest.nombre + "»" : " → sin carpeta");
      if (!e) return pill("Planeado", nombre + " — no enviado a Forma");
      var mismo = e.nombre === G.archivo;
      var txt = nombre + " — enviado " + fecha(e.ultimo.at) + " por " + e.ultimo.por + (e.ultimo.version ? " (versión " + e.ultimo.version + ")" : "");
      if (!mismo) txt += " · archivo de otro día";
      if (e.piezas != null && e.piezas !== G.filas.length) txt += " · se enviaron " + e.piezas + " piezas, ahora son " + G.filas.length;
      return pill("Terminado", txt);
    }));
  }
  $("g-envios").addEventListener("click", function () {
    $("ev-tabla").replaceChildren(el("tbody", null, [el("tr", null, [el("td", { text: "Cargando…" })])]));
    $("envios").showModal();
    cargarEnvios().then(function () {
      var c = $("g-contratista").value;
      var lista = S.envios.filter(function (e) { return !c || e.contratista === c; });
      $("ev-sub").textContent = (c ? c + " · " : "") + lista.length + (lista.length === 1 ? " archivo enviado" : " archivos enviados") + (S.obra && S.obra.carpeta ? " a la carpeta «" + S.obra.carpeta.nombre + "»" : "");
      var head = el("tr", null, ["Archivo", "Contratista", "Estimación", "Piezas", "Área m²", "Vol. m³", "Versión", "Último envío", "Envíos"].map(function (h, i) { return el("th", { class: i >= 3 && i <= 6 || i === 8 ? "num" : null, text: h }); }));
      var rows = lista.map(function (e) {
        var tr = el("tr", { class: "click" }, [
          el("td", { text: e.nombre }), el("td", { text: e.contratista || "—" }), el("td", { text: e.estimacion || "Sin estimar" }),
          el("td", { class: "num", text: e.piezas == null ? "—" : nf0.format(e.piezas) }), el("td", { class: "num", text: f2(e.area) }), el("td", { class: "num", text: f2(e.volumen) }),
          el("td", { class: "num", text: e.ultimo.version || "—" }), el("td", { text: fecha(e.ultimo.at) + " · " + e.ultimo.por }), el("td", { class: "num", text: String((e.envios || []).length) }),
        ]);
        tr.title = (e.envios || []).slice().reverse().map(function (x) { return fecha(x.at) + " · " + x.por + (x.version ? " · v" + x.version : "") + (x.piezas != null ? " · " + x.piezas + " pzas" : ""); }).join("\n");
        return tr;
      });
      if (!rows.length) rows = [el("tr", null, [el("td", { colspan: "9", class: "muted", text: "Todavía no se ha enviado ningún generador" + (c ? " de " + c : "") + " a Forma." })])];
      $("ev-tabla").replaceChildren(el("thead", null, [head]), el("tbody", null, rows));
    });
  });
  $("ev-cerrar").addEventListener("click", function () { $("envios").close(); });

  function construirExcel(G) {
    var wb = new ExcelJS.Workbook();
    wb.creator = "OBYRA Control"; wb.created = new Date();
    var fuente = { name: "Arial", size: 10 };
    var bordes = { top: { style: "thin", color: { argb: "FFBFC7D5" } }, bottom: { style: "thin", color: { argb: "FFBFC7D5" } }, left: { style: "thin", color: { argb: "FFBFC7D5" } }, right: { style: "thin", color: { argb: "FFBFC7D5" } } };
    var encabezado = function (row) {
      row.eachCell(function (c) { c.font = { name: "Arial", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111A2B" } }; c.border = bordes; c.alignment = { vertical: "middle", wrapText: true }; });
      row.height = 30;
    };

    // Hoja Generador: título, tabla de piezas y la vista del modelo en una celda combinada.
    var ws = wb.addWorksheet("Generador", { views: [{ state: "frozen", ySplit: 5 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
    var nCols = COLS.length + 1, refCol = nCols;
    ws.getCell(1, 1).value = G.titulo; ws.getCell(1, 1).font = { name: "Arial", size: 14, bold: true };
    ws.getCell(2, 1).value = G.sub; ws.getCell(2, 1).font = { name: "Arial", size: 10, color: { argb: "FF4A5568" } };
    ws.getCell(3, 1).value = "Cantidades tomadas del modelo IFC" + (S.obra && S.obra.modelo ? " (" + S.obra.modelo.archivo + ", versión " + S.obra.modelo.version + ")" : "") + ".";
    ws.getCell(3, 1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF4A5568" } };
    var hg = ws.getRow(5);
    hg.values = COLS.map(function (c) { return c[0]; }).concat(["Referencia visual"]);
    encabezado(hg);

    var first = 6;
    G.filas.forEach(function (g, i) {
      var row = ws.getRow(first + i);
      COLS.forEach(function (c, j) {
        var cell = row.getCell(j + 1), x = valor(g, c[1]);
        cell.value = c[2] ? (x == null ? null : x) : (x || "");
        cell.font = fuente; cell.border = bordes;
        if (c[2]) cell.numFmt = "#,##0.00";
      });
    });
    var last = first + G.filas.length - 1;
    // Totales con fórmula para que se recalculen si editan cantidades.
    var tot = ws.getRow(last + 1);
    tot.getCell(1).value = "Total";
    COLS.forEach(function (c, j) {
      if (c[1] === "area" || c[1] === "volumen") {
        var L = ws.getColumn(j + 1).letter;
        tot.getCell(j + 1).value = { formula: "SUM(" + L + first + ":" + L + last + ")" };
        tot.getCell(j + 1).numFmt = "#,##0.00";
      }
    });
    tot.eachCell(function (c) { c.font = { name: "Arial", size: 10, bold: true }; c.border = { top: { style: "medium" } }; });

    var widths = { contratista: 14, clave: 10, concepto: 34, marca: 10, zona: 16, eje: 8, nivel: 14, _estatus: 13, _estimacion: 12 };
    COLS.forEach(function (c, j) { ws.getColumn(j + 1).width = widths[c[1]] || 11; });
    var imgW = 520, imgH = G.img ? Math.round(imgW * G.img.h / G.img.w) : 0;
    ws.getColumn(refCol).width = 76;
    ws.mergeCells(first, refCol, last + 1, refCol);
    var refCell = ws.getCell(first, refCol);
    refCell.border = bordes; refCell.alignment = { vertical: "top" };
    if (G.img) {
      // Altura suficiente en los renglones combinados para que la imagen no se encime con lo de abajo.
      var alto = Math.max(15, Math.ceil((imgH + 16) * 0.75 / (G.filas.length + 1)));
      for (var r = first; r <= last + 1; r++) ws.getRow(r).height = Math.max(ws.getRow(r).height || 15, alto);
      var id = wb.addImage({ base64: G.img.data, extension: "png" });
      ws.addImage(id, { tl: { col: refCol - 1 + 0.05, row: first - 1 + 0.1 }, ext: { width: imgW, height: imgH }, editAs: "oneCell" });
    } else {
      refCell.value = "Sin vista del modelo";
    }
    ws.autoFilter = { from: { row: 5, column: 1 }, to: { row: last, column: COLS.length } };

    // Hoja Resumen por concepto, con totales por fórmula.
    var rs = wb.addWorksheet("Resumen");
    rs.getCell(1, 1).value = G.titulo + " · Resumen por concepto"; rs.getCell(1, 1).font = { name: "Arial", size: 14, bold: true };
    rs.getCell(2, 1).value = G.sub; rs.getCell(2, 1).font = { name: "Arial", size: 10, color: { argb: "FF4A5568" } };
    var hr = rs.getRow(4); hr.values = ["Contratista", "Partida", "Clave", "Concepto", "Pzas", "Área (m²)", "Volumen (m³)"]; encabezado(hr);
    var res = resumenDe(G.filas);
    res.forEach(function (x, i) {
      var row = rs.getRow(5 + i);
      row.values = [x.contratista, x.partida, x.clave, x.concepto, x.pzas, Math.round(x.area * 1000) / 1000, Math.round(x.volumen * 1000) / 1000];
      row.eachCell({ includeEmpty: true }, function (c, j) { c.font = fuente; c.border = bordes; if (j >= 6) c.numFmt = "#,##0.00"; });
    });
    var rl = 4 + res.length, rt = rs.getRow(rl + 1);
    rt.getCell(1).value = "Total";
    ["E", "F", "G"].forEach(function (L, k) { var c = rt.getCell(5 + k); c.value = { formula: "SUM(" + L + "5:" + L + rl + ")" }; c.numFmt = k ? "#,##0.00" : "0"; });
    rt.eachCell(function (c) { c.font = { name: "Arial", size: 10, bold: true }; c.border = { top: { style: "medium" } }; });
    [14, 18, 10, 40, 8, 12, 13].forEach(function (w, j) { rs.getColumn(j + 1).width = w; });

    return wb.xlsx.writeBuffer();
  }

  if ($("g-marcar")) {
    $("g-marcar").addEventListener("click", function () {
      var est = $("g-est").value.trim();
      if (!est) { toast("Escribe la estimación (ej. AD-003)."); $("g-est").focus(); return; }
      var guids = (genSeleccion() || genFilas()).filter(estimable);
      if (!guids.length) { toast("No hay piezas terminadas y aprobadas para estimar con este filtro."); return; }
      var btn = $("g-marcar");
      if (btn.getAttribute("data-confirm") !== est) {
        btn.setAttribute("data-confirm", est);
        btn.textContent = "Confirmar: " + guids.length + (guids.length === 1 ? " terminada" : " terminadas") + " a " + est.toUpperCase();
        setTimeout(function () { btn.removeAttribute("data-confirm"); actualizarMarcar(); }, 6000);
        return;
      }
      btn.removeAttribute("data-confirm");
      actualizarMarcar();
      api("/api/piezas", { action: "estimar", guids: guids, estimacion: est })
        .then(function (r) {
          Object.assign(S.avance, r.avance);
          toast(nf0.format(r.actualizadas) + " piezas asignadas a " + est.toUpperCase() + ".");
          S.gSel.clear();
          renderGenerador(); renderLista(); paintModel();
        })
        .catch(function (e) { toast(e.message, true); });
    });
  }

  // ---------- Configuración (admin) ----------
  // Aviso al administrador: en Forma hay una versión más nueva del IFC.
  function avisoVersion(n) {
    var box = $("aviso-version");
    if (!n || !S.permisos.administrar) { box.hidden = true; return; }
    var actual = S.obra.modelo ? S.obra.modelo.version : "?";
    var usar = el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Usar la versión " + n.version, onclick: function () {
      usar.disabled = true; usar.textContent = "Cambiando…";
      api("/api/obra", { action: "actualizar" }).then(function () { return api("/api/obra"); }).then(function (o) {
        S.obra = o; renderAdmin(); startViewer();
        box.replaceChildren(
          el("span", null, ["Modelo actualizado a la ", el("b", { text: "versión " + o.modelo.version }), ". Cuando termine de cargar, lee las piezas para traer marcas, cantidades y piezas nuevas (el avance se conserva)."]),
          el("div", { class: "row end" }, [
            el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Después", onclick: function () { box.hidden = true; } }),
            el("button", { class: "btn btn-primary btn-sm", type: "button", text: "Leer piezas del modelo", onclick: function () {
              if (!S.model || !S.guid2db.size) { toast("Espera a que el modelo termine de cargar."); return; }
              box.hidden = true; leerCatalogo();
            } }),
          ]));
      }).catch(function (e) { usar.disabled = false; usar.textContent = "Usar la versión " + n.version; toast(e.message, true); });
    } });
    box.replaceChildren(
      el("span", null, ["Hay una ", el("b", { text: "versión " + n.version }), " del IFC en Forma (", n.archivo, n.fecha ? " · " + fecha(n.fecha) : "", "). La app muestra la versión " + actual + "."]),
      el("small", { class: "muted", text: "Si Forma aún la está procesando, espera unos minutos antes de cambiar." }),
      el("div", { class: "row end" }, [el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Ahora no", onclick: function () { box.hidden = true; } }), usar]),
    );
    box.hidden = false;
  }

  function renderAdmin() {
    var o = S.obra;
    $("obra-input").value = o.nombre;
    var f = o.forma || {};
    $("forma-estado").textContent = f.conectado
      ? "Conectado con la cuenta de " + f.por + " desde " + fecha(f.desde).replace(/\.$/, "") + ". Esta conexión solo lee el IFC y las carpetas; los generadores los sube cada residente con su propia cuenta."
      : "Sin conectar. Conecta una cuenta de Autodesk con acceso al proyecto donde está el IFC.";
    $("forma-btn").textContent = f.conectado ? "Volver a conectar" : "Conectar Forma";
    $("modelo-url").value = o.formaUrl || "";
    renderCarpetasContr();
    $("modelo-estado").textContent = o.modelo ? o.modelo.archivo + " · versión " + o.modelo.version + " · revisado " + fecha(o.modelo.actualizado) : "Sin modelo.";
    $("cat-estado").textContent = S.version ? Object.keys(S.piezas).length + " piezas leídas de la versión " + S.version + "." : "Aún no se han leído piezas.";
  }
  // Una fila por contratista (los del modelo y los que ya tienen carpeta) más la carpeta general.
  function renderCarpetasContr() {
    var o = S.obra || {}, cs = o.carpetas || {};
    var lista = Array.from(new Set(Object.values(S.piezas).map(function (p) { return p.contratista; }).filter(Boolean).concat(Object.keys(cs)))).sort();
    var fila = function (c, actual, quitar) {
      var elegir = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: actual ? "Cambiar" : "Elegir carpeta", onclick: function () {
        elegirCarpeta({ contratista: c, titulo: c ? "Carpeta de " + c : "Carpeta general", ruta: actual ? actual.ruta : null })
          .then(function (sel) { if (sel) return guardarCarpeta(c, sel).then(function () { renderCarpetasContr(); toast(c ? "Carpeta de " + c + " guardada." : "Carpeta general guardada."); }); })
          .catch(function (e) { toast(e.message, true); });
      } });
      return el("div", { class: "carpeta-contr" }, [
        el("b", { text: c || "General (contratistas sin carpeta propia)" }), elegir,
        quitar && actual ? el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Quitar", onclick: function () {
          saveObra({ action: "carpeta", contratista: c, url: "" }, c + " usará la carpeta general.");
        } }) : el("span"),
        el("p", { class: "muted", text: actual ? rutaTexto(actual) : (c && o.carpeta ? "Usa la carpeta general «" + o.carpeta.nombre + "»" : "Sin carpeta") }),
      ]);
    };
    $("carpetas-contr").replaceChildren.apply($("carpetas-contr"), [fila("", o.carpeta, false)].concat(lista.map(function (c) { return fila(c, cs[c], true); })));
  }
  function rutaTexto(c) { return (c.ruta && c.ruta.length ? c.ruta.map(function (x) { return x.nombre; }).join(" / ") : "«" + c.nombre + "»"); }
  function guardarCarpeta(contratista, sel) {
    return api("/api/carpetas", { contratista: contratista, folderUrn: sel.id, ruta: sel.ruta }).then(function (r) {
      S.obra = S.obra || {};
      var dato = { nombre: r.carpeta.nombre, ruta: r.carpeta.ruta };
      if (contratista) { S.obra.carpetas = S.obra.carpetas || {}; S.obra.carpetas[contratista] = dato; } else S.obra.carpeta = dato;
      if ($("carpetas-contr")) renderCarpetasContr();
      return dato;
    });
  }

  // ---------- Explorador de carpetas de Forma (como el de Windows) ----------
  var PK = { cache: {}, resolver: null };
  function norm2(x) { return String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
  // Abre el explorador y resuelve con {id, nombre, ruta} o null si se cancela.
  function elegirCarpeta(op) {
    return new Promise(function (resolve) {
      PK.resolver = resolve;
      PK.contratista = op.contratista || "";
      var ruta = (op.ruta || []).slice();
      PK.sel = ruta.length ? ruta[ruta.length - 1] : null;   // carpeta guardada: queda seleccionada
      PK.ruta = ruta.length ? ruta.slice(0, -1) : [];         // y se abre la carpeta que la contiene
      $("pk-titulo").textContent = op.titulo || "Elige la carpeta";
      $("pk-sub").textContent = op.sub || (PK.contratista ? "Busca la carpeta con el nombre de " + PK.contratista + "." : "");
      $("pk-buscar").value = ""; PK.remotos = null;
      $("pk-buscar").placeholder = "Buscar carpeta (aquí y en subcarpetas)";
      $("picker").showModal();
      if (ruta.length) { pkCargar(); return; }
      // Sin carpeta guardada: abre donde está el IFC, con la ruta completa arriba.
      $("pk-lista").replaceChildren(el("li", { class: "empty", text: "Cargando carpetas de Forma…" }));
      (PK.inicio ? Promise.resolve(PK.inicio) : api("/api/carpetas?inicio=1").then(function (r) { PK.inicio = r.ruta || []; return PK.inicio; }))
        .catch(function () { return []; })
        .then(function (r) { PK.ruta = r.slice(); pkCargar(); });
    });
  }
  function pkActual() { return PK.ruta.length ? PK.ruta[PK.ruta.length - 1] : null; }
  function pkCargar() {
    var padre = pkActual(), k = padre ? padre.id : "";
    $("pk-lista").replaceChildren(el("li", { class: "empty", text: "Cargando carpetas de Forma…" }));
    pkRuta();
    var p = PK.cache[k] ? Promise.resolve(PK.cache[k]) : api("/api/carpetas" + (k ? "?padre=" + encodeURIComponent(k) : "")).then(function (r) { PK.cache[k] = r.carpetas; return r.carpetas; });
    p.then(function (lista) {
      if (pkActual() !== padre) return; // ya se movió a otra carpeta
      PK.lista = lista;
      // Si no hay carpeta elegida, sugiere la que tenga el nombre del contratista.
      if (!PK.sel && PK.contratista) {
        var m = lista.filter(function (f) { return norm2(f.nombre).indexOf(norm2(PK.contratista)) >= 0; });
        if (m.length === 1) PK.sel = m[0];
      }
      pkRender();
    }).catch(function (e) { $("pk-lista").replaceChildren(el("li", { class: "empty", text: e.message })); });
  }
  function pkRuta() {
    var partes = [el("button", { type: "button", text: "Proyecto", onclick: function () { PK.ruta = []; PK.sel = null; pkCargar(); } })];
    PK.ruta.forEach(function (f, i) {
      partes.push(el("span", { text: "›" }), el("button", { type: "button", text: f.nombre, onclick: function () { PK.ruta = PK.ruta.slice(0, i + 1); PK.sel = null; pkCargar(); } }));
    });
    $("pk-ruta").replaceChildren.apply($("pk-ruta"), partes);
  }
  function pkRender() {
    var q = norm2($("pk-buscar").value), c = norm2(PK.contratista);
    var lista = (PK.lista || []).filter(function (f) { return !q || norm2(f.nombre).indexOf(q) >= 0; });
    if (!lista.length) {
      $("pk-lista").replaceChildren(el("li", { class: "empty", text: q ? "Ninguna carpeta coincide." : "Esta carpeta no tiene subcarpetas. Puedes seleccionarla tal cual." }));
    } else {
      $("pk-lista").replaceChildren.apply($("pk-lista"), lista.map(function (f) {
        var entrar = el("button", { class: "entrar", type: "button", "aria-label": "Abrir " + f.nombre, text: "›", onclick: function (ev) { ev.stopPropagation(); pkEntrar(f); } });
        var li = el("li", { class: PK.sel && PK.sel.id === f.id ? "sel" : "" }, [
          el("i", { class: "ico", "aria-hidden": "true" }),
          el("span", { class: "m" }, [f.nombre, c && norm2(f.nombre).indexOf(c) >= 0 ? el("span", { class: "sug", text: "sugerida" }) : null]),
          entrar,
        ]);
        li.addEventListener("click", function () { PK.sel = f; pkRender(); });
        li.addEventListener("dblclick", function () { pkEntrar(f); });
        return li;
      }));
    }
    // Resultados en subcarpetas.
    if (PK.remotos === "buscando") {
      $("pk-lista").appendChild(el("li", { class: "empty", text: "Buscando en subcarpetas…" }));
    } else if (Array.isArray(PK.remotos)) {
      var locales = new Set(lista.map(function (f) { return f.id; }));
      var extra = PK.remotos.filter(function (r) { return !locales.has(r.id); });
      if (lista.length === 0 && $("pk-lista").firstChild && $("pk-lista").firstChild.classList.contains("empty")) $("pk-lista").replaceChildren();
      if (!extra.length && !lista.length) $("pk-lista").appendChild(el("li", { class: "empty", text: "Tampoco se encontró en las subcarpetas." }));
      extra.forEach(function (r) {
        var li = el("li", null, [
          el("i", { class: "ico", "aria-hidden": "true" }),
          el("span", { class: "m" }, [r.nombre, el("small", { class: "pk-donde", text: r.ruta.slice(0, -1).map(function (x) { return x.nombre; }).join(" / ") || "aquí" })]),
          el("button", { class: "entrar", type: "button", "aria-label": "Ir a " + r.nombre, text: "›", onclick: function (ev) { ev.stopPropagation(); pkIrA(r); } }),
        ]);
        li.addEventListener("click", function () { pkIrA(r); });
        $("pk-lista").appendChild(li);
      });
    }
    var destino = PK.sel || pkActual();
    $("pk-ok").disabled = !destino;
    $("pk-ok").textContent = destino ? "Guardar en «" + destino.nombre + "»" : "Elige una carpeta";
  }
  function pkEntrar(f) { PK.ruta = PK.ruta.concat([f]); PK.sel = null; $("pk-buscar").value = ""; PK.remotos = null; pkCargar(); }

  // Búsqueda en subcarpetas (además del filtro de la carpeta actual).
  var pkT = null;
  function pkBuscarRemoto() {
    clearTimeout(pkT);
    var q = $("pk-buscar").value.trim(), padre = pkActual();
    PK.remotos = null;
    if (q.length < 3 || !padre) { pkRender(); return; }
    PK.remotos = "buscando"; pkRender();
    pkT = setTimeout(function () {
      api("/api/carpetas?buscar=" + encodeURIComponent(q) + "&padre=" + encodeURIComponent(padre.id)).then(function (r) {
        if ($("pk-buscar").value.trim() !== q || pkActual() !== padre) return;
        PK.remotos = r.resultados || []; pkRender();
      }).catch(function (e) { PK.remotos = []; toast(e.message, true); pkRender(); });
    }, 450);
  }
  function pkIrA(res) {
    // Abre la carpeta que contiene el resultado y lo deja seleccionado.
    PK.ruta = PK.ruta.concat(res.ruta.slice(0, -1)); PK.sel = { id: res.id, nombre: res.nombre };
    $("pk-buscar").value = ""; PK.remotos = null; pkCargar();
  }
  function pkCerrar(valor) { var r = PK.resolver; PK.resolver = null; $("picker").close(); if (r) r(valor); }
  $("pk-buscar").addEventListener("input", function () { pkRender(); pkBuscarRemoto(); });
  $("pk-cancelar").addEventListener("click", function () { pkCerrar(null); });
  $("picker").addEventListener("cancel", function (ev) { ev.preventDefault(); pkCerrar(null); });
  $("pk-ok").addEventListener("click", function () {
    var d = PK.sel || pkActual(); if (!d) return;
    var ruta = PK.sel && (!pkActual() || PK.sel.id !== pkActual().id) ? PK.ruta.concat([PK.sel]) : PK.ruta.slice();
    pkCerrar({ id: d.id, nombre: d.nombre, ruta: ruta });
  });

  function saveObra(body, okMsg) {
    return api("/api/obra", body).then(function () { return api("/api/obra"); }).then(function (o) {
      var cambio = !S.obra.modelo || !o.modelo || S.obra.modelo.urn !== o.modelo.urn;
      S.obra = o; $("obra-nombre").textContent = o.nombre; renderAdmin(); toast(okMsg);
      if (cambio && o.modelo) { toast(okMsg + " Cargando el modelo…"); startViewer(); }
    }).catch(function (e) { toast(e.message, true); });
  }
  if ($("obra-form")) {
    $("obra-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveObra({ action: "nombre", nombre: $("obra-input").value }, "Nombre guardado."); });
    $("modelo-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveObra({ action: "modelo", url: $("modelo-url").value }, "Modelo guardado."); });
    $("modelo-act").addEventListener("click", function () { saveObra({ action: "actualizar" }, "Versión revisada."); });
    $("cat-btn").addEventListener("click", leerCatalogo);
    $("u-nuevo").addEventListener("click", resetUserForm);
    $("u-rol").addEventListener("change", function () { $("u-contratista").hidden = $("u-rol").value !== "contratista"; });
    $("u-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      api("/api/users", { action: "save", email: $("u-email").value, nombre: $("u-nombre").value, rol: $("u-rol").value, contratista: $("u-contratista").value, activo: $("u-activo").checked, password: $("u-pass").value || undefined })
        .then(function () { toast("Usuario guardado."); resetUserForm(); loadUsers(); })
        .catch(function (e) { toast(e.message, true); });
    });
  }
  function resetUserForm() {
    $("u-form").reset(); $("u-email").readOnly = false; $("u-form-title").textContent = "Nuevo usuario"; $("u-activo").checked = true;
    $("u-contratista").hidden = $("u-rol").value !== "contratista";
  }
  function loadUsers() {
    if (!S.permisos.administrar) return;
    api("/api/users").then(function (r) {
      if (!$("u-rol").options.length) { fillSelect($("u-rol"), Object.keys(r.roles).map(function (k) { return [k, r.roles[k]]; })); $("u-rol").value = "residente"; $("u-contratista").hidden = true; }
      var head = el("tr", null, ["Nombre", "Correo", "Rol", "Contratista", ""].map(function (h) { return el("th", { text: h }); }));
      var rows = r.users.map(function (u) {
        var del = u.email === S.me.email ? el("span") : el("button", { class: "btn btn-ghost btn-sm", type: "button", text: "Eliminar", onclick: function (ev) {
          ev.stopPropagation();
          if (del.getAttribute("data-c") !== "1") { del.setAttribute("data-c", "1"); del.textContent = "¿Seguro?"; setTimeout(function () { del.removeAttribute("data-c"); del.textContent = "Eliminar"; }, 4000); return; }
          api("/api/users", { action: "delete", email: u.email }).then(function () { toast("Usuario eliminado."); loadUsers(); }).catch(function (e) { toast(e.message, true); });
        } });
        var tr = el("tr", { class: "click" }, [
          el("td", { text: u.nombre + (u.activo ? "" : " (inactivo)") }), el("td", { text: u.email }), el("td", { text: r.roles[u.rol] || u.rol }), el("td", { text: u.contratista || "—" }), el("td", null, [del]),
        ]);
        tr.addEventListener("click", function () {
          $("u-email").value = u.email; $("u-email").readOnly = true; $("u-nombre").value = u.nombre; $("u-rol").value = u.rol;
          $("u-contratista").value = u.contratista; $("u-contratista").hidden = u.rol !== "contratista"; $("u-activo").checked = u.activo; $("u-pass").value = "";
          $("u-form-title").textContent = "Editar " + u.nombre + " (deja la contraseña vacía para no cambiarla)";
        });
        return tr;
      });
      $("u-tabla").replaceChildren(el("thead", null, [head]), el("tbody", null, rows));
    }).catch(function (e) { toast(e.message, true); });
  }

  // ---------- Visor ----------
  var VIEWER_JS = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js";
  var VIEWER_CSS = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css";
  var libPromise = null;
  function viewerMsg(t) { var m = $("viewer-msg"); m.textContent = t || ""; m.hidden = !t; }

  function loadLib() {
    if (libPromise) return libPromise;
    libPromise = new Promise(function (resolve, reject) {
      if (window.Autodesk && window.Autodesk.Viewing) return resolve();
      document.head.appendChild(el("link", { rel: "stylesheet", href: VIEWER_CSS }));
      var s = el("script", { src: VIEWER_JS });
      s.onload = resolve;
      s.onerror = function () { libPromise = null; reject(new Error("No se pudo cargar el visor de Autodesk. Revisa tu conexión.")); };
      document.head.appendChild(s);
    }).then(function () {
      return new Promise(function (resolve) {
        Autodesk.Viewing.Initializer({
          env: "AutodeskProduction2", api: "streamingV2",
          getAccessToken: function (cb) {
            fetch("/api/forma/token", { credentials: "same-origin" })
              .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error); return j; }); })
              .then(function (t) { cb(t.access_token, t.expires_in); })
              .catch(function (e) { viewerMsg(e.message || "No se pudo obtener acceso al modelo."); cb("", 0); });
          },
        }, resolve);
      });
    });
    return libPromise;
  }

  function startViewer() {
    if (!S.obra || !S.obra.modelo) {
      viewerMsg(S.permisos.administrar ? "Aún no hay modelo. En Configuración conecta Forma y pega la liga del IFC." : "El administrador aún no ha cargado el modelo de la obra.");
      return;
    }
    viewerMsg("Cargando el modelo…");
    loadLib().then(function () {
      if (S.viewer) { try { S.viewer.finish(); } catch (e) { /* nada */ } S.viewer = null; }
      var v = new Autodesk.Viewing.GuiViewer3D($("viewer"), { theme: "dark-theme" });
      v.start();
      v.setGhosting(true);
      S.viewer = v;
      Autodesk.Viewing.Document.load("urn:" + S.obra.modelo.urn, function (doc) {
        var node = doc.getRoot().getDefaultGeometry();
        if (!node) { viewerMsg("Forma todavía no termina de procesar el IFC para verlo. Intenta en unos minutos."); return; }
        v.loadDocumentNode(doc, node).then(function (model) {
          S.model = model;
          $("multi").hidden = false;
          v.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, function () { buildMaps().then(function () { viewerMsg(""); paintModel(); }); });
          if (model.getInstanceTree()) buildMaps().then(function () { viewerMsg(""); paintModel(); });
          v.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, onViewerSelect);
        }).catch(function () { viewerMsg("No se pudo cargar el modelo."); });
      }, function (code, msg) {
        viewerMsg(code === 4 || code === 5 ? "La cuenta conectada a Forma no tiene acceso a este modelo, o la conexión venció. Un administrador debe volver a conectar Forma." : "No se pudo abrir el modelo de Forma (" + (msg || code) + ").");
      });
    }).catch(function (e) { viewerMsg(e.message); });
  }

  var GUID_RE = /^[0-9A-Za-z_$]{22}$/;
  var GUID_PROPS = ["GlobalId", "GLOBALID", "IfcGUID", "IFC GUID", "Ifc GUID", "IfcGuid"];
  function leafIds() {
    var it = S.model.getInstanceTree(), out = [];
    it.enumNodeChildren(it.getRootId(), function (id) { if (!it.getChildCount(id)) out.push(id); }, true);
    return out;
  }
  function allIds() {
    var it = S.model.getInstanceTree(), out = [];
    it.enumNodeChildren(it.getRootId(), function (id) { out.push(id); }, true);
    return out;
  }
  function bulk(ids, filter) {
    return new Promise(function (resolve, reject) {
      S.model.getBulkProperties(ids, filter ? { propFilter: filter } : {}, resolve, reject);
    });
  }
  // Relación GlobalId ↔ dbId. Los IFC convertidos por Forma suelen traer el GlobalId como externalId;
  // si no, se busca en las propiedades.
  function buildMaps() {
    if (!S.model || buildMaps.busy) return buildMaps.busy || Promise.resolve();
    buildMaps.busy = new Promise(function (resolve) {
      S.model.getExternalIdMapping(function (map) {
        var keys = Object.keys(map), ok = keys.filter(function (k) { return GUID_RE.test(k); }).length;
        S.guid2db = new Map(); S.db2guid = new Map();
        if (keys.length && ok / keys.length > 0.5) {
          keys.forEach(function (k) { if (GUID_RE.test(k)) { S.guid2db.set(k, map[k]); S.db2guid.set(map[k], k); } });
          resolve();
        } else {
          bulk(allIds(), GUID_PROPS).then(function (res) {
            res.forEach(function (r) {
              var p = (r.properties || []).find(function (x) { return GUID_RE.test(String(x.displayValue)); });
              if (p) { S.guid2db.set(String(p.displayValue), r.dbId); S.db2guid.set(r.dbId, String(p.displayValue)); }
            });
            resolve();
          }).catch(function () { resolve(); });
        }
      }, function () { resolve(); });
    }).then(function () { buildMaps.busy = null; });
    return buildMaps.busy;
  }

  function hexToVec(hex) {
    var n = parseInt(hex.slice(1), 16);
    return new THREE.Vector4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, 1);
  }
  // Colorea cada pieza por su estatus y deja en gris translúcido lo que no está en seguimiento.
  // En Piezas y Generador solo se ven las piezas de su lista (según sus filtros);
  // en las demás pestañas, todas las piezas en seguimiento.
  function paintModel(encuadrar, soloEstas) {
    var v = S.viewer, m = S.model;
    if (!v || !m || !S.guid2db.size) return;
    v.clearThemingColors(m);
    // En el módulo Lean, los colores los decide el plan (lean.js).
    if (S.modulo === "lean" && window.OBYRA_LEAN) {
      var col = window.OBYRA_LEAN.colores() || {}, lids = [];
      Object.keys(col).forEach(function (g) {
        var id = S.guid2db.get(g); if (id == null) return;
        lids.push(id); v.setThemingColor(id, hexToVec(col[g]), m, true);
      });
      var simulando = window.OBYRA_LEAN.simulando && window.OBYRA_LEAN.simulando();
      if (simulando) { S.syncing = true; v.clearSelection(); S.syncing = false; } // la selección azul tapa los colores
      // aislar = solo lo elegido; si no, todo el modelo visible con los colores encima (para poder seleccionar más).
      if (lids.length && window.OBYRA_LEAN.aislar() && (!S.multi || simulando) && !S.verTodo) { v.isolate(lids, m); if (encuadrar) v.fitToView(lids, m); }
      else { v.showAll(); if (lids.length && encuadrar) v.fitToView(lids, m); }
      if (v.impl && v.impl.invalidate) v.impl.invalidate(true, true, true); // fuerza a redibujar con los colores nuevos
      S.pintados = { pedidas: Object.keys(col).length, enModelo: lids.length };
      return;
    }
    var ids = [];
    var visibles = soloEstas || (S.tab === "generador" ? genFilas() : S.tab === "piezas" ? filtradas() : Object.keys(S.piezas));
    visibles.forEach(function (g) {
      var id = S.guid2db.get(g);
      if (id == null) return;
      ids.push(id);
      v.setThemingColor(id, hexToVec(COLOR[estado(g)] || COLOR.Planeado), m, true);
    });
    if (ids.length && S.verTodo) {
      v.showAll(); if (encuadrar) v.fitToView(ids, m); // modelo completo con los colores encima
    } else if (ids.length) {
      v.isolate(ids, m);
      if (encuadrar) v.fitToView(ids, m);
    } else if (S.verTodo) {
      v.showAll();
    } else if (Object.keys(S.piezas).length && (S.tab === "generador" || S.tab === "piezas")) {
      v.isolate([], m); v.hide(m.getRootId(), m); // filtro sin piezas: modelo vacío
    } else {
      v.showAll();
    }
  }

  // Selección múltiple sin Ctrl: con el botón activo, cada clic agrega o quita una pieza y se ve todo el modelo.
  function multiActiva() { return !!S.multi; }
  function pintarMulti() {
    var n = S.sel ? S.sel.size : 0;
    $("multi-btn").setAttribute("aria-pressed", String(!!S.multi));
    $("multi-btn").textContent = S.multi ? "Selección múltiple: activa" : "Selección múltiple";
    $("multi-n").hidden = !n; $("multi-n").textContent = n + (n === 1 ? " pieza seleccionada" : " piezas seleccionadas");
    $("multi-clear").hidden = !n;
  }
  // Ver modelo completo: deja de aislar (en cualquier pestaña) y conserva los colores.
  $("vertodo-btn").addEventListener("click", function () {
    S.verTodo = !S.verTodo;
    $("vertodo-btn").setAttribute("aria-pressed", String(S.verTodo));
    $("vertodo-btn").textContent = S.verTodo ? "Modelo completo: activo" : "Ver modelo completo";
    paintModel(false);
  });
  $("multi-btn").addEventListener("click", function () {
    S.multi = !S.multi;
    pintarMulti();
    paintModel(false); // en Lean deja ver todo el modelo mientras se selecciona
    if (S.multi) toast("Da clic en cada elemento para agregarlo o quitarlo. Ya no hace falta Ctrl.");
  });
  $("multi-clear").addEventListener("click", function () {
    S.sel = new Set();
    if (S.viewer) { S.syncing = true; S.viewer.clearSelection(); S.syncing = false; }
    pintarMulti();
    if (S.modulo !== "lean") renderLista();
  });

  function onViewerSelect(ev) {
    if (S.syncing) return;
    var gs = (ev.dbIdArray || []).map(function (id) {
      // Si se selecciona una parte de una pieza, sube hasta la pieza.
      // En Lean sirve cualquier elemento del IFC con GlobalId (para ligarlo a tarjetas y actividades).
      var it = S.model.getInstanceTree(), cur = id;
      var vale = S.modulo === "lean" ? function (x) { return S.db2guid.has(x); } : function (x) { return !!S.piezas[S.db2guid.get(x)]; };
      while (cur != null && !vale(cur)) {
        cur = it.getNodeParentId(cur);
        if (cur == null || cur < 0 || cur === it.getRootId()) cur = null;
      }
      return cur != null ? S.db2guid.get(cur) : null;
    }).filter(Boolean);
    if (multiActiva()) {
      // Clic en vacío no borra lo acumulado; un clic suelto alterna esa pieza; Ctrl + clic suma.
      if (!gs.length) { selectInViewer(); return; }
      var acum = new Set(S.sel || []);
      if (gs.length === 1) { if (acum.has(gs[0])) acum["delete"](gs[0]); else acum.add(gs[0]); }
      else gs.forEach(function (g) { acum.add(g); });
      S.sel = acum;
      selectInViewer();
    } else {
      if (!gs.length) { pintarMulti(); return; }
      S.sel = new Set(gs);
    }
    pintarMulti();
    if (S.modulo === "lean") return;
    renderLista();
    var sel = document.querySelector("#lista li.sel");
    if (sel) sel.scrollIntoView({ block: "nearest" });
  }
  function selectInViewer() {
    if (!S.viewer || !S.model) return;
    S.syncing = true;
    S.viewer.select(Array.from(S.sel).map(function (g) { return S.guid2db.get(g); }).filter(function (x) { return x != null; }), S.model);
    S.syncing = false;
  }
  function focusPieces(gs) {
    if (!S.viewer || !S.model) return;
    var ids = gs.map(function (g) { return S.guid2db.get(g); }).filter(function (x) { return x != null; });
    if (!ids.length) { toast("Esa pieza no está en la versión del modelo que se ve ahora."); return; }
    S.syncing = true;
    S.viewer.select(ids, S.model);
    S.syncing = false;
    S.viewer.fitToView(ids, S.model);
  }

  // ---------- Leer piezas del modelo (admin) ----------
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
  var CAMPOS = {
    contratista: ["gcpcontratista"], clave: ["gcpclaveconcepto"], partida: ["gcppartida"], zona: ["gcpzona"], eje: ["gcpeje"],
    marca: ["marca", "mark"], nivel: ["level", "nivel", "buildingstorey", "referencelevel", "basebuildingstorey"],
    area: ["netsidearea", "netarea", "netfloorarea", "arearevit", "area", "outersurfacearea"],
    areaBruta: ["grosssidearea", "grossarea", "grossfloorarea"],
    volumen: ["netvolume", "volumenrevit", "volume", "grossvolume"],
    largo: ["length", "largo"], alto: ["height", "depth", "altura"], espesor: ["width", "thickness", "espesor"],
    tipo: ["objecttype", "type", "typename", "familyandtype"], categoria: ["ifcclass", "ifcentity", "category", "entity"],
  };
  function pick(props, names, numeric) {
    for (var i = 0; i < names.length; i++) {
      for (var j = 0; j < props.length; j++) {
        if (norm(props[j].displayName) === names[i] || norm(props[j].attributeName) === names[i]) {
          var val = props[j].displayValue;
          if (numeric) { var n = parseFloat(String(val).replace(",", ".")); if (isFinite(n)) return n; }
          else if (val != null && String(val).trim() !== "") return String(val).trim();
        }
      }
    }
    return numeric ? null : "";
  }

  function leerCatalogo() {
    if (!S.model) { toast("Primero carga el modelo.", true); return; }
    var btn = $("cat-btn"); btn.disabled = true;
    $("cat-estado").textContent = "Leyendo propiedades del modelo…";
    var ids = allIds();
    bulk(ids, ["GCP_Contratista", "GCP_ClaveConcepto"]).then(function (res) {
      var cand = res.filter(function (r) { return (r.properties || []).some(function (p) { return String(p.displayValue || "").trim(); }); }).map(function (r) { return r.dbId; });
      if (!cand.length) throw new Error("Ninguna pieza del modelo tiene GCP_Contratista ni GCP_ClaveConcepto. Revisa que el IFC se exportó con el Pset GCP_ControlObra.");
      return bulk(cand, null);
    }).then(function (res) {
      var it = S.model.getInstanceTree();
      var byDb = {};
      res.forEach(function (r) {
        var props = r.properties || [], o = { dbId: r.dbId };
        Object.keys(CAMPOS).forEach(function (k) { o[k] = pick(props, CAMPOS[k], ["area", "areaBruta", "volumen", "largo", "alto", "espesor"].indexOf(k) >= 0); });
        o.tipo = o.tipo || r.name || "";
        o.concepto = o.tipo;
        o.guid = S.db2guid.get(r.dbId) || pick(props, GUID_PROPS.map(norm), false);
        if (o.area == null && o.volumen && o.espesor) o.area = o.volumen / o.espesor; // muros sin área en el IFC
        if (o.alto == null && o.area && o.largo) o.alto = o.area / o.largo;
        byDb[r.dbId] = o;
      });
      // Una cubierta y sus losas internas traen los mismos datos: se cuenta solo la cubierta, con el volumen de sus losas.
      Object.keys(byDb).forEach(function (id) {
        var o = byDb[id], parent = byDb[it.getNodeParentId(Number(id))];
        if (parent && parent.contratista === o.contratista && parent.clave === o.clave && (parent.marca || "") === (o.marca || "")) {
          if (parent.volumen == null && o.volumen != null) parent.volumen = o.volumen;
          if (parent.area == null && o.area != null) parent.area = o.area;
          o.omitir = true;
        }
      });
      var piezas = Object.values(byDb).filter(function (o) { return !o.omitir && GUID_RE.test(o.guid || ""); });
      if (!piezas.length) throw new Error("No se encontró el GlobalId de las piezas en el modelo.");
      return api("/api/piezas", { action: "catalogo", version: String(S.obra.modelo.version || ""), piezas: piezas });
    }).then(function (r) {
      toast(nf0.format(r.total) + " piezas leídas del modelo.");
      return loadPiezas();
    }).then(function () { renderAdmin(); })
      .catch(function (e) { $("cat-estado").textContent = e.message; toast(e.message, true); })
      .finally(function () { btn.disabled = false; });
  }

  // Puente para el módulo Lean (public/lean.js).
  window.OBYRA = {
    S: S, api: api, el: el, $: $, qsa: qsa, toast: toast, fecha: fecha, f2: f2, nf0: nf0, pill: pill, COLOR: COLOR,
    paintModel: paintModel, focusPieces: focusPieces, renderLegend: renderLegend,
    alIniciar: [], // funciones que corren cuando la app ya cargó obra y piezas
    _onViewerSelect: onViewerSelect, // para pruebas
  };
  boot();
})();
