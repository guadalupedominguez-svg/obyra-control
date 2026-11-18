// Administración de usuarios (solo administrador).
//   GET  /api/users                         lista
//   POST /api/users {action:"save", email, nombre, rol, contratista, activo, password?, proyectos?[]}
//   POST /api/users {action:"delete", email}
//   POST /api/users {action:"activo", email, activo}   activa o desactiva (inactivo no puede entrar)
//   POST /api/users {action:"reset", email}   restablece: devuelve una contraseña temporal (se muestra una sola vez)
//                                             que el usuario debe cambiar al entrar
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import { listaProyectos } from "./proyectos.js";
import { PRINCIPAL } from "../lib/proyecto.js";
import {
  ROLES, requireUser, allUsers, getUser, saveUser, deleteUser, publicUser, normEmail, checkPassword, hashPassword, contrasenaTemporal,
} from "../lib/users.js";

export default route(["GET", "POST"], async (req, res) => {
  const me = await requireUser(req, "administrar");

  if (req.method === "GET") {
    const all = await allUsers();
    const list = Object.entries(all).map(([e, u]) => publicUser(e, u)).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
    res.status(200).json({ users: list, roles: ROLES });
    return;
  }

  const body = await readJson(req);
  const email = normEmail(body.email);

  if (body.action === "reset") {
    const u = await getUser(email);
    if (!u) throw new HttpError(404, "Ese usuario no existe.");
    if (email === me.email) throw new HttpError(400, "Para tu propia contraseña usa «Contraseña» arriba a la derecha.");
    const temporal = contrasenaTemporal();
    u.pw = await hashPassword(temporal);
    u.pwv = (u.pwv || 0) + 1; // cierra sus sesiones abiertas
    u.pwTemp = true; u.pwAt = new Date().toISOString(); u.pwPor = me.nombre;
    await saveUser(email, u);
    res.status(200).json({ ok: true, temporal, user: publicUser(email, u) });
    return;
  }

  if (body.action === "activo") {
    const u = await getUser(email);
    if (!u) throw new HttpError(404, "Ese usuario no existe.");
    if (email === me.email) throw new HttpError(400, "No puedes desactivarte a ti mismo.");
    u.activo = body.activo !== false;
    await saveUser(email, u);
    res.status(200).json({ ok: true, user: publicUser(email, u) });
    return;
  }

  if (body.action === "delete") {
    if (email === me.email) throw new HttpError(400, "No puedes eliminar tu propio usuario.");
    await deleteUser(email);
    res.status(200).json({ ok: true });
    return;
  }

  if (body.action === "save") {
    const rol = String(body.rol || "");
    if (!ROLES[rol]) throw new HttpError(400, "Elige un rol válido.");
    const nombre = cleanText(body.nombre, 80, "El nombre", { required: true });
    const contratista = rol === "contratista" ? cleanText(body.contratista, 60, "El contratista", { required: true }).toUpperCase() : "";
    const prev = await getUser(email);
    if (email === me.email && (rol !== "admin" || body.activo === false)) throw new HttpError(400, "No puedes quitarte el rol de administrador ni desactivarte.");
    const u = prev || { creado: new Date().toISOString() };
    u.nombre = nombre;
    u.rol = rol;
    u.contratista = contratista;
    u.activo = body.activo !== false;
    // Proyectos a los que entra (el admin entra a todos).
    if (Array.isArray(body.proyectos)) {
      const existen = new Set((await listaProyectos()).map((p) => p.id));
      const elegidos = [...new Set(body.proyectos.map(String))].filter((p) => existen.has(p));
      if (!elegidos.length && rol !== "admin") throw new HttpError(400, "Elige al menos un proyecto para el usuario.");
      u.proyectos = elegidos.length ? elegidos : [PRINCIPAL];
    }
    if (body.password) {
      u.pw = await hashPassword(checkPassword(body.password));
      u.pwv = (u.pwv || 0) + 1; // cierra las sesiones abiertas con la contraseña anterior
      // La que pone el administrador es temporal: el usuario la cambia al entrar (salvo la del propio admin).
      u.pwTemp = email !== me.email; u.pwAt = new Date().toISOString(); u.pwPor = me.nombre;
    } else if (!prev) {
      throw new HttpError(400, "Asigna una contraseña inicial al usuario nuevo.");
    }
    await saveUser(email, u);
    res.status(200).json({ ok: true, user: publicUser(email, u) });
    return;
  }

  throw new HttpError(400, "Acción no reconocida.");
});
