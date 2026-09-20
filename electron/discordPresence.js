const { Client } = require('@xhayper/discord-rpc');

// ---------- Discord Rich Presence ----------
//
// Muestra en el perfil de Discord del jugador (mientras tiene Discord
// abierto) que está usando Hard Launcher, y qué instancia/versión está
// jugando en caso de que haya una partida abierta.
//
// Cómo funciona en la práctica:
// 1. Discord corre en la PC del jugador un servidor IPC local (un pipe con
//    nombre en Windows, un socket unix en Mac/Linux). Esta librería se
//    conecta ahí directamente — no hace falta que el jugador inicie sesión
//    ni autorice nada, solo que Discord esté abierto.
// 2. Para que la "actividad" tenga nombre/ícono propio ("Hard Launcher" en
//    vez de un ID pelado), la conexión se identifica con un Application ID
//    de Discord Developer Portal (ver CLIENT_ID abajo). Sin uno propio,
//    Discord muestra el rich presence con un nombre genérico.
// 3. Si Discord no está corriendo, connect() falla — eso es esperable, no
//    un error real. Por eso se reintenta solo cada cierto tiempo en vez de
//    darse por vencido, así que si el jugador abre Discord después de abrir
//    el launcher, la presencia aparece sola sin que haga falta reiniciar
//    nada.

// TODO: reemplazar por tu propio Application ID. Se crea gratis en
// https://discord.com/developers/applications → "New Application" → el
// nombre que le pongas ahí ("Hard Launcher") es el que va a aparecer en el
// perfil de Discord de tus jugadores. El ID va en la página general de la
// app ("Application ID"). Si además subís una imagen en la pestaña "Rich
// Presence" → "Art Assets" con el key 'launcher_icon', ese es el nombre que
// hay que usar abajo en largeImageKey para que se vea tu ícono en vez de no
// mostrar ninguna imagen.
const CLIENT_ID = '1548438227109679104';

// El RPC local de Discord (ver comentario grande más abajo sobre
// largeImageKey/smallImageKey) sólo puede mostrar imágenes que ya estén
// subidas de antemano en el Developer Portal, identificadas por un "key"
// de texto — no hay forma de mandarle un color/variante calculado en
// tiempo real. Por eso el logo con color (ver accentColor en
// settingsStore.js / TitleBar.jsx) necesita DOS assets subidos a mano en
// Rich Presence → Art Assets, uno por cada key de acá abajo: el rojo ya
// estaba subido como 'launcher_icon' (logo-mark.png); falta subir
// logo-mark-purple.png con el key 'launcher_icon_purple' para que la
// Rich Presence siga al logo cuando alguien elige el acento morado.
const LAUNCHER_ICON_KEY = { red: 'launcher_icon', purple: 'launcher_icon_purple' };

// Botón "Unirse al Discord" que aparece en la Rich Presence (tanto en modo
// idle como jugando). El RPC local de Discord soporta hasta 2 botones por
// actividad, cada uno como { label, url }; un solo botón alcanza acá.
const DISCORD_INVITE_URL = 'https://discord.gg/nz7nARPWEC';
const DISCORD_BUTTON = [{ label: 'Unirse al Discord', url: DISCORD_INVITE_URL }];

const RECONNECT_INTERVAL_MS = 15000;

let client = null;
let enabled = false;
let connected = false;
let reconnectTimer = null;
let launcherStartedAt = new Date();
let currentPresence = { type: 'idle' };
// Server al que está conectado dentro de la partida en curso (si hay
// alguna). Se guarda aparte de currentPresence porque llega por un camino
// distinto y en otro momento: currentPresence.type pasa a 'playing' apenas
// arranca el proceso de Java (game:launch, ver main.js), mientras que el
// server recién se sabe un rato después — cuando llega directConnect, o
// cuando el log del propio juego confirma la conexión (ver
// CONNECTING_TO_RE en core/launcher.js) — y puede cambiar más de una vez
// en la misma partida si el jugador va de un server a otro desde el menú
// Multijugador sin cerrar Minecraft.
let currentServer = null;
// Color de acento elegido en Ajustes > Apariencia (ver settingsStore.js /
// App.jsx): decide cuál de los dos assets de LAUNCHER_ICON_KEY se manda
// como ícono, para que el logo de la Rich Presence combine con el que se
// ve adentro del launcher. 'red' por defecto, mismo default que
// settingsStore.
let accentColor = 'red';

