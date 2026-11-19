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
  // Proyecto elegido: viaja en cada solicitud; se recuerda en este navegador.
  function cambiarProyecto(id) {
    try { localStorage.setItem("ctrl_proyecto", id); } catch (e) { /* nada */ }
    location.reload();
  }
  function api(path, body) {
    var opt = { credentials: "same-origin", headers: {} };
    if (S.proyecto) opt.headers["X-Proyecto"] = S.proyecto;
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
  // Ojito para mostrar u ocultar lo escrito en los campos de contraseña.
  var OJO = '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  var OJO_NO = '<path d="M3 3l18 18"/><path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s4 7 10 7a9.7 9.7 0 0 0 5.4-1.6"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  function ojitos() {
    qsa('input[type="password"]').forEach(function (inp) {
      if (inp.parentNode.classList.contains("pw-wrap")) return;
      var wrap = el("span", { class: "pw-wrap" });
      inp.parentNode.insertBefore(wrap, inp); wrap.appendChild(inp);
      var b = el("button", { type: "button", class: "pw-ojo", "aria-label": "Mostrar contraseña", title: "Mostrar contraseña" });
      var pinta = function () {
        var visible = inp.type === "text";
        b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (visible ? OJO_NO : OJO) + "</svg>";
        b.setAttribute("aria-label", visible ? "Ocultar contraseña" : "Mostrar contraseña"); b.title = b.getAttribute("aria-label");
        b.setAttribute("aria-pressed", String(visible));
      };
      b.addEventListener("click", function () { inp.type = inp.type === "password" ? "text" : "password"; pinta(); inp.focus(); });
      // Al enviar o cerrar, vuelve a ocultarse.
      if (inp.form) inp.form.addEventListener("reset", function () { inp.type = "password"; pinta(); });
      if (inp.form) inp.form.addEventListener("submit", function () { inp.type = "password"; pinta(); });
      pinta(); wrap.appendChild(b);
    });
  }

  function boot() {
    ojitos();
    try { S.proyecto = localStorage.getItem("ctrl_proyecto") || ""; } catch (e) { S.proyecto = ""; }
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
      S.proyectos = s.proyectos || [];
      if (s.proyectos && !s.proyecto) { toast("Tu usuario no tiene ningún proyecto asignado. Pide acceso al administrador.", true); return; }
      if (s.proyecto && s.proyecto !== S.proyecto) {
        // Lo recordado ya no aplica (o es la primera vez): se usa el que indica el servidor.
        S.proyecto = s.proyecto;
        try { localStorage.setItem("ctrl_proyecto", s.proyecto); } catch (e) { /* nada */ }
        return api("/api/session").then(function (s2) { S.permisos = s2.permisos; pintarProyectos(); startApp(); });
      }
      pintarProyectos();
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
    if (S.me.cambiarPw) setTimeout(function () { abrirPass(true); }, 300);
    // El formulario de avance solo existe para el contratista (los demás no tienen el permiso "reportar").
    if ($("reporte")) {
      $("r-btn").textContent = "Actualizar avance";
      $("r-hint").textContent = "Se aplica de inmediato y queda sin validar hasta que el residente lo revisa. Solo lo Terminado y validado se puede enviar a estimar.";
      fillSelect($("r-estatus"), ["Planeado", "Liberado", "En ejecución", "Terminado"]);
      $("r-estatus").value = "En ejecución";
      if (S.syncPct) S.syncPct();
    }
    $("ap-intro").textContent = S.permisos.autorizar
      ? "Estimaciones que el residente ya validó: apruébalas (quedan Estimado) o regrésalas a Terminado con el motivo. También puedes validar avance."
      : S.permisos.validarGenerador
        ? "Valida el avance que actualiza el contratista y los generadores que envía a estimar; lo validado pasa al superintendente."
        : apConsulta() ? "Así va lo que enviaste. Toca una cantidad para verla en la lista y en el modelo."
        : "Lo que espera revisión: el residente valida el avance y los generadores; el superintendente aprueba las estimaciones.";
    // El contratista además puede ver lo que el residente ya validó (Terminado y validado): lo que puede estimar.
    var opcEst = [];
    ORDEN.forEach(function (e) { opcEst.push([e, e]); if (e === "Terminado" && S.permisos.enviarEstimacion) opcEst.push([VALIDADOS, "Validado"]); });
    fillSelect($("f-estatus"), [["", "Todos los estatus"]].concat(opcEst));
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
      if ($("ap-chipv")) $("ap-chipv").hidden = name !== "aprobar" || !(apConsulta() && S.apCelda);
      // Piezas y Generador muestran en el modelo lo mismo que su lista; las demás pestañas, todas las piezas.
      if (antes !== name) paintModel(name === "piezas" || name === "generador");
      try { localStorage.setItem("ctrl_tab", name); } catch (e) { /* sin almacenamiento */ }
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { open(t.getAttribute("data-tab")); }); });
    S.abrirTab = open; // la barra lateral (nav.js) abre la sección
    var last = null;
    try { last = localStorage.getItem("ctrl_tab"); } catch (e) { /* nada */ }
    open(tabs.some(function (t) { return t.getAttribute("data-tab") === last; }) ? last : "piezas");
  }

  $("btn-logout").addEventListener("click", function () {
    api("/api/session", { action: "logout" }).finally(function () { location.reload(); });
  });
  function abrirPass(forzada) {
    $("pass-error").hidden = true; $("pass-form").reset();
    $("pass-t").textContent = forzada ? "Crea tu contraseña" : "Cambiar contraseña";
    $("pass-hint").hidden = !forzada; $("pass-cancel").hidden = !!forzada;
    $("pass-actual").placeholder = forzada ? "Contraseña temporal" : "Contraseña actual";
    S.passForzada = !!forzada;
    $("pass").showModal();
  }
  $("btn-pass").addEventListener("click", function () { abrirPass(false); });
  $("pass-cancel").addEventListener("click", function () { $("pass").close(); });
  // Con contraseña temporal no se puede cerrar el diálogo sin cambiarla.
  $("pass").addEventListener("cancel", function (ev) { if (S.passForzada) ev.preventDefault(); });
  $("reset-pw-ok").addEventListener("click", function () { $("reset-pw-valor").textContent = ""; $("reset-pw").close(); });
  $("reset-pw").addEventListener("close", function () { $("reset-pw-valor").textContent = ""; });
  $("reset-pw-copiar").addEventListener("click", function () {
    var t = $("reset-pw-valor").textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copiada."); }, function () { toast("No se pudo copiar; selecciónala y cópiala a mano.", true); });
  });
  $("pass-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    api("/api/session", { action: "password", actual: $("pass-actual").value, nueva: $("pass-nueva").value })
      .then(function () { S.passForzada = false; $("pass").close(); toast("Contraseña actualizada."); })
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

  var VALIDADOS = "__validados", RECHAZADOS = "__rechazados";
  function rechazado(g) { var r = rec(g); return !!r.rechazo && !r.porValidar && !r.pend; }
  function filtradas() {
    var c = $("f-contratista") ? $("f-contratista").value : "";
    // La zona aislada (doble clic en «Zonas · avance») también filtra la lista.
    var zona = S.zonaAislada && S.zonaAisladaGuids ? new Set(S.zonaAisladaGuids) : null;
    var e = $("f-estatus").value;
    var n = e === "Estimado" ? $("f-estnum").value : "";
    var q = $("f-buscar").value.trim().toLowerCase();
    return Object.keys(S.piezas).filter(function (g) {
      var p = S.piezas[g];
      if (c && p.contratista !== c) return false;
      if (zona && !zona.has(g)) return false;
      if (e === VALIDADOS) { if (!estimable(g)) return false; }
      else if (e && estado(g) !== e) return false;
      if (n && rec(g).estimacion !== n) return false;
      if (q && [p.marca, p.clave, p.zona, p.takt, p.eje, p.concepto].join(" ").toLowerCase().indexOf(q) < 0) return false;
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
    // Lo que se seleccionó en el modelo es lo que se ve en la lista (hasta «Ver toda la lista»).
    var soloSel = S.soloSel && S.sel && S.sel.size;
    if (soloSel) list = list.filter(function (g) { return S.sel.has(g); });
    pintarChipSel("sel-solo-chip", soloSel);
    if ($("validados-hint")) $("validados-hint").hidden = $("f-estatus").value !== VALIDADOS || !list.length;
    var ul = $("lista");
    $("list-count").textContent = nf0.format(list.length) + (list.length === 1 ? " pieza" : " piezas") + (soloSel ? " seleccionadas en el modelo" : S.zonaAislada ? " en " + S.zonaAislada : "");
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
      if (r.pend) notes.push(el("span", { class: "note warn", text: notaPend(r.pend) }));
      if (r.porValidar) notes.push(el("span", { class: "note warn", text: "Sin validar · " + r.porValidar.por }));
      if (r.rechazo) notes.push(el("span", { class: "note bad", text: "Rechazado: " + r.rechazo.motivo }));
      // Lo que se va a enviar (aún no guardado): se ve en la lista igual que en el modelo.
      if (previewActivo() && S.sel.has(g)) {
        var nv = $("r-estatus").value, np = $("r-pct").value;
        notes.push(el("span", { class: "note", text: "Por enviar: " + nv + (nv === "En ejecución" && np ? " " + np + " %" : "") + " · aún no se guarda" }));
      }
      var li = el("li", { class: S.sel.has(g) ? "sel" : "" }, [
        cb,
        el("span", { class: "m", text: (p.marca || "(sin marca)") + " · " + (p.clave || "sin clave") }),
        pill(est, est + (est === "En ejecución" && r.pct ? " " + r.pct + " %" : "")),
        el("span", { class: "s", text: [p.contratista, p.takt && "Takt " + p.takt, p.zona, p.eje && "Eje " + p.eje, p.nivel].filter(Boolean).join(" · ") }),
      ].concat(notes));
      li.addEventListener("click", function () { focusPieces([g]); });
      li.addEventListener("dblclick", function () { showDetalle(g); });
      return li;
    }));
    updateSel();
  }

  // Al filtrar, el modelo muestra solo lo filtrado (si estaba «Modelo completo», se apaga) y se acerca a eso.
  function verFiltrado() {
    if (S.verTodo) ponerVerTodo(false);
  }
  ["f-contratista", "f-estatus", "f-estnum"].forEach(function (id) { if ($(id)) $(id).addEventListener("change", function () { verFiltrado(); renderLista(); paintModel(true); }); });
  $("f-buscar").addEventListener("input", function () {
    verFiltrado(); renderLista(); paintModel(false);
    clearTimeout(S.tBuscar);
    S.tBuscar = setTimeout(function () { paintModel(true); }, 600); // al dejar de escribir, encuadra lo encontrado
  });
  $("sel-all").addEventListener("change", function () {
    var list = filtradas();
    if ($("sel-all").checked) list.forEach(function (g) { S.sel.add(g); }); else S.sel.clear();
    renderLista(); selectInViewer(); encuadrarSel(S.sel);
  });
  $("btn-ver-sel").addEventListener("click", function () {
    if (!S.sel.size) { toast("Selecciona piezas en la lista o en el modelo."); return; }
    focusPieces(Array.from(S.sel));
  });

  function toggleSel(g, on) {
    if (on) S.sel.add(g); else S.sel["delete"](g);
    renderLista(); selectInViewer(); encuadrarSel(S.sel);
  }
  // El modelo se acerca a lo que se marca en la lista (si no queda nada marcado, no se mueve).
  function encuadrarSel(gs) {
    if (!S.viewer || !S.model) return;
    var ids = Array.from(gs).map(function (g) { return S.guid2db.get(g); }).filter(function (x) { return x != null; });
    if (ids.length) S.viewer.fitToView(ids, S.model);
  }
  // Vista previa del avance: mientras el contratista elige el estatus, las piezas seleccionadas se ven
  // en el modelo con el color de ese estatus (el resaltado de selección toma ese color).
  // Mientras el contratista elige el estatus, lo seleccionado se pinta con el color de ese estatus
  // (también el resaltado de selección del visor toma ese color).
  function previewActivo() { return !!($("reporte") && !$("reporte").hidden && !$("reporte").classList.contains("modo-gen") && S.sel && S.sel.size && $("r-estatus") && $("r-estatus").value); }
  function colorVista(g) {
    if (previewActivo() && S.sel.has(g)) return COLOR[$("r-estatus").value] || COLOR.Planeado;
    return COLOR[estado(g)] || COLOR.Planeado;
  }
  function previewReporte() {
    var v = S.viewer; if (!v || !S.model) return;
    var clave = previewActivo() ? $("r-estatus").value + "|" + Array.from(S.sel).join(",") : "";
    if (S.previewClave === clave) return;
    var antes = S.previewClave; S.previewClave = clave;
    // Lo que además está seleccionado en el visor se resalta con ese mismo color (en vez del azul).
    try { if (v.setSelectionColor && typeof THREE !== "undefined") v.setSelectionColor(new THREE.Color(clave ? (COLOR[$("r-estatus").value] || COLOR.Planeado) : "#6699FF"), Autodesk.Viewing.SelectionType.MIXED); } catch (e) { /* visor sin soporte */ }
    if (clave || antes) paintModel(false);
    if (v.impl && v.impl.invalidate) v.impl.invalidate(true, true, true);
  }
  function modoGenerador() { return $("f-estatus").value === VALIDADOS; }
  function updateSel() {
    if ($("reporte")) {
      var gen = modoGenerador();
      $("reporte").classList.toggle("modo-gen", gen);
      // El contratista no actualiza avance cuando ve lo ya terminado o en estimación (en «Validado» solo arma el generador).
      var sinReporte = S.me && S.me.rol === "contratista" && ["Terminado", "Por aprobar", "Estimado", "Pagado"].indexOf($("f-estatus").value) >= 0;
      $("reporte").hidden = !S.sel.size || sinReporte;
      $("sel-count").textContent = nf0.format(S.sel.size);
      if ($("r-gen")) $("r-gen").textContent = "Armar generador con " + nf0.format(S.sel.size) + (S.sel.size === 1 ? " elemento" : " elementos");
    }
    previewReporte();
    var list = filtradas();
    $("sel-all").checked = list.length > 0 && list.every(function (g) { return S.sel.has(g); });
  }

  if ($("reporte")) {
    // El % solo aplica a En ejecución (Terminado es 100 %; Planeado y Liberado, 0 %).
    var syncPct = function () { var t = ["Planeado", "Liberado", "Terminado"].indexOf($("r-estatus").value) >= 0; $("r-pct").disabled = t; if (t) $("r-pct").value = ""; };
    S.syncPct = syncPct;
    $("r-estatus").addEventListener("change", function () { syncPct(); previewReporte(); renderLista(); }); syncPct();
    $("r-pct").addEventListener("input", function () { clearTimeout(S.tPct); S.tPct = setTimeout(renderLista, 300); });
    $("reporte").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var guids = Array.from(S.sel);
      $("r-btn").disabled = true;
      api("/api/piezas", { action: "reportar", guids: guids, estatus: $("r-estatus").value, pct: Number($("r-pct").value || 0), comentario: $("r-coment").value })
        .then(function (r) {
          Object.assign(S.avance, r.avance);
          toast(nf0.format(r.actualizadas) + (r.actualizadas === 1 ? " pieza actualizada" : " piezas actualizadas") + (r.omitidas ? " · " + r.omitidas + " sin cambio (ya estimadas o de otro contratista)" : "") + ".");
          S.sel.clear(); $("r-coment").value = "";
          updateBadge(); renderLista(); paintModel(); selectInViewer(); previewReporte();
        })
        .catch(function (e) { toast(e.message, true); })
        .finally(function () { $("r-btn").disabled = false; });
    });
  }

  function showDetalle(g) {
    var p = S.piezas[g], r = rec(g);
    $("d-titulo").textContent = (p.marca || "(sin marca)") + " · " + (p.clave || "sin clave");
    var datos = [
      ["Contratista", p.contratista], ["Partida", p.partida], ["Concepto", p.concepto], ["Zona", p.zona], ["Tren takt", p.takt], ["Eje", p.eje], ["Nivel", p.nivel],
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
  // Tres colas: avance sin validar (residente), generadores enviados (residente) y estimaciones (superintendente).
  // «Por aprobar» es solo lo que va a estimar.
  function etapaGen(r) { return r.pend && r.pend.estatus === "Estimado" ? (r.pend.etapa || "superintendente") : null; }
  function notaPend(pe) {
    if (pe.estatus !== "Estimado") return "Propuesto: " + pe.estatus + (pe.estatus !== "Terminado" && pe.pct ? " " + pe.pct + " %" : "") + " · " + pe.por;
    return "Estimación " + pe.estimacion + " · " + ((pe.etapa || "superintendente") === "residente" ? "espera validación del residente" : "espera aprobación del superintendente");
  }
  var COLAS = {
    avance: { nombre: "Avance por validar", puede: "aprobar", ok: "Validar", no: "Rechazar", acc: ["validar", "rechazar"],
      es: function (r) { return !!r.porValidar || (!!r.pend && r.pend.estatus !== "Estimado"); },
      vacio: "No hay avance por validar." },
    generador: { nombre: "Generadores por validar", puede: "validarGenerador", ok: "Validar generador", no: "Regresar", acc: ["gen-validar", "gen-regresar"],
      revisar: true, okRev: "Validar para estimación", noRev: "Regresar al contratista",
      es: function (r) { return etapaGen(r) === "residente"; }, vacio: "No hay generadores por validar." },
    estimacion: { nombre: "Estimaciones por aprobar", puede: "autorizar", ok: "Aprobar (Estimado)", no: "Regresar a Terminado", acc: ["aprobar", "regresar"],
      revisar: true,
      es: function (r) { return etapaGen(r) === "superintendente"; }, vacio: "No hay estimaciones por aprobar." },
    // El contratista consulta lo que mandó a estimar, en cualquier etapa (no valida nada).
    enviados: { nombre: "Mis envíos por aprobar", puede: "enviarEstimacion", soloVer: true, ok: "", no: "", acc: [],
      es: function (r) { return !!etapaGen(r); }, vacio: "No tienes generadores esperando aprobación." },
  };
  function enCola(k) { return Object.keys(S.piezas).filter(function (g) { return COLAS[k].es(rec(g)); }); }
  function colaActual() { return ($("ap-cola") && $("ap-cola").value) || "avance"; }
  function pendientes() { return enCola(colaActual()); }
  // Pendientes que se ven en la pestaña, según la cola y el filtro de contratista.
  // Quién lo envió, qué estatus trae y en qué zona está (para los filtros de Aprobaciones).
  function apQuien(g) { var r = rec(g); return (r.pend && (r.pend.por || "")) || (r.porValidar && r.porValidar.por) || ""; }
  function apEstatus(g) { var r = rec(g); return r.pend ? (r.pend.estatus === "Estimado" ? "Por estimar" : r.pend.estatus) : (r.estatus || "Planeado"); }
  function apTexto(g) {
    var p = S.piezas[g], r = rec(g);
    return [p.marca, p.clave, p.concepto, p.eje, r.pend && r.pend.comentario, r.pend && r.pend.estimacion, r.porValidar && r.porValidar.comentario].join(" ").toLowerCase();
  }
  function pendientesVista() {
    var v = function (id) { return $(id) ? $(id).value : ""; };
    var c = v("ap-contratista"), u = v("ap-usuario"), e = v("ap-estatus"), z = v("ap-zona"), q = v("ap-buscar").trim().toLowerCase();
    // «Validados»: lo que el residente ya validó y el contratista puede estimar (no es un pendiente de revisión).
    var base = e === VALIDADOS ? Object.keys(S.piezas).filter(estimable) : e === RECHAZADOS ? Object.keys(S.piezas).filter(rechazado) : pendientes();
    var celda = apConsulta() && S.apCelda ? tableroAp()[S.apCelda.f][S.apCelda.c] : null;
    if (celda) base = celda.guids; // lo que se eligió en el tablero del contratista
    return base.filter(function (g) {
      if (c && S.piezas[g].contratista !== c) return false;
      if (u && apQuien(g) !== u) return false;
      if (e && e !== VALIDADOS && e !== RECHAZADOS && apEstatus(g) !== e) return false;
      if (z && zonaDe(S.piezas[g]) !== z) return false;
      if (q && apTexto(g).indexOf(q) < 0) return false;
      return true;
    });
  }
  // ---------- Tablero del contratista en Aprobaciones (solo consulta) ----------
  // Elementos (avance reportado), generadores (los revisa el residente) y estimaciones (las aprueba el superintendente),
  // cada uno aprobado, en revisión o rechazado. Generadores y estimaciones se cuentan por número de estimación.
  var AP_FILAS = [["elem", "Elementos", "avance reportado"], ["gen", "Generadores", "con el residente"], ["est", "Estimaciones", "con el superintendente"]];
  var AP_COLS = [["rev", "En revisión", "◷"], ["ok", "Aprobados", "✓"], ["no", "Rechazados", "↺"]];
  function apConsulta() { return !!S.permisos.enviarEstimacion && !S.permisos.aprobar && !S.permisos.validarGenerador && !S.permisos.autorizar; }
  function regresoSuper(r) {
    var h = (r.hist || []).filter(function (x) { return x.accion === "regresa"; }).pop();
    return !!h && h.rol === "superintendente";
  }
  function tableroAp() {
    var T = {}, mio = S.me && S.me.contratista;
    AP_FILAS.forEach(function (f) { T[f[0]] = {}; AP_COLS.forEach(function (c) { T[f[0]][c[0]] = { guids: [], ests: {} }; }); });
    var poner = function (f, c, g, est) { var x = T[f][c]; x.guids.push(g); if (est) x.ests[est] = 1; };
    Object.keys(S.piezas).forEach(function (g) {
      if (mio && S.piezas[g].contratista !== mio) return;
      var r = rec(g), etapa = etapaGen(r), rech = rechazado(g);
      var avRev = !!r.porValidar || (!!r.pend && r.pend.estatus !== "Estimado");
      var avNo = rech && !r.rechazo.estimacion;
      if (avRev) poner("elem", "rev", g);
      else if (avNo) poner("elem", "no", g);
      else if (r.validado || etapa || r.estatus === "Estimado" || r.estatus === "Pagado") poner("elem", "ok", g);
      if (etapa === "residente") poner("gen", "rev", g, r.pend.estimacion);
      if (etapa === "superintendente") { poner("gen", "ok", g, r.pend.estimacion); poner("est", "rev", g, r.pend.estimacion); }
      if (r.estimacion) { poner("gen", "ok", g, r.estimacion); poner("est", "ok", g, r.estimacion); }
      if (rech && r.rechazo.estimacion) poner(regresoSuper(r) ? "est" : "gen", "no", g, r.rechazo.estimacion);
    });
    return T;
  }
  function nombreCelda(f, c) {
    var F = AP_FILAS.filter(function (x) { return x[0] === f; })[0], C = AP_COLS.filter(function (x) { return x[0] === c; })[0];
    var fem = f === "est";
    var col = c === "ok" ? (fem ? "aprobadas" : "aprobados") : c === "no" ? (fem ? "rechazadas" : "rechazados") : "en revisión";
    return F[1] + " " + col;
  }
  function pintarTableroAp() {
    var box = $("ap-tablero"); if (!box) return;
    var on = apConsulta();
    box.hidden = !on; if ($("ap-cola")) $("ap-cola").hidden = on;
    // El contratista solo consulta con el tablero: sin búsqueda, filtros ni conteo (y sin filtros escondidos aplicados).
    if ($("ap-filtros-wrap")) $("ap-filtros-wrap").hidden = on;
    if ($("ap-count-wrap")) $("ap-count-wrap").hidden = on;
    if (on) ["ap-buscar", "ap-contratista", "ap-usuario", "ap-estatus", "ap-zona"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    if (!on) { S.apCelda = null; return; }
    var T = tableroAp();
    var filas = [el("div", { class: "ap-tr ap-th" }, [el("div")].concat(AP_COLS.map(function (c) { return el("div", { class: "ap-" + c[0] }, [el("span", { "aria-hidden": "true", text: c[2] + " " }), c[1]]); })))];
    AP_FILAS.forEach(function (f) {
      filas.push(el("div", { class: "ap-tr" }, [el("div", { class: "ap-tf" }, [el("span", { text: f[1] }), el("small", { text: f[2] })])].concat(AP_COLS.map(function (c) {
        var x = T[f[0]][c[0]], n = f[0] === "elem" ? x.guids.length : Object.keys(x.ests).length;
        var sel = S.apCelda && S.apCelda.f === f[0] && S.apCelda.c === c[0];
        var b = el("button", { type: "button", class: "ap-c ap-" + c[0] + (n ? "" : " cero") + (sel ? " sel" : ""), "aria-pressed": String(!!sel),
          "aria-label": nombreCelda(f[0], c[0]) + ": " + n }, [
          el("b", { text: nf0.format(n) }),
          el("small", { text: n ? (f[0] === "elem" ? (n === 1 ? "pza" : "pzas") : nf0.format(x.guids.length) + (x.guids.length === 1 ? " pza" : " pzas")) : "\u00a0" }),
        ]);
        if (!n) b.disabled = true;
        b.addEventListener("click", function () { S.apCelda = sel ? null : { f: f[0], c: c[0] }; S.apSel.clear(); renderAprobar(); paintModel(true); });
        return b;
      }))));
    });
    box.replaceChildren.apply(box, filas);
  }
  function pintarCeldaAp(n) {
    var on = apConsulta() && S.apCelda, t = on ? nombreCelda(S.apCelda.f, S.apCelda.c) : "";
    if ($("ap-celda")) { $("ap-celda").hidden = !on; if (on) $("ap-celda-t").textContent = t + " · " + nf0.format(n) + (n === 1 ? " pieza" : " piezas"); }
    var ch = $("ap-chipv");
    if (ch) {
      ch.hidden = !(on && S.tab === "aprobar");
      if (on) ch.replaceChildren("Mostrando: ", el("b", { text: t }), " · " + nf0.format(n) + (n === 1 ? " pieza" : " piezas"));
    }
  }
  if ($("ap-celda-x")) $("ap-celda-x").addEventListener("click", function () { S.apCelda = null; renderAprobar(); paintModel(true); });

  // ¿Hay algún filtro o búsqueda en Aprobaciones? Entonces el modelo muestra solo esos pendientes.
  function filtrosApActivos() {
    if (apConsulta() && S.apCelda) return true;
    return ["ap-contratista", "ap-usuario", "ap-estatus", "ap-zona", "ap-buscar"].some(function (id) { return $(id) && $(id).isConnected && $(id).value.trim(); });
  }
  // Opciones de los filtros con lo que hay en la lista actual (y cuántos de cada uno).
  function pintarFiltrosAp() {
    if (!$("ap-usuario")) return;
    var gs = pendientes();
    var llenar = function (id, todos, fn) {
      var sel = $(id), prev = sel.value, cuenta = {};
      gs.forEach(function (g) { var k = fn(g); if (k) cuenta[k] = (cuenta[k] || 0) + 1; });
      var ks = Object.keys(cuenta).sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
      fillSelect(sel, [["", todos]].concat(ks.map(function (k) { return [k, k + " (" + cuenta[k] + ")"]; })));
      sel.value = ks.indexOf(prev) >= 0 ? prev : "";
    };
    llenar("ap-usuario", "Todos los usuarios", apQuien);
    var prevE = $("ap-estatus").value;
    llenar("ap-estatus", "Todos los estatus", apEstatus);
    if (S.permisos.enviarEstimacion) {
      var nVal = Object.keys(S.piezas).filter(estimable).length, selE = $("ap-estatus");
      selE.appendChild(el("option", { value: VALIDADOS, text: "Validado (" + nVal + ")" }));
      if (prevE === VALIDADOS) selE.value = VALIDADOS;
    }
    // Rechazado: lo que el residente regresó con su motivo (lo ven el residente y el contratista).
    if (S.permisos.aprobar || S.permisos.reportar) {
      var nRech = Object.keys(S.piezas).filter(rechazado).length;
      $("ap-estatus").appendChild(el("option", { value: RECHAZADOS, text: "Rechazado (" + nRech + ")" }));
      if (prevE === RECHAZADOS) $("ap-estatus").value = RECHAZADOS;
    }
    llenar("ap-zona", "Todas las zonas", function (g) { return zonaDe(S.piezas[g]); });
    var act = ["ap-contratista", "ap-usuario", "ap-estatus", "ap-zona"].filter(function (id) { return $(id) && $(id).isConnected && $(id).value; }).length;
    $("desp-ap-res").textContent = act ? act + (act === 1 ? " activo" : " activos") : "Ninguno";
    $("ap-limpiar").hidden = !act;
  }
  // Las colas que le tocan a cada quien primero; quien solo consulta ve todas.
  function colasMias() { return ["estimacion", "avance", "generador"].filter(function (k) { return S.permisos[COLAS[k].puede]; }); }
  // Colas visibles: el contratista ve primero sus envíos; los demás no ven esa cola.
  function colasVisibles() {
    var base = ["estimacion", "avance", "generador"];
    return S.permisos.enviarEstimacion ? ["enviados"].concat(base) : base;
  }
  function pintarColas() {
    var sel = $("ap-cola"); if (!sel) return;
    var mias = colasMias(), vis = colasVisibles();
    var orden = (S.permisos.enviarEstimacion ? ["enviados"] : []).concat(mias, vis.filter(function (k) { return mias.indexOf(k) < 0 && k !== "enviados"; }));
    var prev = sel.value;
    fillSelect(sel, orden.map(function (k) { return [k, COLAS[k].nombre + " (" + enCola(k).length + ")"]; }));
    if (prev && orden.indexOf(prev) >= 0) sel.value = prev;
    else { var conAlgo = orden.filter(function (k) { return enCola(k).length; }); sel.value = (mias.filter(function (k) { return enCola(k).length; })[0]) || conAlgo[0] || orden[0]; }
  }
  function updateBadge() {
    if (S.zonasOn && S.zonasEscena) pintarZonas(); // el % de avance de cada zona cambia con el avance
    var b = $("badge-aprobar"); if (!b) return;
    var mias = colasMias(); if (!mias.length) mias = Object.keys(COLAS);
    var n = mias.reduce(function (s, k) { return s + enCola(k).length; }, 0); b.textContent = n; b.hidden = !n;
    if (window.OBYRA && window.OBYRA.alCambiarAvance) window.OBYRA.alCambiarAvance();
  }
  function cuandoAp(g) { var r = rec(g); return (r.pend && r.pend.at) || (r.porValidar && r.porValidar.at) || ""; }
  function renderAprobar() {
    if (!$("lista-ap")) return;
    pintarColas();
    pintarTableroAp();
    pintarFiltrosAp();
    var cola = COLAS[colaActual()], actua = !cola.soloVer && !!S.permisos[cola.puede];
    $("ap-acciones").hidden = !actua;
    if ($("ap-all")) $("ap-all").hidden = !actua;
    $("ap-ok").textContent = cola.ok; $("ap-no").textContent = cola.no;
    // Generadores y estimaciones se revisan en la vista del generador; ahí están validar y regresar.
    var rev = !!cola.revisar;
    $("ap-no").hidden = rev; $("ap-coment").hidden = rev;
    var list = pendientesVista().sort(function (a, b) { return cuandoAp(a) < cuandoAp(b) ? -1 : 1; });
    var soloSel = S.soloSel && S.sel && S.sel.size;
    var fuera = 0;
    if (soloSel) { var n0 = S.sel.size; list = list.filter(function (g) { return S.sel.has(g); }); fuera = n0 - list.length; }
    pintarChipSel("ap-solo-chip", soloSel);
    pintarCeldaAp(list.length);
    S.apSel.forEach(function (g) { if (list.indexOf(g) < 0) S.apSel["delete"](g); });
    var esVal = $("ap-estatus") && $("ap-estatus").value === VALIDADOS, esRech = $("ap-estatus") && $("ap-estatus").value === RECHAZADOS;
    if (esRech) { $("ap-acciones").hidden = true; if ($("ap-all")) $("ap-all").hidden = true; }
    $("ap-count").textContent = nf0.format(list.length) + (esRech ? (list.length === 1 ? " rechazado" : " rechazados") : esVal ? (list.length === 1 ? " validado" : " validados") : list.length === 1 ? " pendiente" : " pendientes") +
      (soloSel ? " de lo seleccionado en el modelo" + (fuera > 0 ? " (" + fuera + " sin pendientes aquí)" : "") : "");
    if ($("ap-all")) $("ap-all").checked = list.length > 0 && list.every(function (g) { return S.apSel.has(g); });
    if (rev) { var nRev = S.apSel.size || list.length; $("ap-ok").textContent = "Revisar generador" + (nRev ? " (" + nRev + (nRev === 1 ? " pieza)" : " piezas)") : ""); $("ap-ok").disabled = !list.length; }
    else $("ap-ok").disabled = false;
    if (!list.length) { $("lista-ap").replaceChildren(el("li", { class: "empty", text: apConsulta() && S.apCelda ? "No hay piezas con estos filtros." : soloSel ? "Lo que seleccionaste en el modelo no tiene pendientes en esta lista." : esRech ? "No hay elementos rechazados." : esVal ? "Aún no hay elementos validados." : cola.vacio })); return; }
    $("lista-ap").replaceChildren.apply($("lista-ap"), list.map(function (g) {
      var p = S.piezas[g], r = rec(g);
      var cb = el("span"); // sin casilla para quien solo consulta
      if (actua) {
        cb = el("input", { type: "checkbox", "aria-label": "Seleccionar " + (p.marca || g) });
        cb.checked = S.apSel.has(g);
        cb.addEventListener("click", function (ev) { ev.stopPropagation(); if (cb.checked) S.apSel.add(g); else S.apSel["delete"](g); renderAprobar(); });
      }
      var cuerpo;
      if (r.pend && r.pend.estatus === "Estimado") {
        cuerpo = [pill("Por aprobar", "Estimación " + r.pend.estimacion),
          el("span", { class: "s", text: [p.clave, p.takt && "Takt " + p.takt, p.eje && "Eje " + p.eje, (p.largo ? f2(p.largo) + " m" : "")].filter(Boolean).join(" · ") }),
          el("span", { class: "note", text: "Enviado por " + r.pend.por + " · " + fecha(r.pend.at) + (r.pend.validadoPor ? " · validado por " + r.pend.validadoPor : "") + (r.pend.comentario ? " · " + r.pend.comentario : "") }),
          el("span", { class: "note warn", text: etapaGen(r) === "residente" ? "Espera validación del residente" : "Espera aprobación del superintendente" })];
      } else if (r.pend) { // reporte del flujo anterior
        cuerpo = [pill(r.pend.estatus, r.pend.estatus + (r.pend.estatus !== "Terminado" && r.pend.pct ? " " + r.pend.pct + " %" : "")),
          el("span", { class: "s", text: [p.clave, p.zona, p.eje && "Eje " + p.eje, "de " + (r.estatus || "Planeado")].filter(Boolean).join(" · ") }),
          el("span", { class: "note", text: r.pend.por + " · " + fecha(r.pend.at) + (r.pend.comentario ? " · " + r.pend.comentario : "") })];
      } else {
        var antes = r.antes ? r.antes.estatus + (r.antes.estatus === "En ejecución" && r.antes.pct ? " " + r.antes.pct + " %" : "") : "Planeado";
        cuerpo = [pill(r.estatus, r.estatus + (r.estatus === "En ejecución" && r.pct ? " " + r.pct + " %" : "")),
          el("span", { class: "s", text: [p.clave, p.takt && "Takt " + p.takt, p.eje && "Eje " + p.eje, r.rechazo && !r.porValidar ? "propuso: " + r.rechazo.estatus : "antes: " + antes].filter(Boolean).join(" · ") }),
          r.porValidar ? el("span", { class: "note", text: r.porValidar.por + " · " + fecha(r.porValidar.at) + (r.porValidar.comentario ? " · " + r.porValidar.comentario : "") })
            : r.rechazo ? el("span", { class: "note bad", text: "Rechazado por " + r.rechazo.por + " · " + fecha(r.rechazo.at) + (r.rechazo.motivo ? " · " + r.rechazo.motivo : "") })
            : el("span", { class: "note ok", text: r.validado ? "Validado por " + r.validado.por + " · " + fecha(r.validado.at) : "Validado" })];
      }
      var li = el("li", { class: S.apSel.has(g) ? "sel" : "" }, [cb, el("span", { class: "m", text: (p.marca || "(sin marca)") + " · " + p.contratista })].concat(cuerpo));
      li.addEventListener("click", function () { focusPieces([g]); });
      li.addEventListener("dblclick", function () { showDetalle(g); });
      return li;
    }));
  }
  ["ap-contratista", "ap-usuario", "ap-estatus", "ap-zona"].forEach(function (id) {
    if ($(id)) $(id).addEventListener("change", function () { S.apSel.clear(); renderAprobar(); paintModel(true); });
  });
  if ($("ap-buscar")) $("ap-buscar").addEventListener("input", function () { clearTimeout(S.tApBus); S.tApBus = setTimeout(function () { S.apSel.clear(); renderAprobar(); paintModel(true); }, 300); });
  if ($("ap-limpiar")) $("ap-limpiar").addEventListener("click", function () {
    ["ap-contratista", "ap-usuario", "ap-estatus", "ap-zona"].forEach(function (id) { if ($(id)) $(id).value = ""; });
    S.apSel.clear(); renderAprobar(); paintModel(true);
  });
  if ($("ap-cola")) $("ap-cola").addEventListener("change", function () { S.apSel.clear(); renderAprobar(); if (filtrosApActivos()) paintModel(true); });
  // Administrador: descarta las propuestas pendientes de la lista (con un segundo clic para confirmar).
  if ($("ap-descartar")) $("ap-descartar").addEventListener("click", function () {
    var b = $("ap-descartar"), guids = pendientesVista();
    if (!guids.length) { toast("No hay pendientes en esta lista."); return; }
    if (b.getAttribute("data-ok") !== "1") {
      b.setAttribute("data-ok", "1"); b.textContent = "¿Descartar " + guids.length + (guids.length === 1 ? " pendiente" : " pendientes") + "? Clic otra vez";
      setTimeout(function () { b.removeAttribute("data-ok"); b.textContent = "Descartar los pendientes de esta lista"; }, 5000);
      return;
    }
    b.removeAttribute("data-ok"); b.textContent = "Descartar los pendientes de esta lista";
    api("/api/piezas", { action: "descartar", guids: guids.slice(0, 500) }).then(function (r) {
      Object.assign(S.avance, r.avance);
      toast(nf0.format(r.actualizadas) + (r.actualizadas === 1 ? " pendiente descartado." : " pendientes descartados."));
      updateBadge(); renderAprobar(); renderLista(); paintModel();
    }).catch(function (e) { toast(e.message, true); });
  });
  if ($("ap-all")) {
    $("ap-all").addEventListener("change", function () {
      pendientesVista().forEach(function (g) { if ($("ap-all").checked) S.apSel.add(g); else S.apSel["delete"](g); });
      renderAprobar();
    });
    var decide = function (cual) {
      var cola = COLAS[colaActual()], action = cola.acc[cual === "ok" ? 0 : 1];
      var guids = Array.from(S.apSel);
      if (!guids.length) { toast("Selecciona al menos una pieza."); return; }
      api("/api/piezas", { action: action, guids: guids, comentario: $("ap-coment").value })
        .then(function (r) {
          Object.assign(S.avance, r.avance);
          S.apSel.clear(); $("ap-coment").value = "";
          var hecho = { validar: " validadas.", rechazar: " rechazadas: regresan a como estaban.", "gen-validar": " validadas: pasan al superintendente.", "gen-regresar": " regresadas a Terminado.", aprobar: " aprobadas: quedan Estimado.", regresar: " regresadas a Terminado." }[action];
          toast(nf0.format(r.actualizadas) + hecho + (r.omitidas ? " (" + r.omitidas + " sin cambio)" : ""));
          updateBadge(); renderAprobar(); renderLista(); paintModel();
        })
        .catch(function (e) { toast(e.message, true); });
    };
    $("ap-ok").addEventListener("click", function () {
      var cola = COLAS[colaActual()];
      if (cola.revisar) {
        var filas = S.apSel.size ? pendientesVista().filter(function (g) { return S.apSel.has(g); }) : pendientesVista();
        if (!filas.length) { toast("No hay generadores para revisar."); return; }
        abrirPrevia(filas, $("ap-ok"), { cola: colaActual() });
        return;
      }
      decide("ok");
    });
    $("ap-no").addEventListener("click", function () { decide("no"); });
  }

  // ---------- Generador ----------
  function genFilas() {
    var c = $("g-contratista").value, vista = $("g-vista").value;
    return Object.keys(S.piezas).filter(function (g) {
      var p = S.piezas[g], r = rec(g);
      if (c && p.contratista !== c) return false;
      if (vista === "porestimar") return !r.estimacion; // cualquier estatus: lo que resta por estimar
      if (vista === "poraprobar") { // enviadas a estimar, esperando al residente o al superintendente
        var na = $("g-estnum").value;
        return !!(r.pend && r.pend.estatus === "Estimado") && (!na || r.pend.estimacion === na);
      }
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
    sel.hidden = vista !== "estimadas" && vista !== "poraprobar";
    var marcar = $("g-marcar"); if (marcar) marcar.parentNode.hidden = vista !== "porestimar";
    $("g-hint").hidden = vista !== "porestimar";
    if (vista !== "estimadas" && vista !== "poraprobar") return;
    var prev = sel.value;
    var numDe = vista === "poraprobar" ? function (r) { return r.pend && r.pend.estatus === "Estimado" ? r.pend.estimacion : ""; } : function (r) { return r.estimacion; };
    var nums = Array.from(new Set(Object.keys(S.piezas).filter(function (g) { return !c || S.piezas[g].contratista === c; })
      .map(function (g) { return numDe(rec(g)); }).filter(Boolean))).sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
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
    }) : [el("p", { class: "muted", text: { porestimar: "No quedan piezas por estimar.", poraprobar: "No hay piezas esperando aprobación.", estimadas: "Todavía no hay piezas estimadas." }[$("g-vista").value] || "No hay piezas." })]);
    // En el panel solo marca, estatus y estimación; el detalle completo está en "Ver generador".
    // En "Sin estimar", quien estima puede marcar las piezas que van en una misma estimación.
    // Casillas para elegir qué va en el generador: quien estima y el contratista que lo arma.
    var conCasillas = !!((S.permisos.estimar || S.permisos.enviarEstimacion) && $("g-vista").value === "porestimar");
    var elegibles = filas.filter(estimable);
    S.gSel.forEach(function (g) { if (!conCasillas || elegibles.indexOf(g) < 0) S.gSel["delete"](g); });
    var todas = null;
    if (conCasillas) {
      todas = el("input", { type: "checkbox", "aria-label": "Seleccionar todas las terminadas" });
      todas.checked = elegibles.length > 0 && elegibles.every(function (g) { return S.gSel.has(g); });
      todas.disabled = !elegibles.length;
      todas.addEventListener("change", function () { elegibles.forEach(function (g) { if (todas.checked) S.gSel.add(g); else S.gSel["delete"](g); }); renderGenerador(); selectGenEnModelo(); encuadrarSel(S.gSel); });
    }
    var head = el("tr", null, (conCasillas ? [el("th", { class: "chk" }, [todas])] : []).concat(["Marca", "Estatus", "Estimación"].map(function (h) { return el("th", { text: h }); })));
    var rows = filas.map(function (g) {
      var p = S.piezas[g], r = rec(g), est = estado(g);
      var celdas = [];
      if (conCasillas) {
        var ok = estimable(g);
        var cb = el("input", { type: "checkbox", "aria-label": "Incluir " + (p.marca || g) + " en la estimación", title: ok ? "" : "Solo se estiman piezas terminadas y aprobadas" });
        cb.checked = S.gSel.has(g); cb.disabled = !ok;
        cb.addEventListener("click", function (ev) { ev.stopPropagation(); if (cb.checked) S.gSel.add(g); else S.gSel["delete"](g); renderGenerador(); selectGenEnModelo(); encuadrarSel(S.gSel); });
        celdas.push(el("td", { class: "chk" }, [cb]));
      }
      var tr = el("tr", { class: "click" + (S.gSel.has(g) ? " sel" : "") }, celdas.concat([
        el("td", { text: p.marca || "—" }),
        el("td", null, [pill(est, est + (est === "En ejecución" && r.pct ? " " + r.pct + " %" : ""))]),
        el("td", { text: r.estimacion || (r.pend && r.pend.estatus === "Estimado" ? r.pend.estimacion + " · por aprobar" : "—") }),
      ]));
      tr.addEventListener("click", function () { focusPieces([g]); });
      return tr;
    });
    $("g-tabla").replaceChildren(el("thead", null, [head]), el("tbody", null, rows));
    actualizarMarcar();
  }
  function estimable(g) { var r = rec(g); return r.estatus === "Terminado" && !r.pend && !r.porValidar && !r.estimacion; }
  // Piezas seleccionadas con la casilla (si hay); si no, null.
  function genSeleccion() { var sel = genFilas().filter(function (g) { return S.gSel.has(g); }); return sel.length ? sel : null; }
  function actualizarMarcar() {
    var b = $("g-marcar"); if (!b || b.getAttribute("data-confirm")) return;
    var n = S.gSel.size;
    b.textContent = n ? "Enviar " + n + (n === 1 ? " seleccionada" : " seleccionadas") + " a estimar" : "Enviar a estimar";
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
    if (k === "_estimacion") { var re = rec(g); return re.estimacion || (re.pend && re.pend.estatus === "Estimado" ? re.pend.estimacion + " (por aprobar)" : ""); }
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
        var pts = dibujarEtiquetas(ctx, w, h, puntos, sx, sy, k);
        resolve({ data: cv.toDataURL("image/png"), pts: pts });
      };
      img.onerror = function () { resolve({ data: dataUrl, pts: {} }); };
      img.src = dataUrl;
    });
  }
  // Etiquetas de marca (caja oscura, franja del color de la pieza, línea y punto) sobre un lienzo:
  // la usan la foto del generador y la vista 3D. Devuelve dónde quedó cada pieza.
  function dibujarEtiquetas(ctx, w, h, puntos, sx, sy, k) {
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
        return pts;
  }

  // ---------- Zonas: volúmenes de color con % de avance ----------
  // Una caja semitransparente por zona (tren takt o, si no hay, GCP_Zona) que envuelve sus piezas.
  // Al pasar el cursor encima, o sobre la lista, se ve el % de avance aprobado de la zona.
  var ZONA_COLORES = ["#22D3EE", "#F472B6", "#A3E635", "#FB923C", "#818CF8", "#FACC15", "#34D399", "#F87171", "#C084FC", "#38BDF8", "#FDBA74", "#4ADE80"];
  S.zonasOn = false;
  try { S.zonasOn = localStorage.getItem("ctrl_zonas") === "1"; } catch (e) { /* nada */ }
  function zonaDe(p) { return p.takt || p.zona || ""; }
  function avancePieza(g) {
    var r = rec(g), e = r.estatus || "Planeado";
    if (e === "Terminado" || e === "Estimado" || e === "Pagado") return 100;
    if (e === "En ejecución") return Math.max(0, Math.min(100, r.pct || 0));
    return 0;
  }
  // Avance por zona: promedio de sus piezas (pesado por largo cuando las piezas lo traen, como en tramos).
  function datosZonas() {
    var z = {};
    Object.keys(S.piezas).forEach(function (g) {
      var nom = zonaDe(S.piezas[g]); if (!nom) return;
      (z[nom] = z[nom] || { nombre: nom, guids: [] }).guids.push(g);
    });
    var lista = Object.values(z).sort(function (a, b) { return a.nombre.localeCompare(b.nombre, "es", { numeric: true }); });
    lista.forEach(function (o, i) {
      o.color = ZONA_COLORES[i % ZONA_COLORES.length];
      var conLargo = o.guids.filter(function (g) { return S.piezas[g].largo > 0; });
      var base = conLargo.length >= o.guids.length / 2 ? conLargo : o.guids;
      var peso = function (g) { return base === conLargo ? S.piezas[g].largo : 1; };
      var tot = 0, hecho = 0;
      base.forEach(function (g) { tot += peso(g); hecho += peso(g) * avancePieza(g) / 100; });
      o.pct = tot ? Math.round(hecho / tot * 1000) / 10 : 0;
      o.terminadas = o.guids.filter(function (g) { return avancePieza(g) === 100; }).length;
      o.ejecucion = o.guids.filter(function (g) { var a = avancePieza(g); return a > 0 && a < 100; }).length;
      o.pendientes = o.guids.filter(function (g) { return rec(g).pend; }).length;
      o.porLargo = base === conLargo;
    });
    return lista;
  }
  // ---- Orientación del modelo: las cajas de zona van a escuadra con el edificio, no con el norte ----
  // Plano horizontal según el eje vertical del visor (z o y).
  function planoH() {
    var u = S.viewer.navigation.getWorldUpVector();
    return Math.abs(u.z) >= Math.abs(u.y) ? { a: "x", b: "y", up: "z" } : { a: "x", b: "z", up: "y" };
  }
  function girar(a, b, ang) { var c = Math.cos(ang), s = Math.sin(ang); return [a * c - b * s, a * s + b * c]; }
  // Puntos (en mundo) de un fragmento: una muestra de sus vértices; si su geometría no está cargada, las esquinas de su caja.
  function puntosFrag(f, cada) {
    var out = [], v = S.viewer, p = new THREE.Vector3();
    try {
      var proxy = v.impl.getRenderProxy(S.model, f), g = proxy && proxy.geometry;
      if (g && g.vb && g.attributes && g.attributes.position) {
        var st = g.vbstride, off = g.attributes.position.itemOffset || g.attributes.position.offset || 0, n = Math.floor(g.vb.length / st);
        var paso = Math.max(1, Math.floor(n / (cada || 48)));
        for (var i = 0; i < n; i += paso) { p.set(g.vb[i * st + off], g.vb[i * st + off + 1], g.vb[i * st + off + 2]).applyMatrix4(proxy.matrixWorld); out.push(p.clone()); }
        if (out.length) return out;
      }
    } catch (e) { /* sin geometría */ }
    var b = new THREE.Box3(); S.model.getFragmentList().getWorldBounds(f, b);
    [b.min.x, b.max.x].forEach(function (x) { [b.min.y, b.max.y].forEach(function (y) { [b.min.z, b.max.z].forEach(function (z) { out.push(new THREE.Vector3(x, y, z)); }); }); });
    return out;
  }
  // Ángulo del edificio respecto a los ejes del mundo: dirección dominante (módulo 90°) de los elementos alargados.
  function rumboModelo() {
    if (S.rumbo != null) return S.rumbo;
    var it = S.model.getInstanceTree(), pl = planoH(), hist = new Float64Array(180), frags = [];
    Object.keys(S.piezas).forEach(function (g) { var id = S.guid2db.get(g); if (id != null) it.enumNodeFragments(id, function (f) { frags.push(f); }, true); });
    var paso = Math.max(1, Math.floor(frags.length / 600));
    for (var k = 0; k < frags.length; k += paso) {
      var pts = puntosFrag(frags[k], 32); if (pts.length < 3) continue;
      var ma = 0, mb = 0; pts.forEach(function (q) { ma += q[pl.a]; mb += q[pl.b]; }); ma /= pts.length; mb /= pts.length;
      var saa = 0, sbb = 0, sab = 0; pts.forEach(function (q) { var da = q[pl.a] - ma, db = q[pl.b] - mb; saa += da * da; sbb += db * db; sab += da * db; });
      var tr = saa + sbb; if (!tr) continue;
      var dif = Math.sqrt((saa - sbb) * (saa - sbb) + 4 * sab * sab), alarg = dif / tr; // 1 = línea, 0 = sin dirección
      if (alarg < 0.5) continue;
      var phi = 0.5 * Math.atan2(2 * sab, saa - sbb); // dirección principal
      var grados = ((phi * 180 / Math.PI) % 90 + 90) % 90;
      hist[Math.round(grados * 2) % 180] += alarg * Math.sqrt(tr / pts.length);
    }
    var mejor = 0, max = 0;
    for (var i = 0; i < 180; i++) { var s = hist[(i + 179) % 180] + 2 * hist[i] + hist[(i + 1) % 180]; if (s > max) { max = s; mejor = i; } }
    var ang = mejor / 2; if (ang > 45) ang -= 90; // el giro más chico
    S.rumbo = max ? ang * Math.PI / 180 : 0;
    return S.rumbo;
  }
  // Caja de las piezas en el marco del edificio (girado «rumbo»): {min, max} locales.
  function cajaLocal(guids, rumbo) {
    var it = S.model.getInstanceTree(), pl = planoH(), caja = new THREE.Box3();
    guids.forEach(function (g) {
      var id = S.guid2db.get(g); if (id == null) return;
      it.enumNodeFragments(id, function (f) {
        puntosFrag(f, 24).forEach(function (q) {
          var r = girar(q[pl.a], q[pl.b], -rumbo), w = new THREE.Vector3();
          w[pl.a] = r[0]; w[pl.b] = r[1]; w[pl.up] = q[pl.up];
          caja.expandByPoint(w);
        });
      }, true);
    });
    return caja;
  }
  function cajaPiezas(guids) {
    var it = S.model.getInstanceTree(), fl = S.model.getFragmentList(), caja = new THREE.Box3(), tmp = new THREE.Box3();
    guids.forEach(function (g) {
      var id = S.guid2db.get(g); if (id == null) return;
      it.enumNodeFragments(id, function (f) { fl.getWorldBounds(f, tmp); caja.union(tmp); }, true);
    });
    return caja;
  }
  function quitarZonas() {
    var v = S.viewer;
    if (v && v.impl && S.zonasEscena) { v.impl.removeOverlayScene("zonas"); S.zonasEscena = false; v.impl.invalidate(false, false, true); }
    S.zonas = [];
    $("zonas-lista").hidden = true; $("zona-tip").hidden = true;
  }
  function pintarZonas() {
    var v = S.viewer;
    quitarZonas();
    if (!S.zonasOn || !v || !S.model || !S.guid2db || !S.guid2db.size || typeof THREE === "undefined") return;
    var lista = datosZonas();
    if (!lista.length) { $("zonas-lista").hidden = false; $("zonas-lista").replaceChildren(el("b", { text: "Zonas" }), el("span", { class: "muted", text: "Las piezas no traen tren takt ni zona." })); return; }
    v.impl.createOverlayScene("zonas"); S.zonasEscena = true;
    var rumbo = rumboModelo(); S.zonasRumbo = rumbo;
    lista.forEach(function (o) {
      // Caja a escuadra con el edificio: se calcula en su marco girado y se coloca girada de vuelta.
      var caja = cajaLocal(o.guids, rumbo); if (caja.isEmpty()) return;
      var t = caja.size(), cl = caja.center(), pl = planoH();
      var margen = Math.max(t.x, t.y, t.z) * 0.01 + 0.05; // un poco más grande que sus piezas
      caja.expandByScalar(margen / 2);
      var geo = new THREE.BoxGeometry(t.x + margen, t.y + margen, t.z + margen);
      var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color), transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
      var masa = new THREE.Mesh(geo, mat);
      var cw = girar(cl[pl.a], cl[pl.b], rumbo), c = new THREE.Vector3(); c[pl.a] = cw[0]; c[pl.b] = cw[1]; c[pl.up] = cl[pl.up];
      masa.position.copy(c);
      if (pl.up === "z") masa.rotation.z = rumbo; else masa.rotation.y = -rumbo;
      o.cajaMundo = cajaPiezas(o.guids);
      v.impl.addOverlay("zonas", masa);
      try { var bordes = new THREE.EdgesHelper(masa, new THREE.Color(o.color).getHex()); bordes.material.transparent = true; bordes.material.opacity = 0.7; v.impl.addOverlay("zonas", bordes); o.bordes = bordes; } catch (e) { /* sin bordes */ }
      o.caja = caja; o.masa = masa;
      S.zonas.push(o);
    });
    v.impl.invalidate(false, false, true);
    var box = $("zonas-lista");
    var quitar = el("button", { type: "button", class: "zona-ver-todas", hidden: true, text: "× Mostrar todas" });
    quitar.addEventListener("click", function () { aislarZona(null); });
    box.replaceChildren.apply(box, [el("div", { class: "zonas-cab" }, [el("b", { text: "Zonas · avance" }), quitar])].concat(S.zonas.map(function (o) {
      var b = el("button", { type: "button", class: "zona-item", title: "Clic: encuadrar · Doble clic: aislar " + o.nombre }, [el("i", { style: "background:" + o.color }), el("span", { text: o.nombre }), el("span", { class: "pct", text: o.pct + " %" })]);
      b.addEventListener("mouseenter", function () { resaltarZona(o); });
      b.addEventListener("mouseleave", function () { resaltarZona(null); $("zona-tip").hidden = true; });
      b.addEventListener("click", function () { v.navigation.fitBounds(false, o.cajaMundo || o.caja); });
      b.addEventListener("dblclick", function (ev) { ev.preventDefault(); aislarZona(S.zonaAislada === o.nombre ? null : o.nombre); });
      return b;
    })));
    box.hidden = false;
    if (S.zonaAislada && !S.zonas.some(function (o) { return o.nombre === S.zonaAislada; })) S.zonaAislada = null;
    marcarZonaAislada();
  }
  // Doble clic en una zona: solo se ven sus piezas (para seleccionarlas fácil). Otro doble clic, «Mostrar todas»
  // o «Ver modelo completo» la quitan.
  // La zona sigue aislada aunque se apaguen los volúmenes y la lista («Zonas» apagado); se quita con el chip de la barra.
  function idsZonaAislada() {
    if (!S.zonaAislada || !S.zonaAisladaGuids) return null;
    var ids = []; S.zonaAisladaGuids.forEach(function (g) { var id = S.guid2db.get(g); if (id != null) ids.push(id); });
    return ids.length ? ids : null;
  }
  function marcarZonaAislada() {
    var z = S.zonaAislada;
    var chip = $("zona-chip"); chip.hidden = !z; chip.textContent = z ? "Zona aislada: " + z + "  ×" : "";
    qsa("#zonas-lista .zona-item").forEach(function (b, i) { var o = S.zonas[i]; b.classList.toggle("aislada", !!o && o.nombre === z); });
    var q = document.querySelector("#zonas-lista .zona-ver-todas"); if (q) q.hidden = !z;
    (S.zonas || []).forEach(function (o) { var ver = !z || o.nombre === z; if (o.masa) o.masa.visible = ver; if (o.bordes) o.bordes.visible = ver; });
    if (S.viewer && S.viewer.impl) S.viewer.impl.invalidate(false, false, true);
  }
  function aislarZona(nombre) {
    var o = nombre && S.zonas.find(function (z) { return z.nombre === nombre; });
    S.zonaAislada = o ? nombre : null;
    S.zonaAisladaGuids = o ? o.guids.slice() : null;
    if (o && S.verTodo) ponerVerTodo(false);
    marcarZonaAislada();
    if (S.modulo !== "lean") renderLista();
    paintModel(false);
    if (S.filselAbierto) filselContar();
    if (o && S.viewer) S.viewer.navigation.fitBounds(false, o.cajaMundo || o.caja);
    if (nombre) toast("Solo se muestra " + nombre + ". Doble clic otra vez o «Mostrar todas» para ver todo.");
  }
  function resaltarZona(o) {
    (S.zonas || []).forEach(function (z) { z.masa.material.opacity = z === o ? 0.32 : 0.14; });
    qsa("#zonas-lista button").forEach(function (b, i) { b.classList.toggle("activa", S.zonas[i] === o); });
    if (S.viewer) S.viewer.impl.invalidate(false, false, true);
  }
  function tipZona(o, x, y) {
    var tip = $("zona-tip");
    if (!o) { tip.hidden = true; return; }
    tip.style.setProperty("--z", o.color);
    tip.replaceChildren(
      el("b", { text: o.nombre }),
      el("div", { class: "barra" }, [el("span", { style: "width:" + o.pct + "%" })]),
      el("div", { text: o.pct + " % de avance" + (o.porLargo ? " (por largo)" : "") }),
      el("div", { class: "muted", text: o.guids.length + " piezas · " + o.terminadas + " terminadas · " + o.ejecucion + " en ejecución" + (o.pendientes ? " · " + o.pendientes + " por aprobar" : "") }));
    var r = $("viewer").getBoundingClientRect();
    tip.style.left = Math.min(x - r.left + 14, r.width - 230) + "px"; tip.style.top = Math.max(8, y - r.top + 14) + "px";
    tip.hidden = false;
  }
  // Zona bajo el cursor: la caja más chica que cruza el rayo.
  function zonaEn(x, y) {
    var v = S.viewer; if (!v || !(S.zonas || []).length) return null;
    var r = $("viewer").getBoundingClientRect();
    var vp = v.impl.clientToViewport(x - r.left, y - r.top);
    var rayo = new THREE.Ray(); v.impl.viewportToRay(vp, rayo);
    // El rayo se lleva al marco del edificio, donde las cajas son ortogonales.
    var pl = planoH(), rumbo = S.zonasRumbo || 0;
    var loc = function (q) { var r = girar(q[pl.a], q[pl.b], -rumbo), w = new THREE.Vector3(); w[pl.a] = r[0]; w[pl.b] = r[1]; w[pl.up] = q[pl.up]; return w; };
    rayo = new THREE.Ray(loc(rayo.origin), loc(rayo.direction));
    var mejor = null, vol = Infinity;
    S.zonas.forEach(function (o) {
      if (o.masa && !o.masa.visible) return;
      if (!rayo.intersectBox(o.caja)) return;
      var t = o.caja.size(), w = t.x * t.y * t.z;
      if (w < vol) { vol = w; mejor = o; }
    });
    return mejor;
  }
  $("viewer").addEventListener("mousemove", function (ev) {
    if (!S.zonasOn || !(S.zonas || []).length) return;
    if (S.zonaRaf) return;
    S.zonaRaf = requestAnimationFrame(function () {
      S.zonaRaf = 0;
      var o = zonaEn(ev.clientX, ev.clientY);
      if (o !== S.zonaHover) { S.zonaHover = o; resaltarZona(o); }
      tipZona(o, ev.clientX, ev.clientY);
    });
  });
  $("viewer").addEventListener("mouseleave", function () { if (S.zonaHover) { S.zonaHover = null; resaltarZona(null); } $("zona-tip").hidden = true; });
  function pintarZonasBtn() {
    $("zonas-btn").setAttribute("aria-pressed", String(S.zonasOn));
    $("zonas-btn").textContent = "Zonas"; // activo = resaltado (aria-pressed)
  }
  $("zonas-btn").addEventListener("click", function () {
    S.zonasOn = !S.zonasOn;
    try { localStorage.setItem("ctrl_zonas", S.zonasOn ? "1" : "0"); } catch (e) { /* nada */ }
    pintarZonasBtn(); pintarZonas(); // apagar solo esconde volúmenes y lista: la zona aislada se queda
  });
  $("zona-chip").addEventListener("click", function () { aislarZona(null); });
  pintarZonasBtn();

  // ---------- Etiquetas en la vista 3D ----------
  // Las mismas etiquetas del generador, sobre el visor y siguiendo la cámara. Se etiqueta lo que está en foco:
  // en Lean la tarea o el día elegido y lo que se ejecuta en la simulación; en Generador, sus piezas;
  // en las demás pestañas, las piezas seleccionadas.
  var MAX_ETIQ = 150;
  S.etiq = true;
  try { S.etiq = localStorage.getItem("ctrl_etiq") !== "0"; } catch (e) { /* nada */ }
  function piezasAEtiquetar() {
    if (S.modulo === "lean" && window.OBYRA_LEAN && window.OBYRA_LEAN.etiquetas) return window.OBYRA_LEAN.etiquetas() || [];
    var gs = S.tab === "generador" && S.modulo !== "lean" ? genFilas() : Array.from(S.sel || []);
    return gs.filter(function (g) { return S.piezas[g]; }).map(function (g) { return { guid: g, texto: S.piezas[g].marca || "(sin marca)", color: COLOR[estado(g)] || COLOR.Planeado }; });
  }
  function centroPieza(g) {
    S.centros = S.centros || new Map();
    if (S.centros.has(g)) return S.centros.get(g);
    var id = S.guid2db.get(g), c = null;
    if (id != null) {
      var it = S.model.getInstanceTree(), fl = S.model.getFragmentList(), caja = new THREE.Box3(), tmp = new THREE.Box3();
      it.enumNodeFragments(id, function (f) { fl.getWorldBounds(f, tmp); caja.union(tmp); }, true);
      if (!caja.isEmpty()) c = caja.getCenter(new THREE.Vector3());
    }
    S.centros.set(g, c);
    return c;
  }
  function etiquetas3D() {
    if (S.etiqRaf) return;
    S.etiqRaf = requestAnimationFrame(function () { S.etiqRaf = 0; dibujar3D(); });
  }
  function dibujar3D() {
    var cv = $("etiq-3d"), v = S.viewer;
    if (!cv) return;
    var ctx = cv.getContext("2d"), box = $("viewer").getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    var w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    ctx.clearRect(0, 0, w, h);
    $("etiq-n").hidden = true;
    if (!S.etiq || !v || !S.model || !S.guid2db || !S.guid2db.size) return;
    var lista = piezasAEtiquetar();
    var visible = function (id) { try { return v.isNodeVisible ? v.isNodeVisible(id, S.model) : true; } catch (e) { return true; } };
    var puntos = [];
    lista.slice(0, MAX_ETIQ).forEach(function (x) {
      var id = S.guid2db.get(x.guid); if (id == null || !visible(id)) return;
      var c = centroPieza(x.guid); if (!c) return;
      var p = v.worldToClient(c);
      puntos.push({ guid: x.guid, marca: x.texto, color: x.color, x: p.x, y: p.y });
    });
    if (lista.length > MAX_ETIQ) { $("etiq-n").hidden = false; $("etiq-n").textContent = "Etiquetas: " + MAX_ETIQ + " de " + lista.length; }
    if (puntos.length) dibujarEtiquetas(ctx, w, h, puntos, dpr, dpr, dpr * 0.85);
  }
  function pintarEtiqBtn() {
    $("etiq-btn").setAttribute("aria-pressed", String(S.etiq));
    $("etiq-btn").textContent = "Etiquetas";
  }
  $("etiq-btn").addEventListener("click", function () {
    S.etiq = !S.etiq;
    try { localStorage.setItem("ctrl_etiq", S.etiq ? "1" : "0"); } catch (e) { /* nada */ }
    pintarEtiqBtn(); etiquetas3D();
  });
  pintarEtiqBtn();
  window.addEventListener("resize", etiquetas3D);

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
              etiquetar(fr.result, w, h, puntos, w / cw, h / ch).then(function (r) { resolve({ data: r.data, raw: fr.result, pts: r.pts, w: w, h: h }); });
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

  // Vista previa del generador: desde Estimaciones (Ver generador) o desde Aprobaciones (Revisar generador,
  // con los botones para validar o regresar dentro de la vista).
  function abrirPrevia(filas, btn, rev) {
    var texto = btn.textContent; btn.disabled = true; btn.textContent = "Preparando vista…";
    capturarModelo(filas).then(function (img) {
      paintModel(false); if (!rev && genSeleccion()) selectGenEnModelo(); // regresa el modelo a como estaba
      var c = rev ? "" : $("g-contratista").value;
      var grupos = agrupar(filas);
      GP = {
        filas: filas, img: img, grupos: grupos, rev: rev || null,
        titulo: (rev ? "Revisar generador" : "Generador") + (c ? " · " + c : ""),
        sub: [S.obra ? S.obra.nombre : "", rev ? COLAS[rev.cola].nombre : descripcionVista(), filas.length + (filas.length === 1 ? " pieza" : " piezas"),
          grupos.length > 1 ? grupos.length + " generadores" : "", new Date().toLocaleDateString("es-MX", { dateStyle: "long" })].filter(Boolean).join(" · "),
      };
      if (grupos.length === 1) grupos[0].img = img; // la foto ya es justo de ese generador
      GP.todos = grupos; GP.elegido = null; GP.titulo0 = GP.titulo; GP.sub0 = GP.sub;
      if (!rev && grupos.length > 1) { GP.grupos = []; GP.filas = []; GP.img = null; } // primero se elige cuál ver
      else GP.elegido = grupos[0];
      renderPrevia(); textoBotones(); renderGruposPrevia();
      cargarEnvios().then(renderGruposPrevia);
      var R = $("gp-revision");
      if (R) {
        R.hidden = !rev; $("gp-coment").value = "";
        if (rev) { var cola = COLAS[rev.cola]; $("gp-validar").textContent = cola.okRev || cola.ok; $("gp-regresar").textContent = cola.noRev || cola.no; }
      }
      // El contratista envía desde aquí lo que está viendo (solo lo Terminado y validado).
      var E = $("gp-enviar");
      if (E) {
        var nEnv = filas.filter(estimable).length;
        E.hidden = !!rev || !S.permisos.enviarEstimacion || !nEnv;
        $("gp-est").value = $("g-est") ? $("g-est").value : "";
        $("gp-enviar-btn").textContent = "Enviar " + nEnv + (nEnv === 1 ? " pieza" : " piezas") + " a validar";
      }
      $("gen-prev").showModal();
      if (GP.img) abrirZoom(); // la vista del modelo se abre junto a la lista
    }).finally(function () { btn.disabled = false; btn.textContent = texto; if (!rev) actualizarMarcar(); });
  }
  $("g-ver").addEventListener("click", function () {
    var filas = genSeleccion() || genFilas();
    if (!filas.length) { toast("No hay piezas en el generador con este filtro."); return; }
    abrirPrevia(filas, $("g-ver"));
  });
  // Validar o regresar desde la vista del generador.
  function decidirRevision(cual) {
    if (!GP || !GP.rev) return;
    var cola = COLAS[GP.rev.cola], action = cola.acc[cual === "ok" ? 0 : 1], com = $("gp-coment").value.trim();
    if (cual !== "ok" && !com) { toast("Escribe el motivo para que el contratista sepa qué corregir.", true); $("gp-coment").focus(); return; }
    var b = $(cual === "ok" ? "gp-validar" : "gp-regresar"); b.disabled = true;
    api("/api/piezas", { action: action, guids: GP.filas, comentario: com }).then(function (r) {
      Object.assign(S.avance, r.avance);
      S.apSel.clear(); $("gen-prev").close();
      var hecho = { "gen-validar": " validadas para estimación: pasan al superintendente.", "gen-regresar": " regresadas al contratista.", aprobar: " aprobadas: quedan Estimado.", regresar: " regresadas a Terminado." }[action];
      toast(nf0.format(r.actualizadas) + hecho + (r.omitidas ? " (" + r.omitidas + " sin cambio)" : ""));
      updateBadge(); renderAprobar(); renderLista(); paintModel();
    }).catch(function (e) { toast(e.message, true); }).finally(function () { b.disabled = false; });
  }
  if ($("gp-enviar-btn")) $("gp-enviar-btn").addEventListener("click", function () {
    if (!GP) return;
    var est = $("gp-est").value.trim();
    if (!est) { toast("Escribe el número de estimación (ej. AD-003).", true); $("gp-est").focus(); return; }
    var guids = GP.filas.filter(estimable);
    if (!guids.length) { toast("No hay piezas Terminadas y validadas para enviar.", true); return; }
    var b = $("gp-enviar-btn"); b.disabled = true;
    api("/api/piezas", { action: "enviar", guids: guids, estimacion: est }).then(function (r) {
      Object.assign(S.avance, r.avance);
      $("gen-prev").close();
      toast(nf0.format(r.actualizadas) + " piezas enviadas en la estimación " + est.toUpperCase() + ": ahora las valida el residente.");
      S.gSel.clear(); if ($("g-est")) $("g-est").value = "";
      updateBadge(); renderGenerador(); renderLista(); paintModel();
    }).catch(function (e) { toast(e.message, true); }).finally(function () { b.disabled = false; });
  });
  if ($("gp-validar")) $("gp-validar").addEventListener("click", function () { decidirRevision("ok"); });
  if ($("gp-regresar")) $("gp-regresar").addEventListener("click", function () { decidirRevision("no"); });
  $("gp-cerrar").addEventListener("click", function () { $("gen-prev").close(); });
  $("gen-prev").addEventListener("close", cerrarZoom);

  // ---------- Vista ampliada (zoom) de la referencia visual ----------
  // La imagen ya trae las marcas dibujadas, así que al acercar se conservan.
  var Z = { s: 1, tx: 0, ty: 0, fit: 1 };
  function zVisor() { return $("gp-visor"); }
  function aplicarZ() {
    var l = $("gp-lienzo"); l.style.transform = "translate(" + Z.tx + "px," + Z.ty + "px) scale(" + Z.s + ")";
    l.style.setProperty("--gpk", String(1 / Z.s)); // los puntos del concepto conservan su tamaño en pantalla
  }
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
  function abrirZoom(g, sinCentrar) {
    if (!GP || !GP.img) return;
    var abierto = $("gen-prev").classList.contains("gp-zoom");
    if (!abierto) {
      $("gen-prev").classList.add("gp-zoom");
      zVisor().hidden = false;
      $("gp-zimg").src = GP.img.raw || GP.img.data; $("gp-zimg").width = GP.img.w; $("gp-zimg").height = GP.img.h;
      ajustarZ();
      pintarMarcas();
    }
    qsa("#gp-tabla [data-guid]").forEach(function (tr) { tr.classList.toggle("on", !!g && tr.getAttribute("data-guid") === g); });
    var an = $("gp-anillo"); an.hidden = true; GP.fija = g || null;
    if (!g) { mostrarTip(null); return; }
    var p = GP.img.pts && GP.img.pts[g];
    if (!p) { toast("Esa pieza no quedó dentro de la vista del modelo."); return; }
    if (!sinCentrar) { // desde la lista: acerca y centra la pieza; desde la vista: se queda donde está
      var v = zVisor(), cw = v.clientWidth, ch = v.clientHeight;
      Z.s = Math.max(Z.s, Z.fit * 3);
      Z.tx = cw / 2 - p.x * Z.s; Z.ty = ch / 2 - p.y * Z.s;
      aplicarZ();
    }
    an.style.left = p.x + "px"; an.style.top = p.y + "px";
    an.hidden = false; an.style.animation = "none"; void an.offsetWidth; an.style.animation = "";
    mostrarTip(g);
  }
  // Clic en la vista: el localizador y la lista siguen a la pieza (se despliega su concepto).
  function elegirEnVista(g) {
    if (!GP || !GP.elegido && !GP.filas.length) return;
    if (!g) { abrirZoom(null); return; }
    var k = conceptoPrev(g), lista = GP.porConcepto[k] || [];
    GP.abiertos[k] = true;
    if (lista.indexOf(g) >= GP_MUESTRA) GP.completos[k] = true;
    GP.fija = g; renderListaPrevia();
    abrirZoom(g, true);
    var fila = document.querySelector('#gp-tabla [data-guid="' + g + '"]');
    if (fila) fila.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function cerrarZoom() {
    $("gen-prev").classList.remove("gp-zoom");
    zVisor().hidden = true; $("gp-anillo").hidden = true;
    qsa("#gp-tabla [data-guid].on").forEach(function (tr) { tr.classList.remove("on"); });
    if (GP) GP.fija = null;
    mostrarTip(null);
  }
  // Sin etiquetas fijas: la etiqueta de una pieza sale al pasar el cursor o al elegirla en la lista.
  function infoPieza(g) {
    var p = S.piezas[g] || {}, k = conceptoPrev(g), lista = (GP.porConcepto && GP.porConcepto[k]) || [];
    return {
      titulo: (p.concepto || p.tipo || "Pieza") + (p.marca ? " · " + p.marca : ""),
      sub: ["Pieza " + (lista.indexOf(g) + 1) + " de " + lista.length, p.largo ? f2(p.largo) + " m" : "", p.zona || p.takt || ""].filter(Boolean).join(" · "),
    };
  }
  function mostrarTip(g) {
    var t = $("gp-tip"); if (!t) return;
    var p = g && GP && GP.img && GP.img.pts && GP.img.pts[g];
    if (!p) { t.hidden = true; return; }
    var i = infoPieza(g);
    t.replaceChildren(el("b", { text: i.titulo }), el("small", { text: i.sub }));
    t.hidden = false;
    var v = zVisor(), x = Z.tx + p.x * Z.s, y = Z.ty + p.y * Z.s;
    var tw = t.offsetWidth, th = t.offsetHeight;
    t.style.left = Math.min(Math.max(x + 14, 6), v.clientWidth - tw - 6) + "px";
    t.style.top = Math.min(Math.max(y - th - 12, 6), v.clientHeight - th - 6) + "px";
  }
  function piezaCerca(mx, my) {
    if (!GP || !GP.img || !GP.img.pts) return null;
    var ix = (mx - Z.tx) / Z.s, iy = (my - Z.ty) / Z.s, r = 16 / Z.s, mejor = null, dm = r * r;
    Object.keys(GP.img.pts).forEach(function (g) { var p = GP.img.pts[g], d = (p.x - ix) * (p.x - ix) + (p.y - iy) * (p.y - iy); if (d < dm) { dm = d; mejor = g; } });
    return mejor;
  }
  // Puntos sobre las piezas del concepto elegido en la lista.
  function pintarMarcas() {
    var box = $("gp-marcas"), chip = $("gp-chip"); if (!box) return;
    box.replaceChildren();
    var k = GP && GP.conceptoSel, gs = k != null ? (GP.porConcepto[k] || []) : [];
    if (chip) {
      chip.hidden = k == null;
      if (k != null) chip.replaceChildren("Resaltado: ", el("b", { text: k }), " · " + gs.length + " de " + GP.filas.length);
    }
    if (!GP || !GP.img || !GP.img.pts) return;
    gs.forEach(function (g) {
      var p = GP.img.pts[g]; if (!p) return;
      box.appendChild(el("span", { class: "gp-marca", style: "left:" + p.x + "px;top:" + p.y + "px" }));
    });
  }
  (function () {
    var v = zVisor(), arr = null;
    var rel = function (ev) { var r = v.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
    v.addEventListener("wheel", function (ev) { ev.preventDefault(); var p = rel(ev); zoomZ(ev.deltaY < 0 ? 1.18 : 1 / 1.18, p.x, p.y); mostrarTip(GP && GP.fija); }, { passive: false });
    v.addEventListener("dblclick", function (ev) { if (ev.target.closest(".gp-ctrl")) return; var p = rel(ev); zoomZ(2, p.x, p.y); });
    v.addEventListener("pointerdown", function (ev) {
      if (ev.target.closest(".gp-ctrl")) return;
      arr = { x: ev.clientX, y: ev.clientY, tx: Z.tx, ty: Z.ty }; v.setPointerCapture(ev.pointerId); v.classList.add("arrastrando");
    });
    v.addEventListener("pointermove", function (ev) {
      if (!arr) { if (ev.target.closest(".gp-ctrl")) return; var q = rel(ev), g = piezaCerca(q.x, q.y); mostrarTip(g || (GP && GP.fija)); return; }
      Z.tx = arr.tx + ev.clientX - arr.x; Z.ty = arr.ty + ev.clientY - arr.y; aplicarZ(); if (GP && GP.fija) mostrarTip(GP.fija);
    });
    v.addEventListener("pointerleave", function () { if (!arr) mostrarTip(GP && GP.fija); });
    var fin = function () { arr = null; v.classList.remove("arrastrando"); };
    v.addEventListener("pointerup", function (ev) {
      var clic = arr && Math.abs(ev.clientX - arr.x) < 4 && Math.abs(ev.clientY - arr.y) < 4;
      fin();
      if (clic && !ev.target.closest(".gp-ctrl")) { var q = rel(ev); elegirEnVista(piezaCerca(q.x, q.y)); }
    });
    v.addEventListener("pointercancel", fin);
    $("gp-mas").addEventListener("click", function () { zoomZ(1.4, v.clientWidth / 2, v.clientHeight / 2); });
    $("gp-menos").addEventListener("click", function () { zoomZ(1 / 1.4, v.clientWidth / 2, v.clientHeight / 2); });
    $("gp-ajustar").addEventListener("click", function () { ajustarZ(); mostrarTip(GP && GP.fija); });
    $("gp-salir").addEventListener("click", cerrarZoom);
    window.addEventListener("resize", function () { if ($("gen-prev").classList.contains("gp-zoom")) ajustarZ(); });
  })();

  function conceptoPrev(g) { var p = S.piezas[g] || {}; return p.concepto || p.tipo || "(sin concepto)"; }
  var GP_MUESTRA = 5; // piezas visibles al desplegar un concepto, antes de «ver las restantes»
  function renderPrevia() {
    $("gp-titulo").textContent = GP.titulo;
    $("gp-sub").textContent = GP.sub;
    GP.porConcepto = {}; GP.abiertos = GP.abiertos || {}; GP.completos = GP.completos || {};
    GP.filas.forEach(function (g) { var k = conceptoPrev(g); (GP.porConcepto[k] || (GP.porConcepto[k] = [])).push(g); });
    if (GP.conceptoSel != null && !GP.porConcepto[GP.conceptoSel]) GP.conceptoSel = null;
    renderListaPrevia();
    renderResumenPrevia();
    cerrarZoom();
  }
  function renderListaPrevia() {
    if (!GP.elegido) {
      $("gp-tabla").replaceChildren(el("p", { class: "muted gp-vacio", text: "Elige en el menú de arriba el generador que quieres ver." }));
      return;
    }
    var claves = Object.keys(GP.porConcepto).sort(function (a, b) { return GP.porConcepto[b].length - GP.porConcepto[a].length || a.localeCompare(b, "es"); });
    var comun = function (gs, k) { var v = {}; gs.forEach(function (g) { var x = S.piezas[g][k]; if (x) v[x] = 1; }); var l = Object.keys(v); return l.length === 1 ? l[0] : l.length > 1 ? "Varias" : ""; };
    var grupos = claves.map(function (k) {
      var gs = GP.porConcepto[k], abierto = !!GP.abiertos[k], sel = GP.conceptoSel === k;
      var largo = gs.reduce(function (t, g) { return t + (S.piezas[g].largo || 0); }, 0);
      var sub = [comun(gs, "partida"), comun(gs, "zona") || comun(gs, "takt")].filter(Boolean).join(" · ");
      var car = el("button", { type: "button", class: "gp-car", "aria-expanded": String(abierto), "aria-label": (abierto ? "Ocultar" : "Ver") + " las piezas de " + k, text: abierto ? "▾" : "▸" });
      car.addEventListener("click", function (ev) { ev.stopPropagation(); GP.abiertos[k] = !abierto; renderListaPrevia(); });
      var cab = el("div", { class: "gp-gr", role: "button", tabindex: "0", title: "Resaltar en la vista" }, [
        car,
        el("div", { class: "gp-gn" }, [el("b", { text: k }), sub ? el("small", { text: sub }) : null].filter(Boolean)),
        el("span", { class: "gp-gm", text: largo ? f2(largo) + " m" : "—" }),
        el("span", { class: "gp-n", text: nf0.format(gs.length) + (gs.length === 1 ? " pza" : " pzas") }),
      ]);
      var elegir = function () {
        GP.conceptoSel = sel ? null : k;
        if (GP.img && !$("gen-prev").classList.contains("gp-zoom")) abrirZoom();
        renderListaPrevia(); pintarMarcas();
      };
      cab.addEventListener("click", elegir);
      cab.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); elegir(); } });
      var hijos = [cab];
      if (abierto) {
        var ver = GP.completos[k] ? gs : gs.slice(0, GP_MUESTRA);
        ver.forEach(function (g, n) {
          var p = S.piezas[g];
          var it = el("div", { class: "gp-it" + (GP.fija === g ? " on" : ""), "data-guid": g, role: "button", tabindex: "0" }, [
            el("span", { text: String(n + 1) }),
            el("span", { class: "gp-in", text: (p.concepto || p.tipo || "Pieza") + (p.marca ? " · " + p.marca : "") }),
            el("span", { class: "num", text: p.largo ? f2(p.largo) + " m" : "—" }),
            el("span", { text: p.zona || p.takt || "—" }),
          ]);
          // Con vista del modelo: ubica la pieza. Sin vista: lleva a la pieza en el modelo.
          var ir = function () { if (GP.img) abrirZoom(g); else { $("gen-prev").close(); focusPieces([g]); } };
          it.addEventListener("click", ir);
          it.addEventListener("keydown", function (ev) { if (ev.key === "Enter") ir(); });
          hijos.push(it);
        });
        if (gs.length > ver.length) {
          var mas = el("button", { type: "button", class: "gp-mas", text: "… ver las " + nf0.format(gs.length - ver.length) + " piezas restantes" });
          mas.addEventListener("click", function () { GP.completos[k] = true; renderListaPrevia(); });
          hijos.push(mas);
        }
      }
      return el("div", { class: "gp-g" + (sel ? " sel" : "") }, hijos);
    });
    $("gp-tabla").replaceChildren(
      el("div", { class: "gp-lh" }, [
        el("span", { text: claves.length + (claves.length === 1 ? " concepto" : " conceptos") + " · " + nf0.format(GP.filas.length) + (GP.filas.length === 1 ? " pieza" : " piezas") }),
        el("span", { text: "Clic en un concepto para resaltarlo · ▸ para ver sus piezas" }),
      ])
    );
    grupos.forEach(function (g) { $("gp-tabla").appendChild(g); });
  }
  function renderResumenPrevia() {
    $("gp-res-t").hidden = $("gp-resumen").parentNode.hidden = !GP.elegido;
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
      var r0 = rec(g), p = S.piezas[g], est = r0.estimacion || (r0.pend && r0.pend.estatus === "Estimado" ? r0.pend.estimacion : "") || "";
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
    $("gp-excel").hidden = !n; if ($("gp-forma")) $("gp-forma").classList.toggle("oculto-gp", !n);
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
  // Fecha en que se armó el generador: cuando el contratista lo envió (o cuando se aprobó).
  function fechaGrupo(G) {
    var f = "";
    G.filas.forEach(function (g) {
      var r = rec(g), x = "";
      (r.hist || []).forEach(function (h) { if (h.accion === "envia" && (h.estimacion || "") === (G.estimacion || "") && h.at > x) x = h.at; });
      if (!x && r.pend && r.pend.estimacion === G.estimacion) x = r.pend.at || "";
      if (!x && r.aprobado && r.estimacion === G.estimacion) x = r.aprobado.at || "";
      if (x > f) f = x;
    });
    return f;
  }
  function estadoForma(G) {
    var dest = carpetaDe(G.contratista);
    var e = ultimoEnvio(G), nombre = G.contratista + " · " + (G.estimacion || "Sin estimar") + (dest ? " → «" + dest.nombre + "»" : " → sin carpeta");
    if (!e) return pill("Planeado", nombre + " — no enviado a Forma");
    var mismo = e.nombre === G.archivo;
    var txt = nombre + " — enviado " + fecha(e.ultimo.at) + " por " + e.ultimo.por + (e.ultimo.version ? " (versión " + e.ultimo.version + ")" : "");
    if (!mismo) txt += " · archivo de otro día";
    if (e.piezas != null && e.piezas !== G.filas.length) txt += " · se enviaron " + e.piezas + " piezas, ahora son " + G.filas.length;
    return pill("Terminado", txt);
  }
  function elegirGenerador(G) {
    GP.elegido = G || null; GP.grupos = G ? [G] : []; GP.filas = G ? G.filas : [];
    GP.conceptoSel = null; GP.abiertos = {}; GP.completos = {};
    GP.titulo = G ? G.titulo : GP.titulo0; GP.sub = G ? G.sub : GP.sub0;
    var listo = function () {
      GP.img = G ? G.img || null : null;
      renderPrevia(); textoBotones(); renderGruposPrevia();
      if (GP.img) abrirZoom();
    };
    if (!G || G.img !== undefined || !S.viewer) return listo();
    $("gp-tabla").replaceChildren(el("p", { class: "muted gp-vacio", text: "Preparando la vista del generador…" }));
    capturarModelo(G.filas).then(function (img) { G.img = img; paintModel(false); if (GP && GP.elegido === G) listo(); });
  }
  function renderGruposPrevia() {
    if (!GP) return;
    var box = $("gp-grupos"), hijos = [];
    var todos = GP.todos || GP.grupos;
    if (todos.length > 1) {
      var varios = new Set(todos.map(function (G) { return G.contratista; })).size > 1;
      var sel = el("select", { class: "gp-sel", "aria-label": "Generador a ver" },
        [el("option", { value: "", text: "Elige un generador…" })].concat(todos.map(function (G, i) {
          var f = fechaGrupo(G);
          var o = el("option", { value: String(i), text: (varios ? G.contratista + " · " : "") + (G.estimacion || "Sin estimar") + " · " + (f ? new Date(f).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : "sin enviar") });
          if (GP.elegido === G) o.selected = true;
          return o;
        })));
      sel.addEventListener("change", function () { elegirGenerador(sel.value === "" ? null : todos[+sel.value]); });
      hijos.push(sel);
    }
    if (GP.elegido) hijos.push(estadoForma(GP.elegido));
    box.replaceChildren.apply(box, hijos);
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
      if (!guids.length) { toast("No hay piezas Terminadas y validadas por el residente para estimar con este filtro."); return; }
      var btn = $("g-marcar");
      if (btn.getAttribute("data-confirm") !== est) {
        btn.setAttribute("data-confirm", est);
        btn.textContent = "Confirmar: enviar " + guids.length + (guids.length === 1 ? " terminada" : " terminadas") + " en " + est.toUpperCase();
        setTimeout(function () { btn.removeAttribute("data-confirm"); actualizarMarcar(); }, 6000);
        return;
      }
      btn.removeAttribute("data-confirm");
      actualizarMarcar();
      api("/api/piezas", { action: "enviar", guids: guids, estimacion: est })
        .then(function (r) {
          Object.assign(S.avance, r.avance);
          toast(nf0.format(r.actualizadas) + " piezas enviadas en la estimación " + est.toUpperCase() + ": ahora las valida el residente.");
          S.gSel.clear();
          updateBadge(); renderGenerador(); renderLista(); paintModel();
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
    qsa('input[name="unidad"]').forEach(function (r) { r.checked = r.value === (o.unidad || "elemento"); });
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

  // Selector de proyecto en el encabezado (y alta de proyectos para el administrador).
  function pintarProyectos() {
    var sel = $("proyecto-sel");
    var ops = S.proyectos.map(function (p) { return el("option", { value: p.id, text: p.nombre }); });
    if (S.permisos.administrar) ops.push(el("option", { value: "__nuevo", text: "+ Nuevo proyecto…" }));
    sel.replaceChildren.apply(sel, ops);
    sel.value = S.proyecto;
    sel.hidden = S.proyectos.length < 2 && !S.permisos.administrar;
    $("obra-nombre").hidden = !sel.hidden;
  }
  $("proyecto-sel").addEventListener("change", function () {
    var v = $("proyecto-sel").value;
    if (v === "__nuevo") { $("proyecto-sel").value = S.proyecto; $("np-form").reset(); $("nuevo-proyecto").showModal(); return; }
    if (v && v !== S.proyecto) cambiarProyecto(v);
  });
  $("np-cancelar").addEventListener("click", function () { $("nuevo-proyecto").close(); });
  $("np-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var unidad = (document.querySelector('input[name="np-unidad"]:checked') || {}).value || "elemento";
    api("/api/proyectos", { action: "crear", nombre: $("np-nombre").value, unidad: unidad }).then(function (r) {
      toast("Proyecto creado. Cambiando a «" + r.proyecto.nombre + "»…");
      setTimeout(function () { cambiarProyecto(r.proyecto.id); }, 600);
    }).catch(function (e) { toast(e.message, true); });
  });

  function saveObra(body, okMsg) {
    return api("/api/obra", body).then(function () { return api("/api/obra"); }).then(function (o) {
      var cambio = !S.obra.modelo || !o.modelo || S.obra.modelo.urn !== o.modelo.urn;
      S.obra = o; $("obra-nombre").textContent = o.nombre; renderAdmin(); toast(okMsg);
      if (body.action === "nombre") { S.proyectos.forEach(function (p) { if (p.id === S.proyecto) p.nombre = o.nombre; }); pintarProyectos(); }
      if (body.action === "unidad") { S.centros = new Map(); paintModel(); }
      if (cambio && o.modelo) { toast(okMsg + " Cargando el modelo…"); startViewer(); }
    }).catch(function (e) { toast(e.message, true); });
  }
  if ($("obra-form")) {
    $("obra-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveObra({ action: "nombre", nombre: $("obra-input").value }, "Nombre guardado."); });
    $("modelo-form").addEventListener("submit", function (ev) { ev.preventDefault(); saveObra({ action: "modelo", url: $("modelo-url").value }, "Modelo guardado."); });
    $("modelo-act").addEventListener("click", function () { saveObra({ action: "actualizar" }, "Versión revisada."); });
    $("cat-btn").addEventListener("click", leerCatalogo);
    $("unidad-form").addEventListener("change", function () {
      var v = (document.querySelector('input[name="unidad"]:checked') || {}).value;
      if (v) saveObra({ action: "unidad", unidad: v }, v === "ensamble" ? "Las piezas ahora son los ensambles del IFC. Vuelve a leer las piezas del modelo." : "Las piezas ahora son los elementos del IFC. Vuelve a leer las piezas del modelo.");
    });
    $("u-nuevo").addEventListener("click", resetUserForm);
    $("u-rol").addEventListener("change", function () { $("u-contratista").hidden = $("u-rol").value !== "contratista"; $("u-proyectos").hidden = $("u-rol").value === "admin" || S.proyectos.length < 2; });
    $("u-form").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var proys = qsa("#u-proyectos input:checked").map(function (x) { return x.value; });
      api("/api/users", { action: "save", email: $("u-email").value, nombre: $("u-nombre").value, rol: $("u-rol").value, contratista: $("u-contratista").value, activo: $("u-activo").checked, password: $("u-pass").value || undefined, proyectos: proys })
        .then(function () { toast("Usuario guardado."); resetUserForm(); loadUsers(); })
        .catch(function (e) { toast(e.message, true); });
    });
  }
  // Casillas de proyectos del usuario (por omisión, el proyecto en el que estás).
  function pintarUProyectos(lista) {
    var box = $("u-proyectos");
    box.replaceChildren.apply(box, [el("span", { class: "muted", text: "Proyectos:" })].concat(S.proyectos.map(function (p) {
      var c = el("input", { type: "checkbox", value: p.id }); c.checked = lista.indexOf(p.id) >= 0;
      return el("label", { class: "check" }, [c, " " + p.nombre]);
    })));
    box.hidden = $("u-rol").value === "admin" || S.proyectos.length < 2;
  }
  function resetUserForm() {
    $("u-form").reset(); $("u-email").readOnly = false; $("u-form-title").textContent = "Nuevo usuario"; $("u-activo").checked = true;
    if ($("u-rol").querySelector('option[value="residente"]')) $("u-rol").value = "residente";
    $("u-contratista").hidden = $("u-rol").value !== "contratista";
    pintarUProyectos([S.proyecto]);
  }
  function loadUsers() {
    if (!S.permisos.administrar) return;
    api("/api/users").then(function (r) {
      if (!$("u-rol").options.length) { fillSelect($("u-rol"), Object.keys(r.roles).map(function (k) { return [k, r.roles[k]]; })); $("u-rol").value = "residente"; $("u-contratista").hidden = true; pintarUProyectos([S.proyecto]); }
      var nombreP = {}; S.proyectos.forEach(function (p) { nombreP[p.id] = p.nombre; });
      var varios = S.proyectos.length > 1;
      var fechaCorta = function (iso) { return iso ? new Date(iso).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" }) : ""; };
      // Confirmación con segundo clic (sin ventanas del navegador).
      var conConfirmar = function (texto, pregunta, fn) {
        var b = el("button", { class: "btn btn-ghost btn-sm", type: "button", text: texto });
        b.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (b.getAttribute("data-c") !== "1") { b.setAttribute("data-c", "1"); b.textContent = pregunta; setTimeout(function () { b.removeAttribute("data-c"); b.textContent = texto; }, 4000); return; }
          fn();
        });
        return b;
      };
      var rows = r.users.map(function (u) {
        var yo = u.email === S.me.email;
        var pw = u.pw && u.pw.temporal ? el("span", { class: "ln-warn", text: "Contraseña temporal · falta que la cambie" })
          : el("span", { class: "muted", text: u.pw && u.pw.at ? "Contraseña propia" : "Contraseña asignada" });
        var acciones = [];
        if (!yo) {
          var act = el("button", { class: "btn btn-sm " + (u.activo ? "btn-ghost" : "btn-primary"), type: "button", text: u.activo ? "Desactivar" : "Activar" });
          act.addEventListener("click", function (ev) {
            ev.stopPropagation();
            api("/api/users", { action: "activo", email: u.email, activo: !u.activo }).then(function () {
              toast(u.nombre + (u.activo ? " ya no puede entrar." : " ya puede entrar."), false); loadUsers();
            }).catch(function (e) { toast(e.message, true); });
          });
          acciones.push(act);
          acciones.push(conConfirmar("Restablecer contraseña", "¿Restablecer a " + u.nombre.split(" ")[0] + "?", function () {
            api("/api/users", { action: "reset", email: u.email }).then(function (r2) {
              $("reset-pw-quien").textContent = "Nueva contraseña temporal de " + u.nombre + " (" + u.email + "). Su contraseña anterior ya no funciona y se cerraron sus sesiones.";
              $("reset-pw-valor").textContent = r2.temporal;
              $("reset-pw").showModal(); loadUsers();
            }).catch(function (e) { toast(e.message, true); });
          }));
          acciones.push(conConfirmar("Eliminar", "¿Seguro?", function () {
            api("/api/users", { action: "delete", email: u.email }).then(function () { toast("Usuario eliminado."); loadUsers(); }).catch(function (e) { toast(e.message, true); });
          }));
        }
        var detalle = [r.roles[u.rol] || u.rol, u.contratista].filter(Boolean).join(" · ") +
          (varios ? " · " + (u.rol === "admin" ? "Todos los proyectos" : (u.proyectos || []).map(function (p) { return nombreP[p] || p; }).join(", ")) : "");
        var editar = function () {
          $("u-email").value = u.email; $("u-email").readOnly = true; $("u-nombre").value = u.nombre; $("u-rol").value = u.rol;
          $("u-contratista").value = u.contratista; $("u-contratista").hidden = u.rol !== "contratista"; $("u-activo").checked = u.activo; $("u-pass").value = "";
          $("u-form-title").textContent = "Editar " + u.nombre + " (deja la contraseña vacía para no cambiarla)";
          pintarUProyectos(u.proyectos || []);
          $("u-form").scrollIntoView({ behavior: "smooth", block: "start" });
        };
        var bEditar = el("button", { class: "btn btn-sm", type: "button", text: "Editar" });
        bEditar.addEventListener("click", editar);
        // Lista compacta: solo el nombre y su estado; al dar clic se despliega lo demás.
        var det = el("details", { class: "u-item" + (u.activo ? "" : " inactivo") }, [
          el("summary", null, [
            el("i", { class: "u-punto " + (u.activo ? "ok" : "off"), "aria-hidden": "true" }),
            el("b", { text: u.nombre + (yo ? " (tú)" : "") }),
            el("span", { class: "u-rol muted", text: r.roles[u.rol] || u.rol }),
            u.activo ? (u.pw && u.pw.temporal ? el("span", { class: "u-estado warn", text: "Contraseña temporal" }) : null) : el("span", { class: "u-estado off", text: "Inactivo" }),
          ]),
          el("div", { class: "u-cuerpo" }, [
            el("span", { class: "u-correo", text: u.email }),
            el("span", { class: "muted u-det", text: detalle }),
            el("span", { class: "u-estado-txt " + (u.activo ? "ok" : "off"), text: u.activo ? "Activo: puede entrar" : "Inactivo: no puede entrar" }),
            el("span", { class: "u-pw" }, [pw, u.pw && u.pw.at ? el("small", { class: "muted", text: " · " + (u.pw.temporal ? "dada por " : "cambiada por ") + (u.pw.por || "—") + " el " + fechaCorta(u.pw.at) }) : null]),
            el("div", { class: "u-acc" }, [bEditar].concat(acciones)),
          ]),
        ]);
        var li = el("li", null, [det]);
        return li;
      });
      $("u-tabla").replaceChildren.apply($("u-tabla"), rows);
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
          getAccessToken: pedirToken,
        }, resolve);
      });
    });
    return libPromise;
  }
  // Token del visor. El visor de Autodesk lo vuelve a pedir antes de que venza; para que nunca entre en ciclo
  // (miles de solicitudes por minuto), se guarda en el navegador y se reutiliza mientras le queden más de 6 minutos,
  // nunca se piden dos al servidor con menos de 30 s de diferencia y, si falla, se espera cada vez más.
  var TK = { token: "", exp: 0, ultimo: 0, fallas: 0, cola: [] };
  function pedirToken(cb) {
    var ahora = Date.now(), resta = Math.floor((TK.exp - ahora) / 1000);
    if (TK.token && resta > 360) { cb(TK.token, resta); return; }
    TK.cola.push(cb);
    if (TK.cola.length > 1) return; // ya hay una solicitud en camino
    var espera = Math.max(0, TK.ultimo + 30000 - ahora);
    if (TK.fallas) espera = Math.max(espera, Math.min(300000, 15000 * Math.pow(2, TK.fallas - 1)));
    setTimeout(function () {
      TK.ultimo = Date.now();
      fetch("/api/forma/token", { credentials: "same-origin", headers: S.proyecto ? { "X-Proyecto": S.proyecto } : {} })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok || !j.access_token) throw new Error(j.error || "No se pudo obtener acceso al modelo."); return j; }); })
        .then(function (t) {
          TK.fallas = 0; TK.token = t.access_token; TK.exp = Date.now() + Math.max(360, Number(t.expires_in) || 0) * 1000;
          var cs = TK.cola; TK.cola = [];
          cs.forEach(function (f) { f(TK.token, Math.floor((TK.exp - Date.now()) / 1000)); });
        })
        .catch(function (e) {
          TK.fallas++; viewerMsg(e.message || "No se pudo obtener acceso al modelo.");
          // El visor vuelve a pedirlo cuando "vence": se le da un plazo largo para no reintentar en ciclo.
          var cs = TK.cola; TK.cola = [];
          cs.forEach(function (f) { f(TK.token || "", 600); });
        });
    }, espera);
  }

  function startViewer() {
    S.ultimaVista = null; // modelo nuevo: se vuelve a aplicar la visibilidad
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
          var listoMapas = function () { viewerMsg(""); paintModel(); pintarZonas(); if (window.OBYRA_LEAN && window.OBYRA_LEAN.refrescar) window.OBYRA_LEAN.refrescar(); };
          v.addEventListener(Autodesk.Viewing.OBJECT_TREE_CREATED_EVENT, function () { buildMaps().then(listoMapas); });
          if (model.getInstanceTree()) buildMaps().then(listoMapas);
          v.addEventListener(Autodesk.Viewing.SELECTION_CHANGED_EVENT, onViewerSelect);
          S.centros = new Map(); S.marcasModelo = new Map(); S.rumbo = null;
          v.addEventListener(Autodesk.Viewing.CAMERA_CHANGE_EVENT, etiquetas3D);
          v.addEventListener(Autodesk.Viewing.ISOLATE_EVENT, etiquetas3D);
          v.addEventListener(Autodesk.Viewing.HIDE_EVENT, etiquetas3D);
          v.addEventListener(Autodesk.Viewing.SHOW_EVENT, etiquetas3D);
          v.addEventListener(Autodesk.Viewing.VIEWER_RESIZE_EVENT, etiquetas3D);
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
  // La visibilidad (aislar / mostrar todo) solo se toca cuando cambia lo que se debe ver. Así lo que la persona
  // oculta, corta o encuadra con las herramientas del visor se conserva al guardar, crear tareas o simular.
  function cambiaVista(modo, ids) {
    var k = modo + ":" + ids.slice().sort(function (a, b) { return a - b; }).join(",");
    if (k === S.ultimaVista) return false;
    S.ultimaVista = k;
    return true;
  }
  function paintModel(encuadrar, soloEstas) {
    paintModelBase(encuadrar, soloEstas);
    // Lo que el filtro de selección encontró se pinta encima, en verde lima, y se encuadra al elegirlo.
    var v = S.viewer, m = S.model, gs = S.resalte || [];
    if (!v || !m || !gs.length) return;
    var ids = [];
    gs.forEach(function (g) { var id = S.guid2db.get(g); if (id != null) { ids.push(id); v.setThemingColor(id, hexToVec(RESALTE), m, true); } });
    if (S.resalteEncuadrar && ids.length) { v.fitToView(ids, m); S.resalteEncuadrar = false; }
    if (v.impl && v.impl.invalidate) v.impl.invalidate(true, true, true);
  }
  function paintModelBase(encuadrar, soloEstas) {
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
      var zids = idsZonaAislada();
      if (zids) { if (cambiaVista("zona", zids)) v.isolate(zids, m); if (encuadrar) v.fitToView(zids, m); }
      else if (lids.length && window.OBYRA_LEAN.aislar() && (!S.multi || simulando) && !S.verTodo) { if (cambiaVista("iso", lids)) v.isolate(lids, m); if (encuadrar) v.fitToView(lids, m); }
      else { if (cambiaVista("todo", [])) v.showAll(); if (lids.length && encuadrar) v.fitToView(lids, m); }
      if (v.impl && v.impl.invalidate) v.impl.invalidate(true, true, true); // fuerza a redibujar con los colores nuevos
      S.pintados = { pedidas: Object.keys(col).length, enModelo: lids.length };
      etiquetas3D();
      return;
    }
    var ids = [];
    var visibles = soloEstas || (S.tab === "generador" ? genFilas() : S.tab === "piezas" ? filtradas()
      : S.tab === "aprobar" && filtrosApActivos() ? pendientesVista() : Object.keys(S.piezas));
    visibles.forEach(function (g) {
      var id = S.guid2db.get(g);
      if (id == null) return;
      ids.push(id);
      v.setThemingColor(id, hexToVec(colorVista(g)), m, true);
    });
    var zonaIds = soloEstas ? null : idsZonaAislada(); // la foto del generador va solo con sus piezas
    if (soloEstas && ids.length) {
      if (cambiaVista("iso", ids)) v.isolate(ids, m); if (encuadrar) v.fitToView(ids, m);
    } else if (zonaIds) {
      if (cambiaVista("zona", zonaIds)) v.isolate(zonaIds, m); if (encuadrar) v.fitToView(zonaIds, m); // solo la zona elegida
    } else if (ids.length && S.verTodo) {
      if (cambiaVista("todo", [])) v.showAll(); if (encuadrar) v.fitToView(ids, m); // modelo completo con los colores encima
    } else if (ids.length) {
      if (cambiaVista("iso", ids)) v.isolate(ids, m);
      if (encuadrar) v.fitToView(ids, m);
    } else if (S.verTodo) {
      if (cambiaVista("todo", [])) v.showAll();
    } else if (Object.keys(S.piezas).length && (S.tab === "generador" || S.tab === "piezas")) {
      // Nada que mostrar con este filtro (o las piezas no están en esta versión del modelo): nunca dejar el visor en
      // blanco; se ve todo el modelo y se avisa por qué.
      if (cambiaVista("todo", [])) v.showAll();
      var algunaEnModelo = Object.keys(S.piezas).some(function (g) { return S.guid2db.has(g); });
      var aviso = algunaEnModelo ? "Ningún elemento coincide con los filtros: se muestra el modelo completo."
        : "Tus elementos no se encontraron en esta versión del modelo. Avisa al administrador.";
      if (S.avisoVacio !== aviso) { S.avisoVacio = aviso; toast(aviso, !algunaEnModelo); }
    } else {
      if (cambiaVista("todo", [])) v.showAll();
    }
    etiquetas3D();
  }

  // Selección múltiple sin Ctrl: con el botón activo, cada clic agrega o quita una pieza y se ve todo el modelo.
  function multiActiva() { return !!S.multi; }
  function pintarMulti() {
    var n = S.sel ? S.sel.size : 0;
    $("multi-btn").setAttribute("aria-pressed", String(!!S.multi));
    $("multi-btn").textContent = "Selección múltiple";
    $("multi-n").hidden = !n; $("multi-n").textContent = n + (n === 1 ? " pieza seleccionada" : " piezas seleccionadas");
    $("multi-clear").hidden = !n;
    $("filsel-btn").hidden = !S.multi;
    if (!S.multi && S.filselAbierto) filselAbrir(false);
  }
  // Ver modelo completo: deja de aislar (en cualquier pestaña) y conserva los colores.
  function ponerVerTodo(on) {
    S.verTodo = on;
    $("vertodo-btn").setAttribute("aria-pressed", String(S.verTodo));
    $("vertodo-btn").textContent = S.verTodo ? "Modelo completo: activo" : "Ver modelo completo";
  }
  $("vertodo-btn").addEventListener("click", function () {
    var habia = !!S.zonaAislada; S.zonaAislada = null; marcarZonaAislada(); ponerVerTodo(!S.verTodo);
    if (habia && S.modulo !== "lean") renderLista();
    paintModel(false);
  });
  $("multi-btn").addEventListener("click", function () {
    S.multi = !S.multi;
    pintarMulti();
    paintModel(false); // en Lean deja ver todo el modelo mientras se selecciona
    if (S.multi) toast("Da clic en cada elemento para agregarlo o quitarlo. Ya no hace falta Ctrl.");
  });
  $("multi-clear").addEventListener("click", function () {
    S.sel = new Set(); S.soloSel = false;
    if (S.viewer) { S.syncing = true; S.viewer.clearSelection(); S.syncing = false; }
    pintarMulti();
    if (S.modulo !== "lean") renderLista();
  });

  // ---------- Filtro de la selección múltiple: elegir de un jalón por workset, nombre, marca… ----------
  var FILSEL_PROPS = { workset: ["workset"], nombre: ["name"], marca: ["marca", "mark"], categoria: ["category"], familia: ["family"], tipo: ["type"] };
  function filselCandidatos() {
    var v = S.viewer, m = S.model; if (!v || !m || !S.guid2db) return [];
    var base = S.modulo === "lean" && !porEnsamble() ? Array.from(S.guid2db.keys()) : Object.keys(S.piezas);
    return base.filter(function (g) { var id = S.guid2db.get(g); return id != null && v.isNodeVisible(id, m); });
  }
  function filselLeer(guids) {
    S.filselProps = S.filselProps || new Map();
    var falta = guids.filter(function (g) { return !S.filselProps.has(g); });
    if (!falta.length) return Promise.resolve();
    var leer = function (ids) { return bulk(ids, ["Workset", "Name", "Mark", "Marca", "MARCA", "Category", "Family", "Type"]); };
    var deProps = function (r) {
      var o = {};
      (r.properties || []).forEach(function (p) {
        if (/\(IFC TYPE\)/i.test(p.displayCategory || "")) return; // solo las del elemento, no las de su tipo
        var k = norm(p.displayName), val = String(p.displayValue == null ? "" : p.displayValue).trim(); if (!val) return;
        Object.keys(FILSEL_PROPS).forEach(function (c) {
          if (FILSEL_PROPS[c].indexOf(k) < 0) return;
          // El «Name» de Identity Data (el de Revit) gana sobre el nombre genérico del IFC.
          if (c === "nombre" && p.displayCategory === "Identity Data") o.nombreRevit = val;
          else if (!o[c]) o[c] = val;
        });
      });
      if (o.nombreRevit) o.nombre = o.nombreRevit;
      if (o.nombre) o.nombre = o.nombre.replace(/^Ifc\w+::/, "");
      delete o.nombreRevit;
      return o;
    };
    var ids = falta.map(function (g) { return S.guid2db.get(g); });
    return leer(ids).then(function (res) {
      var porId = new Map(); res.forEach(function (r) { porId.set(r.dbId, deProps(r)); });
      // Un ensamble puede no traer workset/categoría: se toma el más repetido de sus partes.
      var it = S.model.getInstanceTree(), hijos = {}, todos = [];
      falta.forEach(function (g) {
        var id = S.guid2db.get(g), o = porId.get(id) || {};
        if (o.workset && o.categoria && o.familia) return;
        var hs = []; it.enumNodeChildren(id, function (c) { if (c !== id) hs.push(c); }, true);
        if (hs.length) { hijos[id] = hs; todos.push.apply(todos, hs); }
      });
      var fin = function (resH) {
        var deH = new Map(); (resH || []).forEach(function (r) { deH.set(r.dbId, deProps(r)); });
        falta.forEach(function (g) {
          var id = S.guid2db.get(g), o = porId.get(id) || {};
          (hijos[id] || []).length && Object.keys(FILSEL_PROPS).forEach(function (c) {
            if (!o[c]) o[c] = masRepetido(hijos[id].map(function (h) { return (deH.get(h) || {})[c]; }));
          });
          if (!o.marca) o.marca = marcaDe(g);
          if (!o.nombre && S.piezas[g]) o.nombre = S.piezas[g].nombre || "";
          S.filselProps.set(g, o);
        });
      };
      return todos.length ? leer(Array.from(new Set(todos))).then(fin, function () { fin([]); }) : fin([]);
    });
  }
  // Valores elegidos en la lista (uno o varios); lo que coincide se resalta en el modelo antes de seleccionarlo.
  var RESALTE = "#B6FF00"; // verde lima: no se confunde con ningún estatus
  var CAMPO_TXT = { workset: "workset", nombre: "nombre", marca: "marca", categoria: "categoría", familia: "familia", tipo: "tipo" };
  S.filselCampo = "workset"; S.filselVals = new Set();
  function filselCoinciden() {
    var campo = S.filselCampo;
    if (!S.filselVals.size) return [];
    return filselCandidatos().filter(function (g) { return S.filselVals.has(((S.filselProps && S.filselProps.get(g)) || {})[campo] || ""); });
  }
  function filselResaltar(encuadrar) {
    var gs = S.filselAbierto ? filselCoinciden() : [];
    S.resalte = gs; S.resalteEncuadrar = !!encuadrar && gs.length > 0;
    paintModel(false);
    var n = gs.length, t = $("filsel-n");
    t.lastChild.textContent = n ? nf0.format(n) + (n === 1 ? " elemento resaltado en el modelo" : " elementos resaltados en el modelo") : "Elige uno o varios valores para verlos en el modelo.";
    t.classList.toggle("activo", !!n);
    ["filsel-agregar", "filsel-solo", "filsel-quitar", "filsel-limpiar"].forEach(function (id) { $(id).disabled = !n; });
    $("filsel-agregar").textContent = n ? "Agregar " + nf0.format(n) + " a la selección" : "Agregar a la selección";
  }
  function filselContar() {
    var campo = S.filselCampo, cands = filselCandidatos(), box = $("filsel-valores");
    box.replaceChildren(el("li", { class: "fs-vacio", text: "Leyendo propiedades…" }));
    filselLeer(cands).then(function () {
      var cuenta = {};
      cands.forEach(function (g) { var val = ((S.filselProps.get(g)) || {})[campo]; if (val) cuenta[val] = (cuenta[val] || 0) + 1; });
      Array.from(S.filselVals).forEach(function (v) { if (!cuenta[v]) S.filselVals.delete(v); });
      var t = norm($("filsel-texto").value);
      var vals = Object.keys(cuenta).filter(function (k) { return !t || norm(k).indexOf(t) >= 0 || S.filselVals.has(k); })
        .sort(function (a, b) { return a.localeCompare(b, "es", { numeric: true }); });
      box.replaceChildren.apply(box, vals.length ? vals.slice(0, 300).map(function (k) {
        var on = S.filselVals.has(k);
        var b = el("button", { type: "button", class: "fs-item", "aria-pressed": String(on), title: k }, [
          el("i", { class: "fs-check", "aria-hidden": "true" }), el("span", { class: "fs-nom", text: k }), el("span", { class: "fs-cnt", text: nf0.format(cuenta[k]) }),
        ]);
        b.addEventListener("click", function () {
          if (S.filselVals.has(k)) S.filselVals.delete(k); else S.filselVals.add(k);
          b.setAttribute("aria-pressed", String(S.filselVals.has(k)));
          filselResaltar(true);
        });
        return el("li", null, [b]);
      }) : [el("li", { class: "fs-vacio", text: Object.keys(cuenta).length ? "Nada coincide con «" + $("filsel-texto").value + "»." : "Los elementos visibles no traen " + CAMPO_TXT[campo] + "." })]);
      filselResaltar(false);
    }).catch(function () { box.replaceChildren(el("li", { class: "fs-vacio", text: "No se pudieron leer las propiedades." })); });
  }
  function filselAplicar(modo) {
    var gs = filselCoinciden(); if (!gs.length) return;
    var antes = Array.from(S.sel || []);
    if (modo === "solo") S.sel = new Set(gs);
    else if (modo === "quitar") S.sel = new Set(antes.filter(function (g) { return gs.indexOf(g) < 0; }));
    else S.sel = new Set(antes.concat(gs.filter(function (g) { return antes.indexOf(g) < 0; })));
    S.filselVals.clear(); // ya quedaron en la selección: se apaga el resaltado
    selectInViewer(); pintarMulti(); etiquetas3D();
    if (S.modulo !== "lean") renderLista();
    filselContar();
    toast((modo === "quitar" ? "Quitados " : "Seleccionados ") + gs.length + " elementos · " + S.sel.size + " en la selección.");
  }
  function filselAbrir(on) {
    S.filselAbierto = on;
    $("filsel").hidden = !on; $("filsel-btn").setAttribute("aria-pressed", String(on));
    if (on) filselContar(); else { S.filselVals.clear(); filselResaltar(false); }
  }
  $("filsel-btn").addEventListener("click", function () { filselAbrir(!S.filselAbierto); });
  qsa("#filsel-campos .fs-campo").forEach(function (b) {
    b.addEventListener("click", function () {
      S.filselCampo = b.getAttribute("data-campo"); S.filselVals.clear(); $("filsel-texto").value = "";
      qsa("#filsel-campos .fs-campo").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
      $("filsel-texto").placeholder = "Buscar " + CAMPO_TXT[S.filselCampo] + "…";
      filselContar();
    });
  });
  $("filsel-texto").addEventListener("input", function () { clearTimeout(S.filselT); S.filselT = setTimeout(filselContar, 200); });
  $("filsel-agregar").addEventListener("click", function () { filselAplicar("agregar"); });
  $("filsel-solo").addEventListener("click", function () { filselAplicar("solo"); });
  $("filsel-quitar").addEventListener("click", function () { filselAplicar("quitar"); });
  $("filsel-limpiar").addEventListener("click", function () { S.filselVals.clear(); filselContar(); });

  function pintarChipSel(id, on) {
    var b = $(id); if (!b) return;
    b.hidden = !on;
  }
  function verTodaLaLista() {
    S.soloSel = false;
    if (S.tab === "aprobar") renderAprobar(); else renderLista();
  }
  if ($("sel-solo-chip")) $("sel-solo-chip").addEventListener("click", verTodaLaLista);
  // Validado: lo seleccionado pasa al generador ya marcado.
  if ($("r-gen")) $("r-gen").addEventListener("click", function () {
    var gs = Array.from(S.sel || []).filter(estimable);
    // El generador abre en «sin estimar», con exactamente lo que venía seleccionado.
    $("g-vista").value = "porestimar";
    if ($("g-contratista") && gs.length && $("g-contratista").value && gs.some(function (g) { return S.piezas[g].contratista !== $("g-contratista").value; })) $("g-contratista").value = "";
    if (window.OBYRA.irA) window.OBYRA.irA("estimaciones"); else if (S.abrirTab) S.abrirTab("generador");
    S.gSel.clear(); gs.forEach(function (g) { S.gSel.add(g); });
    renderGenerador(); selectGenEnModelo(); encuadrarSel(S.gSel);
    toast(gs.length + (gs.length === 1 ? " elemento listo" : " elementos listos") + " en el generador. Revísalos y presiona «Enviar a estimar».");
  });
  if ($("ap-solo-chip")) $("ap-solo-chip").addEventListener("click", verTodaLaLista);

  function onViewerSelect(ev) {
    if (S.syncing) return;
    var gs = (ev.dbIdArray || []).map(function (id) {
      // Si se selecciona una parte de una pieza, sube hasta la pieza.
      // En Lean sirve cualquier elemento del IFC con GlobalId (para ligarlo a tarjetas y actividades).
      var it = S.model.getInstanceTree();
      var subir = function (vale) {
        var cur = id;
        while (cur != null && !vale(cur)) {
          cur = it.getNodeParentId(cur);
          if (cur == null || cur < 0 || cur === it.getRootId()) cur = null;
        }
        return cur;
      };
      var esPieza = function (x) { return !!S.piezas[S.db2guid.get(x)]; };
      var cur;
      if (S.modulo !== "lean") cur = subir(esPieza);
      // En Lean sirve cualquier elemento con GlobalId; por ensamble, primero el tramo (ensamble) que lo contiene.
      else cur = (porEnsamble() ? subir(esPieza) : null) || subir(function (x) { return S.db2guid.has(x); });
      return cur != null ? S.db2guid.get(cur) : null;
    }).filter(function (g, i, a) { return g && a.indexOf(g) === i; });
    if (multiActiva()) {
      // Clic en vacío no borra lo acumulado; un clic suelto alterna esa pieza; Ctrl + clic suma.
      if (!gs.length) { selectInViewer(); return; }
      var acum = new Set(S.sel || []);
      if (gs.length === 1) { if (acum.has(gs[0])) acum["delete"](gs[0]); else acum.add(gs[0]); }
      else gs.forEach(function (g) { acum.add(g); });
      S.sel = acum;
      selectInViewer();
    } else {
      if (!gs.length) { // clic en vacío: la lista vuelve a mostrar todo
        pintarMulti();
        if (S.soloSel && S.modulo !== "lean") { S.soloSel = false; if (S.tab === "aprobar") renderAprobar(); else renderLista(); }
        return;
      }
      // Ctrl + clic: el visor manda toda la selección; se conserva el orden en que se fue armando (orden de montaje).
      var prev = Array.from(S.sel || []).filter(function (g) { return gs.indexOf(g) >= 0; });
      S.sel = new Set(prev.concat(gs.filter(function (g) { return prev.indexOf(g) < 0; })));
      if (porEnsamble()) selectInViewer(); // se resalta el tramo completo, no solo la parte que se tocó
    }
    pintarMulti();
    etiquetas3D();
    if (S.modulo === "lean") return;
    S.soloSel = S.sel.size > 0;
    if (S.tab === "aprobar") {
      // En Aprobaciones lo seleccionado en el modelo queda marcado para validar o rechazar.
      var pend = pendientesVista();
      S.apSel = new Set(pend.filter(function (g) { return S.sel.has(g); }));
      renderAprobar();
      return;
    }
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

  // Marca de elementos que no están en el catálogo (por ejemplo, los que se ligan desde el visor en Lean):
  // se lee de las propiedades del modelo una sola vez por elemento.
  function marcaDe(g) {
    if (S.piezas[g] && S.piezas[g].marca) return S.piezas[g].marca;
    return (S.marcasModelo && S.marcasModelo.get(g)) || "";
  }
  function pedirMarcas(guids, listo) {
    if (!S.model || !S.guid2db || !S.guid2db.size) return;
    S.marcasModelo = S.marcasModelo || new Map();
    var falta = [];
    guids.forEach(function (g) { if (!S.marcasModelo.has(g) && !(S.piezas[g] && S.piezas[g].marca)) { var id = S.guid2db.get(g); if (id != null) { S.marcasModelo.set(g, ""); falta.push([g, id]); } } });
    if (!falta.length) return;
    // Se busca MARCA en el elemento; si no la trae, en sus partes (hijos) y luego en el elemento que lo contiene.
    var it = S.model.getInstanceTree(), raiz = it.getRootId();
    var cand = {}; // dbId del elemento → dbIds donde buscar, en orden
    falta.forEach(function (x) {
      var id = x[1], lista = [id];
      it.enumNodeChildren(id, function (c) { if (c !== id) lista.push(c); }, true);
      var p = it.getNodeParentId(id);
      if (p != null && p > 0 && p !== raiz) lista.push(p);
      cand[id] = lista;
    });
    var todos = Array.from(new Set([].concat.apply([], Object.values(cand))));
    S.nombresModelo = S.nombresModelo || new Map();
    bulk(todos, null).then(function (res) {
      var props = new Map(); res.forEach(function (r) { props.set(r.dbId, r); });
      var hay = false;
      falta.forEach(function (x) {
        var g = x[0], m = "";
        cand[x[1]].some(function (id) { var r = props.get(id); m = r ? pick(r.properties || [], CAMPOS.marca, false) : ""; return !!m; });
        var r0 = props.get(x[1]); if (r0 && r0.name) S.nombresModelo.set(g, r0.name);
        if (m) { S.marcasModelo.set(g, m); hay = true; }
      });
      if (listo) listo();
    }).catch(function () { /* sin marcas: se queda el nombre corto */ });
  }
  function nombreModelo(g) { return (S.nombresModelo && S.nombresModelo.get(g)) || ""; }

  // ---------- Leer piezas del modelo (admin) ----------
  function norm(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, ""); }
  var CAMPOS = {
    contratista: ["gcpcontratista"], clave: ["gcpclaveconcepto"], partida: ["gcppartida"], zona: ["gcpzona"], eje: ["gcpeje"], takt: ["gcptrentakt", "trentakt"],
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
    // En modo ensamble también entran las partes que solo traen tren takt, zona o partida: el ensamble los hereda.
    bulk(ids, porEnsamble() ? ["GCP_Contratista", "GCP_ClaveConcepto", "GCP_TrenTakt", "GCP_Zona", "GCP_Partida", "GCP_Eje"] : ["GCP_Contratista", "GCP_ClaveConcepto"]).then(function (res) {
      var cand = res.filter(function (r) { return (r.properties || []).some(function (p) { return String(p.displayValue || "").trim(); }); }).map(function (r) { return r.dbId; });
      if (!cand.length) throw new Error("Ninguna pieza del modelo tiene GCP_Contratista ni GCP_ClaveConcepto" + (porEnsamble() ? " (en los ensambles ni en sus partes)" : "") + ". Revisa que el IFC se exportó con el Pset GCP_ControlObra.");
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
      if (porEnsamble()) return ensambles(byDb, it);
      return byDb;
    }).then(function (byDb) {
      var it = S.model.getInstanceTree();
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

  // ---------- Avance por ensamble ----------
  function porEnsamble() { return !!(S.obra && S.obra.unidad === "ensamble"); }
  var ES_ENSAMBLE = /assembl|ensambl|montaje/i;
  var HEREDA = ["contratista", "clave", "partida", "zona", "eje", "nivel", "takt"];
  function masRepetido(vals) {
    var n = {}, mejor = "", max = 0;
    vals.forEach(function (v) { if (!v) return; n[v] = (n[v] || 0) + 1; if (n[v] > max) { max = n[v]; mejor = v; } });
    return mejor;
  }
  var CANT = ["Length", "Largo", "Longitud", "NetVolume", "Volume", "GrossVolume", "NetArea", "Area", "GrossArea", "NetSideArea", "OuterSurfaceArea"];
  // La pieza es el ensamble: si un elemento con datos está dentro de otro con datos, cuenta solo el de afuera.
  // Si el ensamble no trae los datos pero sus partes sí, el ensamble toma los de sus partes.
  // Las cantidades del ensamble son la suma de sus partes (cuando el ensamble no las trae).
  function ensambles(byDb, it) {
    var raiz = it.getRootId();
    var arriba = function (id) { var p = it.getNodeParentId(id); return p == null || p < 0 || p === raiz ? null : p; };
    // 1) Padres de elementos con datos que son ensambles del IFC sin datos propios.
    var padres = Array.from(new Set(Object.keys(byDb).map(function (id) { return arriba(Number(id)); }).filter(function (p) { return p != null && !byDb[p]; })));
    return (padres.length ? bulk(padres, null) : Promise.resolve([])).then(function (res) {
      res.forEach(function (r) {
        var props = r.properties || [];
        // Solo ensambles reales (con GlobalId); no los nodos con que el visor agrupa por clase ("IfcElementAssembly").
        if (!S.db2guid.get(r.dbId)) return;
        var cat = pick(props, CAMPOS.categoria, false) || r.name || "";
        if (!ES_ENSAMBLE.test(cat)) return;
        var o = { dbId: r.dbId };
        Object.keys(CAMPOS).forEach(function (k) { o[k] = pick(props, CAMPOS[k], ["area", "areaBruta", "volumen", "largo", "alto", "espesor"].indexOf(k) >= 0); });
        o.tipo = o.tipo || r.name || ""; o.concepto = o.tipo;
        o.guid = S.db2guid.get(r.dbId) || pick(props, GUID_PROPS.map(norm), false);
        byDb[r.dbId] = o;
      });
      // 2) Solo cuenta el de más afuera; lo que le falte lo toma de sus partes (el valor más repetido),
      //    así se respeta el tren takt, zona, partida o contratista que ya tenían las piezas.
      var dentro = function (id) { for (var p = arriba(id); p != null; p = arriba(p)) if (byDb[p]) return true; return false; };
      var tops = Object.keys(byDb).filter(function (id) { return !dentro(Number(id)); });
      tops.forEach(function (id) {
        var o = byDb[id], desc = [];
        it.enumNodeChildren(Number(id), function (c) { if (c !== Number(id) && byDb[c]) desc.push(byDb[c]); }, true);
        if (!desc.length) return;
        HEREDA.forEach(function (k) { if (!o[k]) o[k] = masRepetido(desc.map(function (d) { return d[k]; })); });
        if (!o.marca && desc.length === 1) o.marca = desc[0].marca;
        if (!o.tipo) { o.tipo = desc[0].tipo; o.concepto = o.tipo; }
      });
      Object.keys(byDb).forEach(function (id) { if (tops.indexOf(id) < 0) delete byDb[id]; });
      // Sin contratista ni clave (ni propios ni de sus partes) no es pieza de control.
      Object.keys(byDb).forEach(function (id) { if (!byDb[id].contratista && !byDb[id].clave) delete byDb[id]; });
      // 3) Cantidades: suma de las partes si el ensamble no las trae.
      var falta = Object.values(byDb).filter(function (o) { return o.largo == null || o.area == null || o.volumen == null; });
      var partes = {}, todas = [];
      // Partes = elementos con GlobalId dentro del ensamble (sin bajar a sus puertos ni a su geometría,
      // que repiten las cantidades de la parte). El largo solo suma tramos (segmentos), no conexiones.
      var ES_PUERTO = /^IfcDistributionPort|^IfcPort/i;
      falta.forEach(function (o) {
        partes[o.dbId] = [];
        var bajar = function (id) {
          it.enumNodeChildren(id, function (c) {
            if (c === id) return;
            var n = it.getNodeName(c) || "";
            if (ES_PUERTO.test(n)) return;
            if (S.db2guid.has(c)) { partes[o.dbId].push(c); todas.push(c); } else bajar(c);
          }, false);
        };
        bajar(o.dbId);
      });
      if (!todas.length) return byDb;
      return bulk(todas, CANT).then(function (rs) {
        var por = new Map(); rs.forEach(function (r) { por.set(r.dbId, r.properties || []); });
        falta.forEach(function (o) {
          ["largo", "area", "volumen"].forEach(function (k) {
            if (o[k] != null) return;
            var suma = 0, hay = false;
            partes[o.dbId].forEach(function (c) {
              if (k === "largo" && !/segment/i.test(it.getNodeName(c) || "")) return;
              var v = pick(por.get(c) || [], CAMPOS[k], true); if (v != null) { suma += v; hay = true; }
            });
            if (hay) o[k] = Math.round(suma * 1000) / 1000;
          });
        });
        return byDb;
      });
    });
  }

  // Puente para el módulo Lean (public/lean.js).
  window.OBYRA = {
    S: S, api: api, el: el, $: $, qsa: qsa, toast: toast, fecha: fecha, f2: f2, nf0: nf0, pill: pill, COLOR: COLOR,
    paintModel: paintModel, focusPieces: focusPieces, etiquetas3D: etiquetas3D, loadExcel: loadExcel, marcaDe: marcaDe, pedirMarcas: pedirMarcas, nombreModelo: nombreModelo, renderLegend: renderLegend,
    rec: rec, ORDEN: ORDEN, COLAS: COLAS, enCola: enCola, colasMias: colasMias, avancePieza: avancePieza, estimable: estimable,
    abrirCola: function (k) { if ($("ap-cola")) { pintarColas(); $("ap-cola").value = k; renderAprobar(); } },
    alCambiarAvance: null, // la pone nav.js para refrescar Inicio y la insignia de Aprobaciones
    alIniciar: [], // funciones que corren cuando la app ya cargó obra y piezas
    _onViewerSelect: onViewerSelect, // para pruebas
  };
  boot();
})();
