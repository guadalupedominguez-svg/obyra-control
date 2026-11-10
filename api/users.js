// Administración de usuarios (solo administrador).
//   GET  /api/users                         lista
//   POST /api/users {action:"save", email, nombre, rol, contratista, activo, password?}
//   POST /api/users {action:"delete", email}
import { route, readJson, HttpError, cleanText } from "../lib/http.js";
import {
  ROLES, requireUser, allUsers, getUser, saveUser, deleteUser, publicUser, normEmail, checkPassword, hashPassword,
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
    if (body.password) {
      u.pw = await hashPassword(checkPassword(body.password));
      u.pwv = (u.pwv || 0) + 1; // cierra las sesiones abiertas con la contraseña anterior
    } else if (!prev) {
      throw new HttpError(400, "Asigna una contraseña inicial al usuario nuevo.");
    }
    await saveUser(email, u);
    res.status(200).json({ ok: true, user: publicUser(email, u) });
    return;
  }

  throw new HttpError(400, "Acción no reconocida.");
});
