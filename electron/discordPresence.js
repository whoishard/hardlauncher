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
const CLIENT_ID = '0000000000000000000';

const RECONNECT_INTERVAL_MS = 15000;

let client = null;
let enabled = false;
let connected = false;
let reconnectTimer = null;
let launcherStartedAt = new Date();
let currentPresence = { type: 'idle' };

function buildActivity() {
  if (currentPresence.type === 'playing') {
    const { instanceName, mcVersion, startedAt } = currentPresence;
    return {
      details: `Jugando ${instanceName}`,
      state: mcVersion ? `Minecraft ${mcVersion}` : undefined,
      startTimestamp: startedAt,
      largeImageKey: 'launcher_icon',
      largeImageText: 'Hard Launcher',
    };
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

/** Instancia en marcha (ver 'game:launch' en main.js). */
function setPlaying(instanceName, mcVersion) {
  currentPresence = { type: 'playing', instanceName, mcVersion, startedAt: new Date() };
  pushActivity();
}

/** El proceso del juego terminó (ver 'onExit' de launcher.launch en main.js). */
function setIdle() {
  currentPresence = { type: 'idle' };
  pushActivity();
}

module.exports = { init, setEnabled, setPlaying, setIdle };
