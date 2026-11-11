// Sesión con usuario y contraseña propios.
//   GET  /api/session            quién soy (o loggedIn:false)
//   POST /api/session {action:"login", email, password}
//   POST /api/session {action:"logout"}
//   POST /api/session {action:"password", actual, nueva}   cambia mi contraseña
import { route, readJson, HttpError } from "../lib/http.js";
import { saveSession, clearSession } from "../lib/session.js";
import { hit, storeConfigured, key, cmd } from "../lib/store.js";
import { cuentaStatus, borrarCuenta } from "../lib/forma.js";
import {
  ROLES, CAN, currentUser, getUser, saveUser, verifyPassword, hashPassword, normEmail, checkPassword, ensureBootstrapAdmin,
} from "../lib/users.js";

const clientIp = (req) => String(req.headers["cf-connecting-ip"] || req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "?";

export default route(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const config = { store: storeConfigured(), secret: Boolean(process.env.SESSION_SECRET) };
    if (!config.store || !config.secret) {
      res.status(200).json({ loggedIn: false, config });
      return;
    }
    await ensureBootstrapAdmin();
    const u = await currentUser(req);
    if (!u) { res.status(200).json({ loggedIn: false, config }); return; }
    const permisos = Object.fromEntries(Object.entries(CAN).map(([k, roles]) => [k, roles.includes(u.rol)]));
    // Cuenta de Autodesk propia (para enviar generadores a Forma).
    const autodesk = permisos.estimar ? await cuentaStatus(u.email) : null;
    res.status(200).json({ loggedIn: true, user: { ...u, rolNombre: ROLES[u.rol] || u.rol }, permisos, roles: ROLES, config, autodesk });
    return;
  }

  const body = await readJson(req);
  if (body.action === "autodesk-desconectar") {
    const u = await currentUser(req);
    if (!u) throw new HttpError(401, "Tu sesión terminó. Vuelve a entrar.");
    await borrarCuenta(u.email);
    res.status(200).json({ ok: true });
    return;
  }

  if (body.action === "logout") {
    clearSession(res);
    res.status(200).json({ ok: true });
    return;
  }

  if (body.action === "login") {
    await ensureBootstrapAdmin();
    let email;
    try { email = normEmail(body.email); } catch { throw new HttpError(401, "Correo o contraseña incorrectos."); }
    // Máximo 8 intentos por correo y 30 por dirección IP cada 15 minutos.
    const byMail = await hit(key("intentos", "mail", email), 900);
    const byIp = await hit(key("intentos", "ip", clientIp(req)), 900);
    if (byMail > 8 || byIp > 30) throw new HttpError(429, "Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.");
    const u = await getUser(email);
    const ok = u && u.activo !== false && (await verifyPassword(String(body.password || ""), u.pw));
    if (!ok) throw new HttpError(401, "Correo o contraseña incorrectos.");
    await cmd(["DEL", key("intentos", "mail", email)]);
    saveSession(res, { email, pwv: u.pwv || 0, exp: Date.now() + 12 * 3600 * 1000 });
    res.status(200).json({ ok: true });
    return;
  }

  if (body.action === "password") {
    const me = await currentUser(req);
    if (!me) throw new HttpError(401, "Inicia sesión para continuar.");
    const u = await getUser(me.email);
    if (!(await verifyPassword(String(body.actual || ""), u.pw))) throw new HttpError(400, "La contraseña actual no es correcta.");
    u.pw = await hashPassword(checkPassword(body.nueva));
    u.pwv = (u.pwv || 0) + 1;
    await saveUser(me.email, u);
    saveSession(res, { email: me.email, pwv: u.pwv, exp: Date.now() + 12 * 3600 * 1000 });
    res.status(200).json({ ok: true });
    return;
  }

  throw new HttpError(400, "Acción no reconocida.");
});
