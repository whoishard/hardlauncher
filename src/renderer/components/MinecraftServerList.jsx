import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import Icon from './Icon.jsx';
import InstanceIcon from './InstanceIcon.jsx';
import MinecraftMotd from './MinecraftMotd.jsx';

// Sección de Inicio que reemplaza a "Descubre un modpack": la lista de
// servidores recomendados (ver src/store/serverListStore.js), pintada para
// que se sienta igual a la pantalla de Multijugador del juego real —
// mismo tipo de fila (ícono cuadrado + nombre + MOTD a la izquierda, barras
// de señal + jugadores a la derecha), misma fuente ("Minecraft"), y un
// botón para lanzar el juego y entrar directo a ese server, sin pasar por
// el menú principal.
//
// A propósito es de solo lectura: la lista en sí viene fija del código
// (ver el comentario en serverListStore.js), no hay forma de agregar o
// sacar un servidor desde acá.
const REFRESH_INTERVAL_MS = 30000;

// Umbrales calcados de los que usa el juego real para las barras de señal
// de la lista de Multijugador (5 barras = excelente, va bajando con el
// ping; rojo/1 barra cuando está muy alto).
//
// Exportadas (junto con SignalBars, más abajo) para que HomeView.jsx pueda
// pintar el badge de "jugadores en línea" con el mismo look exacto que
// estas filas de servidor, en vez de reinventar su propia versión.
export function pingBars(ms) {
  if (ms == null) return 0;
  if (ms < 150) return 5;
  if (ms < 300) return 4;
  if (ms < 600) return 3;
  if (ms < 1000) return 2;
  return 1;
}
export function pingColor(bars) {
  if (bars >= 4) return '#55FF55'; // verde clásico de Minecraft
  if (bars >= 2) return '#FFAA00'; // amarillo/naranja
  return '#FF5555'; // rojo
}

export function SignalBars({ ping, loading, showTitle = true }) {
  if (loading) return <span className="mc-server-signal mc-server-signal-loading" title={showTitle ? '…' : ''} />;
  const bars = pingBars(ping);
  const color = ping == null ? '#7a7a7a' : pingColor(bars);
  return (
    <div className="mc-server-signal" title={showTitle && ping != null ? `${ping} ms` : ''}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className="mc-server-signal-bar"
          style={{
            height: `${i * 3 + 3}px`,
            background: i <= bars ? color : 'rgba(255,255,255,0.15)',
          }}
        />
      ))}
    </div>
  );
}

// Menú chiquito para elegir a qué instancia unirse cuando hay más de una —
// reutiliza el mismo look que el menú de opciones de una instancia
// (.instance-card-menu) para no inventar un tercer estilo de dropdown.
function InstancePickerMenu({ instances, onPick, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [onClose]);

  return (
    <div className="instance-card-menu mc-server-instance-picker" ref={ref}>
      {instances.map((inst) => (
        <button
          key={inst.id}
          type="button"
          className="instance-card-menu-item"
          onClick={() => onPick(inst.id)}
        >
          <InstanceIcon name={inst.name} loader={inst.loader} icon={inst.icon} size={20} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inst.name}</span>
        </button>
      ))}
    </div>
  );
}

