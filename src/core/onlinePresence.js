const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const { SUPABASE_URL, SUPABASE_ANON_KEY, PRESENCE_CHANNEL } = require('../shared/onlinePresenceConfig');

/**
 * Contador global de "jugadores en línea" (launchers abiertos ahora
 * mismo, en cualquier PC), usando Supabase Realtime Presence.
 *
 * Cómo funciona, en criollo: cada launcher abierto se conecta a un mismo
 * "canal" (un websocket administrado por Supabase, sin tocar ninguna
 * tabla ni base de datos) y avisa "acá estoy" con track(). Supabase le
 * manda a TODOS los conectados la lista completa de quién sigue ahí cada
 * vez que alguien entra o sale (evento 'sync') — nosotros solo contamos
 * cuántas claves tiene esa lista. Si el launcher se cierra (o se cae, o
 * se corta internet), Supabase nota el socket muerto y lo saca solo de la
 * lista sin que nadie tenga que avisar nada: no hace falta un servidor
 * propio ni un cronjob limpiando entradas viejas.
 *
 * No se guarda ni se manda nada identificable de la persona ni de la
 * cuenta de Minecraft — el "key" de presence es un uuid al voleo que dura
 * lo que dura el proceso, no un id de cuenta.
 */

let client = null;
let channel = null;
let onChangeCallback = null;
let currentCount = 0;

function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

function getCount() {
  return currentCount;
}

function emitCount(count) {
  currentCount = count;
  if (onChangeCallback) onChangeCallback(count);
}

/**
 * Arranca la conexión y empieza a reportar "este launcher está abierto".
 * onCountChange se llama con el total actualizado cada vez que cambia
 * (no hay que llamar a start() más de una vez por proceso).
 *
 * Si onlinePresenceConfig.js todavía no tiene credenciales cargadas, no
 * hace nada — ni tira error ni deja nada a medio conectar. Así el
 * launcher anda igual de bien para cualquiera que compile el proyecto
 * sin haberse armado su propio backend de Supabase todavía.
 */
function start(onCountChange) {
  onChangeCallback = onCountChange;
  if (!isConfigured()) return;

  try {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      // Electron 30 trae un Node más viejo que el que ya incluye
      // WebSocket global (Node 22+); en versiones anteriores hay que
      // pasarle explícitamente el transporte de la librería 'ws'.
      realtime: { transport: WebSocket },
    });

    channel = client.channel(PRESENCE_CHANNEL, {
      config: { presence: { key: uuidv4() } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        emitCount(Object.keys(state).length);
      })
      .subscribe((status) => {
        // "joined_at" es solo para poder mirar el canal a mano desde el
        // dashboard de Supabase si hiciera falta debuggear algo — no lo
        // lee ni lo necesita nadie más.
        if (status === 'SUBSCRIBED') channel.track({ joined_at: Date.now() });
      });
  } catch (err) {
    console.error('No se pudo conectar el contador de jugadores online:', err);
  }
}

/**
 * Corta la conexión de forma prolija: dispara el evento "leave" para
 * todos los demás launchers al instante, en vez de dejar que Supabase
 * recién note el socket muerto por timeout (unos segundos de más
 * contando a alguien que ya cerró el launcher).
 */
function stop() {
  try {
    if (channel && client) {
      channel.untrack();
      client.removeChannel(channel);
    }
  } catch {
    /* la app se está cerrando igual, no hay mucho más para hacer acá */
  }
  channel = null;
  client = null;
}

module.exports = { start, stop, getCount, isConfigured };
