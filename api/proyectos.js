// Proyectos (obras) de la app.
//   GET  /api/proyectos                         los proyectos a los que entra el usuario
//   POST /api/proyectos {action:"crear", nombre, unidad?}   admin: proyecto nuevo y vacío
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { cmd, getJson, hgetallJson, hsetJson } from "../lib/store.js";
import { currentUser, requireUser } from "../lib/users.js";
import { PRINCIPAL, proyectoActual, tieneAcceso, slug } from "../lib/proyecto.js";

const PROYECTOS = "ctrl:proyectos"; // hash común: id -> {id, nombre, creado}

// Lista completa; el principal siempre existe (es la obra original).
export async function listaProyectos() {
  const todos = await hgetallJson(PROYECTOS);
  if (!todos[PRINCIPAL]) {
    const o = (await getJson("ctrl:obra")) || {};
    todos[PRINCIPAL] = { id: PRINCIPAL, nombre: o.nombre || "Proyecto principal" };
  }
  return Object.values(todos).sort((a, b) => (a.id === PRINCIPAL ? -1 : b.id === PRINCIPAL ? 1 : a.nombre.localeCompare(b.nombre, "es")));
}
export async function existeProyecto(id) {
  return id === PRINCIPAL || Boolean(await cmd(["HGET", PROYECTOS, id]));
}
// Cuando cambia el nombre de la obra, cambia el del proyecto.
export async function guardarNombreProyecto(nombre) {
  const id = proyectoActual();
  const todos = await hgetallJson(PROYECTOS);
  await hsetJson(PROYECTOS, { [id]: { ...(todos[id] || { id, creado: new Date().toISOString() }), nombre } });
}

export default route(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const me = await currentUser(req);
    if (!me) throw new HttpError(401, "Inicia sesión para continuar.");
    const lista = (await listaProyectos()).filter((p) => tieneAcceso(me, p.id));
    res.status(200).json({ proyectos: lista, actual: proyectoActual() });
    return;
  }
  await requireUser(req, "administrar");
  const body = await readJson(req);
  if (body.action === "crear") {
    const nombre = cleanText(body.nombre, 120, "El nombre del proyecto", { required: true });
    const existentes = new Set((await listaProyectos()).map((p) => p.id));
    let id = slug(nombre), n = 2;
    while (existentes.has(id)) id = slug(nombre).slice(0, 28) + "-" + n++;
    const p = { id, nombre, creado: new Date().toISOString() };
    await hsetJson(PROYECTOS, { [id]: p });
    const unidad = body.unidad === "ensamble" ? "ensamble" : "elemento";
    await cmd(["SET", "ctrl:p:" + id + ":obra", JSON.stringify({ nombre, unidad })]);
    res.status(200).json({ ok: true, proyecto: p });
    return;
  }
  throw new HttpError(400, "Acción no reconocida.");
});
