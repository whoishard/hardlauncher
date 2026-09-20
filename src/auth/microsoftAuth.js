const { Auth, tokenUtils } = require('msmc');
const { session } = require('electron');

// Sesión propia (no la del launcher) para la ventana de login de Microsoft,
// así el user agent de acá abajo no afecta a ninguna otra parte de la app.
// "persist:" además hace que Windows/Microsoft recuerden la sesión entre
// una apertura y la siguiente del launcher, como cualquier app oficial.
const MS_AUTH_PARTITION = 'persist:hardlauncher-msauth';

// El user agent por defecto de Electron es el que hace que login.live.com
// sirva la pantalla clásica ("Pick an account", fondo blanco fijo, sin
// adaptarse a modo oscuro) en vez de la experiencia de inicio de sesión
// más nueva de Microsoft (bordes redondeados, respeta el tema del sistema).
// Cuál de las dos sirve lo decide Microsoft del lado del servidor según el
// user agent que reciba, así que esto es un mejor-esfuerzo conocido en la
// comunidad de launchers no oficiales, no un ajuste 100% garantizado: si
// Microsoft cambia ese criterio, puede dejar de tener efecto sin que haya
// nada más para ajustar de este lado.
const MODERN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.2478.80';

/**
 * Flujo de login Premium usando la librería msmc, que implementa:
 * MSA OAuth2 -> Xbox Live -> XSTS -> Minecraft Services -> perfil.
 * Abre una ventana de Electron con el login oficial de Microsoft;
 * el usuario nunca introduce credenciales dentro del launcher (más seguro
 * y respeta los términos de Microsoft/Mojang).
 */
async function login() {
  const authManager = new Auth('select_account');
  session.fromPartition(MS_AUTH_PARTITION).setUserAgent(MODERN_UA);
  const xboxManager = await authManager.launch('electron', {
    width: 500,
    height: 650,
    resizable: false,
    title: 'Microsoft',
    backgroundColor: '#1b1b1f',
    webPreferences: { partition: MS_AUTH_PARTITION },
  }); // abre ventana de login MS
  const token = await xboxManager.getMinecraft();

  if (!token.profile) {
    throw new Error('La cuenta de Microsoft no posee licencia de Minecraft: Java Edition.');
  }

  // NOTA: el objeto que devuelve msmc v5 en getMinecraft() sólo expone
  // { mcToken, profile, xuid, parent, entitlements(), mclc(), refresh(), validate() }.
  // No existe un campo "msToken" ni "exp" en este nivel (eso fue un error mío
  // en la versión anterior) — por eso el login tronaba. Los tokens de Xbox/MSA
  // quedan gestionados internamente por la instancia "Xbox" (token.parent).
  return {
    id: `premium-${token.profile.id}`,
    type: 'premium',
    username: token.profile.name,
    uuid: formatUUID(token.profile.id),
    accessToken: token.mcToken,
    xuid: token.xuid,
    clientId: token.profile.id,
    // msmc no expone una fecha de expiración explícita aquí; se usa un valor
    // conservador (el token real de Minecraft dura 24hs) y se refresca antes
    // de que llegue a vencer — ver needsRefresh()/refresh() más abajo.
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
    skinUrl: token.profile.skins?.[0]?.url || null,
    createdAt: Date.now(),
    // BUG FIX (pedía volver a iniciar sesión "cada tanto" y no dejaba jugar
    // en servidores): antes acá se guardaba "_raw", el objeto vivo de msmc
    // en memoria — pero accountManager.saveAccount() lo descarta ANTES de
    // persistirlo a disco (no es serializable, ver ese archivo), así que
    // sobrevivía solo hasta el próximo reinicio del launcher. Como nada en
    // toda la app llamaba a refresh() igual (ver más abajo y game:launch en
    // electron/main.js), el accessToken jamás se renovaba: seguía siendo el
    // mismo desde el login hasta que Minecraft/Mojang lo vencía a las 24hs,
    // momento en el que unirse a un server (que sí valida el token contra
    // los servidores de sesión) empezaba a fallar de golpe.
    //
    // token.mclc(true) devuelve un objeto plano SERIALIZABLE que incluye el
    // refresh_token de Microsoft (ver "Method 2" en la documentación de
    // msmc) — con esto sí se puede pedir un accessToken nuevo en cualquier
    // momento, incluso después de cerrar y volver a abrir el launcher, sin
    // mostrarle de nuevo la ventana de login al jugador.
    msmcToken: token.mclc(true),
  };
}

// Además de reaccionar cuando el juego ya rechazó el token, conviene
// adelantarse: se refresca solo si falta menos de una hora para que venza
// (o ya venció), en vez de esperar a que falle a mitad de una conexión a un
// servidor. Se llama desde game:launch en electron/main.js antes de lanzar
// cualquier instancia con una cuenta premium.
function needsRefresh(account) {
  if (!account || account.type !== 'premium') return false;
  return !account.expiresAt || Date.now() > account.expiresAt - 60 * 60 * 1000;
}

/**
 * Refresca el token de una cuenta premium existente a partir del
 * msmcToken guardado (ver login() de arriba) — funciona aunque el
 * launcher se haya reiniciado de por medio, porque no depende de nada que
 * solo exista en memoria durante la sesión en la que se hizo login.
 */
async function refresh(account) {
  if (!account.msmcToken) {
    // Cuenta creada con una versión vieja del launcher (antes de este
    // arreglo) que nunca guardó un msmcToken, o el refresh_token de
    // Microsoft ya fue revocado del todo: no queda otra que autenticar de
    // nuevo. Esto solo debería pasar una vez por cuenta vieja.
    throw new Error('La sesión de Microsoft expiró. Vuelve a iniciar sesión.');
  }
  const authManager = new Auth('select_account');
  const mc = tokenUtils.fromMclcToken(authManager, account.msmcToken);
  // "true" fuerza el refresco real contra Microsoft/Xbox Live/Minecraft
  // Services en vez de reusar el token viejo si msmc todavía lo considera
  // válido — acá se llama justo porque needsRefresh() ya decidió que hace
  // falta uno nuevo.
  const refreshed = await mc.refresh(true);
  if (!refreshed.profile) {
    throw new Error('La cuenta de Microsoft no posee licencia de Minecraft: Java Edition.');
  }
  return {
    ...account,
    username: refreshed.profile.name,
    accessToken: refreshed.mcToken,
    xuid: refreshed.xuid,
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
    msmcToken: refreshed.mclc(true),
  };
}

function formatUUID(rawId) {
  if (rawId.includes('-')) return rawId;
  return [rawId.slice(0, 8), rawId.slice(8, 12), rawId.slice(12, 16), rawId.slice(16, 20), rawId.slice(20)].join('-');
}

module.exports = { login, refresh, needsRefresh };
