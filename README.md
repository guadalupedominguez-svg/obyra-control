# OBYRA Control

Hermano de OBYRA para el control de obra **por pieza** sobre el modelo IFC que vive en Autodesk Forma:

1. **Visor** del IFC coloreado por estatus. Cada contratista solo ve sus piezas.
2. **Reporte de avance**: el contratista selecciona piezas (en la lista o en el modelo) y envía *En ejecución %* o *Terminado*; queda **por aprobar**.
3. **Aprobación**: solo residente o superintendente aprueba o rechaza; los demás ven cuántos avances están pendientes (el rechazo exige motivo). Todo queda en la bitácora de cada pieza.
4. **Generador** por contratista: lo que resta por estimar (en cualquier estatus), lo ya estimado por número de estimación, resumen por clave de concepto, Excel (hojas *Resumen* y *Generador*) y **Marcar como estimado** con el número de estimación.
5. **Envío a Forma**: desde «Ver generador» se descargan o se envían a Forma los Excel, uno por cada combinación de contratista y estimación. Cada residente los sube **con su propia cuenta de Autodesk** (la conecta una vez desde la pestaña Generador) a la **carpeta de su contratista** (o a la carpeta general). Si el archivo ya existe, se guarda como versión nueva.
6. **Lean** (selector *Control de obra / Lean* arriba): **Dashboard** de PPC (tendencia, causas, PPC por contratista y cierre de la semana), **Look-ahead** de 6 semanas por zonas o áreas takt con restricciones y el **plan semanal**, y **Sesión Pull** por hito. El PM establece el plan semanal; el residente califica (cumplió / no cumplió + causa) y el superintendente valida o regresa. El contratista ve el look-ahead completo y la sesión pull (mueve solo sus tarjetas), no el Dashboard. Modo takt/zonas, ubicaciones, causas y meta de PPC se ajustan desde *Look-ahead → Ajustes*.

Usuarios y contraseñas propios (no requiere cuenta de Autodesk). Solo el administrador conecta Forma una vez.

## Roles

| Rol | Reporta | Aprueba | Estima | Ve todos los contratistas | Administra |
|---|---|---|---|---|---|
| Administrador | | | ✓ | ✓ | ✓ |
| Superintendente / Residente | | ✓ | ✓ | ✓ | |
| Project manager / Administración de obra | | | ✓ | ✓ | |
| Contratista | ✓ (solo lo suyo, queda por aprobar) | | | | |

En Lean: **PM** (y administrador) planea: actividades, plan semanal, hitos y pasar tarjetas al look-ahead; **residente** califica; **superintendente** valida; **contratista** agrega restricciones a sus actividades y mueve sus tarjetas en la sesión pull.

## Cómo se conecta con el modelo

- El IFC se exporta desde Revit con la configuración **GCP_Control_Obra** (IFC2x3, cantidades base, Pset de usuario `GCP_IFC_PsetUsuario.txt`, *Store the IFC GUID*). Así el GlobalId de cada pieza no cambia entre exportaciones y el avance se conserva.
- En **Configuración → Leer piezas del modelo**, la app toma del visor las piezas con `GCP_Contratista` o `GCP_ClaveConcepto`, su marca, zona, eje, nivel y cantidades (área, volumen, largo, alto, espesor). Las losas internas de una cubierta se cuentan una sola vez. Repite este paso cada vez que subas una versión nueva del IFC.
- El contratista del usuario se escribe **igual** que en `GCP_Contratista` (ej. `COPRESA`).

## Puesta en marcha (Cloudflare Workers)

1. **App de Autodesk (APS)**. En <https://aps.autodesk.com/myapps> usa la app de OBYRA o crea una (tipo *Traditional Web App*) y agrega como Callback URL:
   `https://<tu-dominio>/api/forma/callback`
2. **Base de datos**. Puede ser la misma Upstash Redis de OBYRA: todas las llaves de esta app empiezan con `ctrl:` y no chocan con las de OBYRA (`visor:`).
3. **Secretos** (`wrangler secret put <NOMBRE>`):

   | Variable | Qué es |
   |---|---|
   | `SESSION_SECRET` | Texto aleatorio de 32+ caracteres (`openssl rand -base64 48`) |
   | `KV_REST_API_URL`, `KV_REST_API_TOKEN` | REST de Upstash |
   | `APS_CLIENT_ID`, `APS_CLIENT_SECRET` | App de APS |
   | `APS_CALLBACK_URL` | Opcional; si no, se arma con el dominio |
   | `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Primer administrador (solo se usa mientras no exista ningún usuario) |

4. `npm i -D wrangler && npx wrangler deploy`
5. Entra con `ADMIN_EMAIL`, y en **Configuración**:
   1. **Conectar Forma** con una cuenta que tenga acceso al proyecto.
   2. Pega la **liga del IFC** de Forma Docs (la de la barra del navegador) y guarda.
   3. En *Carpetas de generadores* usa **Elegir carpeta** (explorador de Forma) para la carpeta general y, si quieres dejarlas listas, la de cada contratista. Si no, el residente la elige al enviar. Los residentes necesitan permiso para subir archivos en esas carpetas.
   4. **Leer piezas del modelo**.
   5. Da de alta residentes, superintendentes y contratistas.

Después de crear los usuarios puedes borrar `ADMIN_PASSWORD`.

## Seguridad

- Contraseñas con PBKDF2-SHA256 (100,000 iteraciones), mínimo 10 caracteres; 8 intentos por correo y 30 por IP cada 15 min.
- Sesión cifrada (AES-GCM) en cookie `HttpOnly; Secure; SameSite=Lax` de 12 h. Desactivar a un usuario o cambiar su contraseña cierra sus sesiones al instante.
- Las escrituras solo aceptan JSON (bloquea envíos de formularios desde otros sitios).
- El navegador solo recibe un token de Autodesk de **solo visualización** (`viewables:read`). La conexión del administrador solo lee (`data:read`). Cada residente conecta su propia cuenta (`data:read data:write data:create`) para subir generadores; esos tokens se guardan por usuario y nunca salen del servidor. Si la cuenta de Forma restringe integraciones, el Client ID de la app debe estar en **Account Admin → Custom Integrations** con acceso a Document Management.
- El filtro por contratista se aplica en el servidor, no solo en la pantalla.

## Desarrollo

```bash
cp .env.example .dev.vars   # llena los valores
npx wrangler dev
npm test                    # flujo completo con Redis en memoria
```

## Siguientes fases

- **Lean**: look-ahead, sesiones pull y PPC sobre las mismas piezas y zonas.
- **Finanzas**: conciliación del generador contra Enkontrol (volumen contratado y precio disponible).
- Enlace con OBYRA (visor 360 / Forma).
