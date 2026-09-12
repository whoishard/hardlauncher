const { Auth } = require('msmc');
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
  // quedan gestionados internamente por la instancia "Xbox" (token.parent);
  // para refrescar la sesión sin pedir login de nuevo se usa token.refresh().
  return {
    id: `premium-${token.profile.id}`,
    type: 'premium',
    username: token.profile.name,
    uuid: formatUUID(token.profile.id),
    accessToken: token.mcToken,
    xuid: token.xuid,
    clientId: token.profile.id,
    // msmc no expone una fecha de expiración explícita aquí; se usa un valor
    // conservador y se revalida con validate()/refresh() antes de cada uso.
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
    skinUrl: token.profile.skins?.[0]?.url || null,
    createdAt: Date.now(),
    // Se guarda el objeto crudo para poder llamar mcToken.refresh() más tarde
    // sin tener que rehacer todo el flujo OAuth desde cero.
    _raw: token,
  };
}

/**
 * Refresca el token de una cuenta premium existente. Usa el método refresh()
 * que expone el propio objeto Minecraft devuelto por getMinecraft() — msmc
 * gestiona internamente el ciclo de vida del token de Xbox/MSA, así que no
 * hace falta guardar ni manipular un refresh_token manualmente.
 */
async function refresh(account) {
  if (!account._raw || typeof account._raw.refresh !== 'function') {
    // No tenemos el objeto vivo en memoria (ej. tras reiniciar la app):
    // no hay forma de refrescar sin volver a autenticar.
    throw new Error('La sesión de Microsoft expiró. Vuelve a iniciar sesión.');
  }
  const refreshedToken = await account._raw.refresh();
  return {
    ...account,
    accessToken: refreshedToken.mcToken,
    expiresAt: Date.now() + 20 * 60 * 60 * 1000,
    _raw: refreshedToken,
  };
}

function formatUUID(rawId) {
  if (rawId.includes('-')) return rawId;
  return [rawId.slice(0, 8), rawId.slice(8, 12), rawId.slice(12, 16), rawId.slice(16, 20), rawId.slice(20)].join('-');
}

module.exports = { login, refresh };
