// Proyectos: cada obra tiene sus propios datos (modelo, piezas, avance, generadores, carpetas y Lean).
// El proyecto llega en el encabezado "x-proyecto" de cada solicitud y vive mientras dura esa solicitud.
// El proyecto "principal" es la obra original: sus llaves no cambian ("ctrl:obra", "ctrl:lean:…");
// los demás usan "ctrl:p:<id>:…". Usuarios, sesiones y conexión con Forma son comunes a todos.
import { AsyncLocalStorage } from "node:async_hooks";

export const PRINCIPAL = "principal";
const als = new AsyncLocalStorage();
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const idValido = (v) => ID.test(String(v || ""));
export const proyectoActual = () => als.getStore() || PRINCIPAL;
export function conProyecto(id, fn) {
  return als.run(idValido(id) ? String(id) : PRINCIPAL, fn);
}
// Llaves que pertenecen a un proyecto (lo demás es común).
export const RAICES = new Set(["obra", "envios", "lean", "piezas", "avance"]);

// ¿El usuario entra a este proyecto? El admin entra a todos; quien no tiene lista, solo al principal.
export function tieneAcceso(u, id) {
  if (!u) return false;
  if (u.rol === "admin") return true;
  const lista = Array.isArray(u.proyectos) ? u.proyectos : [PRINCIPAL];
  return lista.includes(id);
}

// Identificador a partir del nombre: "Torre Médica Norte" → "torre-medica-norte".
export function slug(nombre) {
  return String(nombre || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "proyecto";
}