export default function MinecraftServerList() {
  const t = useT();
  const navigate = useNavigate();
  const { instances, pushToast, runningInstance } = useAppStore();
  const [servers, setServers] = useState([]);
  const [status, setStatus] = useState({}); // id -> resultado de recommendedServers.ping
  const [loadingIds, setLoadingIds] = useState(() => new Set());
  const [pickerFor, setPickerFor] = useState(null); // id del server cuyo InstancePickerMenu está abierto
  const [copiedId, setCopiedId] = useState(null); // id del server cuya IP se acaba de copiar (para el ícono de check momentáneo)

  const pingOne = useCallback(async (server) => {
    setLoadingIds((prev) => new Set(prev).add(server.id));
    try {
      const result = await window.hardLauncher.recommendedServers.ping(server.host, server.port);
      setStatus((prev) => ({ ...prev, [server.id]: result }));
    } finally {
      setLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(server.id);
        return next;
      });
    }
  }, []);

  const refreshAll = useCallback(async () => {
    const list = await window.hardLauncher.recommendedServers.list();
    setServers(list);
    list.forEach(pingOne);
  }, [pingOne]);

  useEffect(() => {
    refreshAll();
    const interval = setInterval(refreshAll, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [refreshAll]);

  // Lanza el juego y entra directo al servidor (Quick Play Multiplayer / el
  // respaldo --server-port en versiones viejas, ver core/launcher.js). Si
  // hay una sola instancia se usa esa de una; con varias, primero se
  // pregunta a cuál unirse; sin ninguna, se manda a crear una.
  //
  // Minecraft no tiene forma de pedirle a un proceso ya abierto que se
  // conecte a otro servidor (no existe un canal para "mandarle" un comando
  // a un cliente en vivo) — así que si la instancia elegida es OTRA
  // distinta a la que ya está corriendo, no se puede lanzar un segundo
  // proceso mientras la carpeta de la primera siga bloqueada: se avisa y no
  // se navega a nada.
  //
  // Si en cambio es la MISMA instancia la que ya está corriendo, sí se
  // puede "entrar" al servidor: se navega igual con los parámetros de
  // autoplay/join, y es InstanceDetailView (ver handleLaunch de ahí) el que
  // se encarga de reiniciar esa instancia (cerrar el proceso viejo y
  // volver a lanzarla ya conectada) en vez de abrir una segunda.
  function joinWithInstance(server, instanceId) {
    setPickerFor(null);
    if (runningInstance && runningInstance.id !== instanceId) {
      pushToast(t('servers.anotherRunning', { name: runningInstance.name }), 'error');
      return;
    }
    navigate(
      `/instances/${instanceId}?autoplay=1&joinHost=${encodeURIComponent(server.host)}&joinPort=${server.port}` +
        `&joinName=${encodeURIComponent(server.name)}`
    );
  }

  function handlePlayClick(server) {
    if (instances.length === 0) {
      pushToast(t('servers.needInstance'), 'error');
      return;
    }
    if (instances.length === 1) {
      joinWithInstance(server, instances[0].id);
      return;
    }
    setPickerFor((prev) => (prev === server.id ? null : server.id));
  }

  // Devuelve el string de conexión tal como lo escribiría un jugador en
  // "Agregar servidor" del juego: sin puerto cuando es el default (25565),
  // mismo criterio que usa nbtWriter.js al armar el servers.dat. Si el
  // server define displayHost (ver serverListStore.js), esa dirección
  // "linda" es la que se muestra y se copia — el host/port real (numérico)
  // sigue siendo el que se usa para pingear y para conectar de verdad.
  function ipLabel(server) {
    if (server.displayHost) return server.displayHost;
    return server.port && server.port !== 25565 ? `${server.host}:${server.port}` : server.host;
  }

  // Copia la IP al portapapeles — reemplaza al viejo botón "Agregar a todas
  // las instancias" (que escribía el server directo en el servers.dat de
  // cada instancia). Copiar la IP es más simple y no depende de tener
  // ninguna instancia creada todavía.
  async function handleCopyIp(server) {
    try {
      await navigator.clipboard.writeText(ipLabel(server));
      setCopiedId(server.id);
      setTimeout(() => setCopiedId((prev) => (prev === server.id ? null : prev)), 1500);
    } catch (e) {
      pushToast(t('servers.copyIpError'), 'error');
    }
  }

  if (servers.length === 0) return null; // nada configurado todavía: no ocupar espacio con un placeholder

  return (
    <div className="mc-server-list">
      <AnimatePresence initial={false}>
        {servers.map((server) => {
          const s = status[server.id];
          const loading = loadingIds.has(server.id);
          return (
            <motion.div
              key={server.id}
              className="mc-server-row"
              layout
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
            >
              <div className="mc-server-icon">
                {s?.favicon ? <img src={s.favicon} alt="" /> : <Icon name="globe" size={26} />}
                <span
                  className={
                    'mc-server-status-dot' + (loading ? ' loading' : s?.online ? ' online' : ' offline')
                  }
                />
              </div>

              <div className="mc-server-info">
                <div className="mc-server-name">{server.name}</div>
                <div className="mc-server-motd">
                  {s?.online && s.motd?.length > 0 ? (
                    <MinecraftMotd segments={s.motd} />
                  ) : s && !s.online && !loading ? (
                    <span className="mc-server-motd-fallback">{t('servers.offline')}</span>
                  ) : (
                    <span className="mc-server-motd-fallback">{ipLabel(server)}</span>
                  )}
                </div>
              </div>

              <div className="mc-server-meta">
                {s?.online && (
                  <span className="mc-server-players">
                    {s.players.online}/{s.players.max}
                    <Icon name="user" size={13} />
                  </span>
                )}
                <SignalBars ping={s?.online ? s.ping : null} loading={loading} />
              </div>

              <div className="mc-server-actions">
                <div className="mc-server-ip">
                  <button
                    type="button"
                    className={'mc-server-ip-text' + (copiedId === server.id ? ' copied' : '')}
                    onClick={() => handleCopyIp(server)}
                    title={t('servers.copyIp')}
                  >
                    {ipLabel(server)}
                  </button>
                  <button
                    type="button"
                    className={'mc-server-ip-copy' + (copiedId === server.id ? ' copied' : '')}
                    onClick={() => handleCopyIp(server)}
                    title={t('servers.copyIp')}
                  >
                    <Icon name={copiedId === server.id ? 'check' : 'copy'} size={13} />
                  </button>
                </div>
                <motion.button
                  type="button"
                  className="btn-primary btn-icon-label mc-server-play-btn"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handlePlayClick(server)}
                >
                  <Icon name="play" size={17} />
                  {t('servers.play')}
                </motion.button>
                <AnimatePresence>
                  {pickerFor === server.id && (
                    <InstancePickerMenu
                      instances={instances}
                      onPick={(instanceId) => joinWithInstance(server, instanceId)}
                      onClose={() => setPickerFor(null)}
                    />
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