function launcherIconKey() {
  return LAUNCHER_ICON_KEY[accentColor] || LAUNCHER_ICON_KEY.red;
}

// ---------- Ícono del server en la Rich Presence ----------
//
// Intento anterior (v15): pingear el server nosotros mismos y servir su
// favicon desde un mini servidor HTTP propio en 127.0.0.1, pasándole esa
// URL a Discord. Se veía roto en la práctica: Discord no le pide la
// imagen al PROPIO programa que llama setActivity, se la pide desde su
// infraestructura (un proxy de imágenes) para poder mostrarla también en
// el perfil de cualquier amigo que lo mire — y esa infraestructura nunca
// puede llegar a un 127.0.0.1 de la PC de otra persona. Por más que
// funcionara del lado de quien está jugando, el resultado visible siempre
// iba a ser el ícono roto (confirmado: es lo que se termina viendo).
//
// La imagen SÍ tiene que ser una URL pública de verdad. Como Hard
// Launcher no tiene ningún servidor propio en internet para alojar el
// favicon que sacamos con nuestro propio ping (ver core/serverPing.js),
// se arma la URL contra mcsrvstat.us — un servicio público (sin API key,
// sin límite práctico) que hace exactamente esto: dado un host[:puerto],
// devuelve el ícono actual de ESE server como PNG, pingeándolo ellos
// mismos del otro lado. Si el server no tiene ícono propio (o está caído)
// devuelve un ícono de relleno genérico en vez de romperse — mejor eso
// que nada.
function serverIconUrl(host, port) {
  const address = port && port !== 25565 ? `${host}:${port}` : host;
  return `https://api.mcsrvstat.us/icon/${encodeURIComponent(address)}`;
}

function buildActivity() {
  if (currentPresence.type === 'playing') {
    const { instanceName, mcVersion, startedAt, accountName, faceUrl } = currentPresence;
    const largeText = mcVersion ? `Hard Launcher · Minecraft ${mcVersion}` : 'Hard Launcher';

    // Conectado a un server puntual: la Rich Presence deja de mostrar
    // instancia/versión/cara y pasa a mostrar SOLO la IP (mismo formato
    // que ipLabel() en MinecraftServerList.jsx: host, o host:puerto si el
    // puerto no es el 25565 default) con el logo del launcher de imagen
    // grande y el ícono del propio server como insignia chica al lado
    // (ver serverIconUrl más arriba).
    if (currentServer) {
      const ipLabel = currentServer.port && currentServer.port !== 25565
        ? `${currentServer.host}:${currentServer.port}`
        : currentServer.host;
      return {
        details: ipLabel,
        startTimestamp: startedAt,
        largeImageKey: launcherIconKey(),
        largeImageText: largeText,
        smallImageKey: serverIconUrl(currentServer.host, currentServer.port),
        smallImageText: currentServer.motd || ipLabel,
        buttons: DISCORD_BUTTON,
      };
    }

    const state = mcVersion ? `Minecraft ${mcVersion}` : undefined;
    const activity = {
      details: `Jugando ${instanceName}`,
      state,
      startTimestamp: startedAt,
    };
    // El logo del launcher va SIEMPRE de imagen grande (mismo criterio que
    // la rama de arriba, conectado a un server: largeImageKey siempre es
    // launcherIconKey()) — es lo que identifica de un vistazo que se está
    // jugando a través de Hard Launcher. La cara del jugador, cuando hay
    // una (faceUrl), va de insignia CHICA superpuesta, como cualquier
    // "party"/estado de Discord con avatar.
    //
    // BUG FIX: antes esto estaba al revés (cara de imagen grande, logo de
    // chica) — quedaba el PNG de la skin ocupando el cuadro grande de la
    // Rich Presence y el logo como insignia diminuta, invirtiendo lo que
    // se ve en cualquier otro juego con Discord (el logo del juego/launcher
    // manda, el avatar del jugador acompaña).
    activity.largeImageKey = launcherIconKey();
    activity.largeImageText = largeText;
    if (faceUrl) {
      activity.smallImageKey = faceUrl;
      activity.smallImageText = accountName || largeText;
    }
    activity.buttons = DISCORD_BUTTON;
    return activity;
  }
  return {
    details: 'En el launcher',
    startTimestamp: launcherStartedAt,
    largeImageKey: launcherIconKey(),
    largeImageText: 'Hard Launcher',
    buttons: DISCORD_BUTTON,
  };
}

