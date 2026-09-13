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

function buildActivity() {
  if (currentPresence.type === 'playing') {
    const { instanceName, mcVersion, startedAt, accountName, faceUrl } = currentPresence;
    const activity = {
      details: `Jugando ${instanceName}`,
      state: currentServer
        ? `En ${currentServer.host}${currentServer.motd ? ` · ${currentServer.motd}` : ''}`
        : mcVersion
        ? `Minecraft ${mcVersion}`
        : undefined,
      startTimestamp: startedAt,
      largeImageKey: 'launcher_icon',
      largeImageText: mcVersion ? `Hard Launcher · Minecraft ${mcVersion}` : 'Hard Launcher',
    };
    // La carita de la skin va como imagen CHICA (superpuesta sobre la
    // grande, como el ícono de un juego sobre el avatar). Discord acepta
    // una URL http(s) directa acá en vez de un asset subido de antemano
    // (ver docs de Rich Presence / SET_ACTIVITY), así que sirve pasarle
    // tal cual la misma URL de Crafatar que ya usa el resto del launcher
    // para la cara de esta cuenta (ver accountFaceUrl en main.js) — no
    // hace falta subir nada al Developer Portal.
    if (faceUrl) {
      activity.smallImageKey = faceUrl;
      activity.smallImageText = accountName || 'Jugando';
    }
    return activity;
  }
  return {
    details: 'En el launcher',
    startTimestamp: launcherStartedAt,
    largeImageKey: 'launcher_icon',
    largeImageText: 'Hard Launcher',
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
function init(initiallyEnabled) {
  launcherStartedAt = new Date();
  setEnabled(initiallyEnabled);
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
 * recomendados" de Inicio) se muestra en vez del host pelado.
 */
function setServer(host, port, motd) {
  if (currentPresence.type !== 'playing') return;
  currentServer = { host, port, motd: motd || null };
  pushActivity();
}

/** El proceso del juego terminó (ver 'onExit' de launcher.launch en main.js). */
function setIdle() {
  currentPresence = { type: 'idle' };
  currentServer = null;
  pushActivity();
}

module.exports = { init, setEnabled, setPlaying, setServer, setIdle };
