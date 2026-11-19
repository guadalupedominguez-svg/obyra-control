// Pronóstico del clima de la obra, según la ubicación del proyecto registrada en ACC (Autodesk Construction Cloud).
//   GET /api/clima    cualquier usuario con sesión → { lugar, actual, dias[] } o { error }
// La dirección se lee de la API de administración de ACC con la conexión de Forma; el lugar se ubica y el
// pronóstico se consulta en Open-Meteo (sin llave). Se guarda 1 hora para no repetir consultas.
import { route, HttpError } from "../lib/http.js";
import { key, getJson, setJson } from "../lib/store.js";
import { requireUser } from "../lib/users.js";
import { call } from "../lib/forma.js";

const CACHE = () => key("clima");

async function json(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new HttpError(502, "El servicio del clima no respondió (" + r.status + ").");
  return r.json();
}

// Dirección del proyecto en ACC.
async function direccionAcc(projectId) {
  const id = String(projectId || "").replace(/^b\./, "");
  const p = await call("/construction/admin/v1/projects/" + id);
  const d = {
    calle: p.addressLine1 || "", ciudad: p.city || "", estado: p.stateOrProvince || "", pais: p.country || "",
    cp: p.postalCode || "", lat: p.latitude != null ? Number(p.latitude) : null, lon: p.longitude != null ? Number(p.longitude) : null,
    proyecto: p.name || "",
  };
  return d;
}

// Coordenadas del lugar: las de ACC si las trae; si no, se busca la ciudad.
async function coordenadas(d) {
  if (Number.isFinite(d.lat) && Number.isFinite(d.lon) && (d.lat || d.lon)) return { lat: d.lat, lon: d.lon, nombre: [d.ciudad, d.estado].filter(Boolean).join(", ") };
  for (const q of [d.ciudad, d.cp, d.estado].filter(Boolean)) {
    const g = await json("https://geocoding-api.open-meteo.com/v1/search?count=5&language=es&name=" + encodeURIComponent(q));
    const rs = (g && g.results) || [];
    const r = rs.find((x) => !d.pais || [x.country, x.country_code].some((c) => c && String(c).toLowerCase().startsWith(String(d.pais).toLowerCase().slice(0, 2)))) || rs[0];
    if (r) return { lat: r.latitude, lon: r.longitude, nombre: [r.name, r.admin1].filter(Boolean).join(", ") };
  }
  return null;
}

export default route(["GET"], async (req, res) => {
  await requireUser(req);
  const c = await getJson(CACHE());
  if (c && Date.now() - Date.parse(c.at) < 3600_000) { res.status(200).json(c); return; }
  const obra = (await getJson(key("obra"))) || {};
  if (!obra.projectId) { res.status(200).json({ error: "El proyecto aún no está ligado a ACC (falta cargar el modelo)." }); return; }
  let d;
  try { d = await direccionAcc(obra.projectId); }
  catch (e) {
    const permiso = /privilege|403/i.test(String(e.message));
    res.status(200).json({ error: permiso ? "Falta permiso para leer la ubicación en ACC: un administrador debe volver a conectar Forma en Configuraciones."
      : "No se pudo leer la ubicación del proyecto en ACC.", detalle: e.message });
    return;
  }
  const lugar = await coordenadas(d);
  if (!lugar) { res.status(200).json({ error: "El proyecto en ACC no tiene una dirección registrada." }); return; }
  const f = await json("https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=5&latitude=" + lugar.lat + "&longitude=" + lugar.lon +
    "&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
  const dd = f.daily || {};
  const out = {
    at: new Date().toISOString(),
    lugar: lugar.nombre || [d.ciudad, d.estado].filter(Boolean).join(", "),
    actual: f.current ? { temp: f.current.temperature_2m, codigo: f.current.weather_code, viento: f.current.wind_speed_10m } : null,
    dias: (dd.time || []).map((t, i) => ({ fecha: t, codigo: dd.weather_code[i], max: dd.temperature_2m_max[i], min: dd.temperature_2m_min[i], lluvia: dd.precipitation_probability_max[i] })),
  };
  await setJson(CACHE(), out);
  res.status(200).json(out);
});