async function pushActivity() {
  if (!client || !connected) return;
  try {
    await client.user?.setActivity(buildActivity());
  } catch {
    // Si falla el set (ej. Discord se cerró justo en este instante), se
    // deja que el próximo 'close' del socket dispare la reconexión normal
    // en vez de tratar esto como un error a reportar.
  }
}

function scheduleReconnect() {
  if (reconnectTimer || !enabled) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectClient();
  }, RECONNECT_INTERVAL_MS);
}

function connectClient() {
  if (!enabled || connected) return;

  client = new Client({ clientId: CLIENT_ID });

  client.on('ready', () => {
    connected = true;
    pushActivity();
  });

  // Se dispara tanto si Discord no estaba abierto al intentar conectar como
  // si se cierra mientras ya estábamos conectados — en ambos casos el mismo
  // reintento periódico sirve para recuperarse solo.
  client.on('disconnected', () => {
    connected = false;
    client = null;
    scheduleReconnect();
  });

  client.login().catch(() => {
    connected = false;
    client = null;
    scheduleReconnect();
  });
}

function disconnectClient() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  connected = false;
  if (client) {
    client.destroy().catch(() => {});
    client = null;
  }
}

/**
 * Se llama una sola vez al arrancar la app (ver electron/main.js). Si el
 * ajuste "Discord Rich Presence" está desactivado, no hace nada — ni
 * siquiera intenta el primer connect().
 */
function init(initiallyEnabled, initialAccentColor) {
  launcherStartedAt = new Date();
  if (initialAccentColor) accentColor = initialAccentColor;
  setEnabled(initiallyEnabled);
}

/**
 * Se llama cuando el jugador cambia el color de acento en Ajustes >
 * Apariencia (ver ipcMain.handle('settings:update') en main.js), para que
 * el ícono de la Rich Presence en curso cambie de una sin necesitar
 * reconectar ni reiniciar el launcher.
 */
function setAccentColor(value) {
  if (accentColor === value) return;
  accentColor = value;
  pushActivity();
}

/** Prende/apaga en caliente, para cuando el jugador toca el toggle en Ajustes. */
function setEnabled(value) {
  if (enabled === value) return;
  enabled = value;
  if (enabled) connectClient();
  else disconnectClient();
}

/**
 * Instancia en marcha (ver 'game:launch' en main.js).
 * `account` es opcional: { username, faceUrl } — si se pasa, su cara
 * aparece como imagen chica de la Rich Presence (ver buildActivity). Se
 * pasa por separado de instanceName/mcVersion, que ya se usaban antes,
 * para no romper otros llamados existentes a esta función.
 */
function setPlaying(instanceName, mcVersion, account = null) {
  currentServer = null;
  currentPresence = {
    type: 'playing',
    instanceName,
    mcVersion,
    startedAt: new Date(),
    accountName: account?.username || null,
    faceUrl: account?.faceUrl || null,
  };
  pushActivity();
}

/**
 * El juego confirmó conexión a un server (directConnect inmediato, o el
 * log de Minecraft detectando que el jugador entró a uno a mano — ver
 * CONNECTING_TO_RE en core/launcher.js). `motd` es opcional: si ya se tiene
 * a mano el nombre lindo del server (ej. el de la lista de "Servidores
 * recomendados" de Inicio) se usa como tooltip de la insignia chica.
 */
function setServer(host, port, motd) {
  if (currentPresence.type !== 'playing') return;
  currentServer = { host, port, motd: motd || null };
  pushActivity();
}

/**
 * El jugador se desconectó del server (botón "Disconnect"/"Save and quit
 * to title", caída de conexión, kick, etc. — ver DISCONNECTED_RE en
 * core/launcher.js) sin unirse a otro ni cerrar el juego. A diferencia de
 * setIdle(), esto NO apaga la Rich Presence: el jugador sigue con la
 * instancia abierta, así que se vuelve a mostrar "Jugando <instancia>"
 * (mismo estado que justo después de setPlaying, antes de que hubiera
 * server) en vez de quedarse pegado al último server al que se conectó.
 */
function clearServer() {
  if (currentPresence.type !== 'playing' || !currentServer) return;
  currentServer = null;
  pushActivity();
}

/** El proceso del juego terminó (ver 'onExit' de launcher.launch en main.js). */
function setIdle() {
  currentPresence = { type: 'idle' };
  currentServer = null;
  pushActivity();
}

module.exports = { init, setEnabled, setAccentColor, setPlaying, setServer, clearServer, setIdle };
