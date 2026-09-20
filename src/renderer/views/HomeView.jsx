import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT, formatPlaytimeShort } from '../i18n.js';
import MinecraftServerList, { SignalBars } from '../components/MinecraftServerList.jsx';
import InstanceIcon from '../components/InstanceIcon.jsx';
import Icon from '../components/Icon.jsx';
import CreateInstanceModal from '../components/CreateInstanceModal.jsx';
import InstanceOptionsMenu from '../components/InstanceOptionsMenu.jsx';
import skinPreview from '../assets/skin-preview.png';
import logoMarkRed from '../assets/logo-mark.png';
import logoMarkPurple from '../assets/logo-mark-purple.png';

// Entrada escalonada tipo Solaris: el contenedor le pasa un pequeño delay
// creciente a cada hijo (staggerChildren) en vez de que todo aparezca de
// golpe. Se reutiliza para la lista de "continuar donde quedaste" y para
// la grilla de modpacks destacados.
const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};
const staggerItem = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
};

export default function HomeView() {
  const { instances, activeAccount, refreshInstances, pushToast } = useAppStore();
  const t = useT();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  // Easter egg: 5 clicks SEGUIDOS (ver skinClickTimer más abajo, se resetea
  // el contador si pasa demasiado tiempo entre uno y el siguiente) sobre el
  // sprite de la skin cambian el mensajito de "chat" de al lado para
  // siempre por uno bien distinto, en vez del texto fijo de siempre. A
  // propósito el cursor NO cambia a "pointer" sobre la imagen (ver el
  // <img> más abajo): que sea clickeable es algo para descubrir de casualidad,
  // no una interacción visible como cualquier otro botón de la pantalla.
  const [skinClickCount, setSkinClickCount] = useState(0);
  const [skinEasterEgg, setSkinEasterEgg] = useState(false);
  const skinClickTimer = useRef(null);

  function handleSkinWidgetClick() {
    if (skinEasterEgg) return; // ya está activado, no hace falta seguir contando
    clearTimeout(skinClickTimer.current);
    setSkinClickCount((prev) => {
      const next = prev + 1;
      if (next >= 5) {
        setSkinEasterEgg(true);
        return 0;
      }
      return next;
    });
    // Si pasa más de un segundo sin el siguiente click, se corta la racha
    // y hay que arrancar de nuevo desde 1 — así "5 veces seguidas" significa
    // realmente seguidas, y no 5 clicks sueltos repartidos en cualquier
    // momento de la sesión.
    skinClickTimer.current = setTimeout(() => setSkinClickCount(0), 1000);
  }
  // Solo se usa para el path de la carpeta de instancias (acceso rápido
  // "Abrir carpeta" más abajo) — ya no se muestra ningún total en bytes.
  const [storage, setStorage] = useState(null);
  // null mientras no se sabe nada todavía (o si el launcher no tiene
  // configurado el contador, ver onlinePresenceConfig.js) — en ese caso el
  // badge directamente no se muestra, en vez de mostrar "0" y sugerir que
  // no hay nadie jugando.
  const [onlinePlayers, setOnlinePlayers] = useState(null);
  // "Tu ping" del badge de abajo (ver src/core/onlinePresence.js): la
  // latencia de este launcher contra el mismo servicio que alimenta el
  // contador de arriba — no el ping a ningún server de Minecraft. Mismo
  // null-mientras-no-se-sabe que onlinePlayers, para poder mostrar el
  // spinner de carga de SignalBars (ver MinecraftServerList.jsx) en vez de
  // barras vacías apenas monta el componente.
  const [onlinePing, setOnlinePing] = useState(null);
  // Mismo isotipo (sin fondo) y mismo criterio de acento que TitleBar.jsx:
  // el "server" del badge de en línea es el launcher mismo, así que tiene
  // sentido que combine con el color elegido en Ajustes > Apariencia en
  // vez de quedar siempre rojo.
  const accentColor = useAppStore((s) => s.settings?.accentColor);
  const logoMark = accentColor === 'purple' ? logoMarkPurple : logoMarkRed;

  useEffect(() => {
    let cancelled = false;
    window.hardLauncher.storage.info().then((info) => {
      if (!cancelled) setStorage(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.hardLauncher.onlinePlayers.get().then((count) => {
      if (!cancelled) setOnlinePlayers(count);
    });
    const unsubscribe = window.hardLauncher.onlinePlayers.onUpdate((count) => setOnlinePlayers(count));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    window.hardLauncher.onlinePlayers.getPing().then((ms) => {
      if (!cancelled) setOnlinePing(ms);
    });
    const unsubscribe = window.hardLauncher.onlinePlayers.onPingUpdate((ms) => setOnlinePing(ms));
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Solo la última jugada: "continuar donde quedaste" muestra como máximo
  // 1 instancia a la vez (antes eran 2), la más reciente según lastPlayed.
  const recent = [...instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 1);
  const totalPlaytimeMs = instances.reduce((sum, inst) => sum + (inst.totalPlaytime || 0), 0);
  // Instancia con más horas jugadas: se muestra como dato extra dentro de la
  // tarjeta de tiempo jugado (ver home-hero-summary-card más abajo) para
  // aprovechar el espacio que antes quedaba vacío al lado del saludo. Solo
  // cuenta si tiene algo de tiempo jugado; si todas están en 0 no hay
  // "favorita" real que mostrar.
  const favoriteInstance = instances.reduce(
    (best, inst) => ((inst.totalPlaytime || 0) > (best?.totalPlaytime || 0) ? inst : best),
    null
  );

  function handlePlay(instanceId) {
    navigate(`/instances/${instanceId}?autoplay=1`);
  }

  function handleOpenInstancesFolder() {
    if (storage) window.hardLauncher.storage.openFolder(storage.instances.path);
  }

  function handleCheckUpdates() {
    // El resultado (ya tenés la última / descargando / error) lo muestra
    // solo <UpdateToast/>, montado siempre en App.jsx — no hace falta
    // esperar la respuesta ni manejar nada acá.
    window.hardLauncher.updater.check();
  }

  return (
    <div className="home-layout">
      <div>
        <motion.div
          className="home-hero"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="home-hero-content">
            <h1 className="home-hero-title">
              {activeAccount ? t('home.welcomeNamed', { name: activeAccount.username }) : t('home.welcome')}
            </h1>
            <p className="home-hero-subtitle">
              {activeAccount
                ? t('home.connected', {
                    name: activeAccount.username,
                    type: activeAccount.type === 'premium' ? t('account.premium') : t('account.offline'),
                  })
                : t('home.noAccount')}
            </p>
            <div className="home-hero-actions">
              <motion.button
                className="btn-primary btn-icon-label"
                onClick={() => setShowCreate(true)}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                <Icon name="plus" size={15} />
                {t('home.createInstance')}
              </motion.button>
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} style={{ display: 'inline-block' }}>
                <Link to="/explore" className="btn-secondary btn-icon-label">
                  <Icon name="compass" size={15} />
                  {t('home.exploreMods')}
                </Link>
              </motion.div>
            </div>
          </div>
          <motion.div
            className="home-hero-summary"
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            <motion.div className="home-hero-summary-card" variants={staggerItem}>
              <div className="home-hero-summary-top">
                <span className="home-hero-summary-icon">
                  <Icon name="clock" size={17} />
                </span>
                <div className="home-hero-summary-top-text">
                  <div className="home-hero-stat-value">{formatPlaytimeShort(totalPlaytimeMs, t.lang)}</div>
                  <div className="home-hero-stat-label">{t('home.playtime')}</div>
                </div>
              </div>
              {instances.length > 0 && (
                <>
                  <div className="home-hero-summary-divider" />
                  <div className="home-hero-summary-details">
                    <span className="home-hero-summary-detail">
                      <Icon name="layers" size={12} />
                      {instances.length} {t('home.stats.instances')}
                    </span>
                    {favoriteInstance && (favoriteInstance.totalPlaytime || 0) > 0 && (
                      <span className="home-hero-summary-detail" title={favoriteInstance.name}>
                        <Icon name="flame" size={12} />
                        {t('home.favorite')}: {favoriteInstance.name}
                      </span>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
          <div className="home-hero-stats">
            <motion.div
              className="mc-server-row home-hero-online-server"
              variants={staggerItem}
              initial="hidden"
              animate="show"
            >
              <div className="mc-server-icon home-hero-online-server-icon">
                <img src={logoMark} alt="" />
              </div>
              <div className="mc-server-info">
                {/* Texto único y corto ("En línea" en vez de "Jugadores en
                    línea"/"Hard Launcher" en dos líneas): el logo de al
                    lado ya deja claro de qué badge se trata, así que no
                    hace falta repetir el nombre del launcher en texto. */}
                <div className="mc-server-name">{t('home.stats.online')}</div>
              </div>
              <div className="mc-server-meta">
                <span className="mc-server-players">
                  {onlinePlayers === null ? '—' : onlinePlayers}
                  <Icon name="user" size={13} />
                </span>
                {/* showTitle=false: acá no queremos el tooltip con el ping
                    en ms que sí tiene sentido en la lista de Multijugador
                    (ver MinecraftServerList.jsx) — este badge no representa
                    el ping a ningún server real, sino la latencia contra el
                    servicio de presencia, así que mostrarlo en un tooltip
                    solo genera una pregunta ("77 ms ¿de qué?") sin utilidad. */}
                <SignalBars
                  ping={onlinePing}
                  loading={onlinePlayers === null && onlinePing === null}
                  showTitle={false}
                />
              </div>
            </motion.div>
            <div className="home-hero-skin-widget">
              <img
                className="home-hero-skin-widget-img"
                src={skinPreview}
                alt="Skin de Minecraft"
                onClick={handleSkinWidgetClick}
              />
              <span className="home-hero-skin-chat">
                {skinEasterEgg ? (
                  <>
                    <span className="home-hero-skin-chat-name">NoSoyHard</span>: I love you Milagros{' '}
                    <Icon
                      name="heart"
                      size={11}
                      style={{ display: 'inline', verticalAlign: -1, color: '#ff6b81', fill: 'currentColor' }}
                    />
                  </>
                ) : (
                  <>
                    <span className="home-hero-skin-chat-name">NoSoyHard</span>: Blox Fruits trash.
                  </>
                )}
              </span>
            </div>
          </div>
        </motion.div>

        <div className="home-quick-actions">
          <button type="button" className="home-quick-action" onClick={handleOpenInstancesFolder} disabled={!storage}>
            <Icon name="folder" size={15} />
            {t('home.openInstancesFolder')}
          </button>
          <button type="button" className="home-quick-action" onClick={handleCheckUpdates}>
            <Icon name="refresh" size={15} />
            {t('home.checkUpdates')}
          </button>
        </div>

        <div className="section-heading">
          <Icon name="layers" size={16} />
          <h3>{t('home.continue')}</h3>
        </div>
        {recent.length === 0 && (
          <p style={{ color: 'var(--text-muted)', marginBottom: 18 }}>
            {t('home.emptyInstances')}{' '}
            <button className="link-btn" onClick={() => setShowCreate(true)}>
              {t('home.createFirst')}
            </button>
            .
          </p>
        )}
        {recent.length > 0 && (
          <motion.div
            style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}
            variants={staggerContainer}
            initial="hidden"
            animate="show"
          >
            {recent.map((inst) => (
              <motion.div
                key={inst.id}
                className="card jump-back-row"
                variants={staggerItem}
                whileHover={{ y: -2, transition: { duration: 0.15 } }}
              >
                <Link to={`/instances/${inst.id}`} className="jump-back-icon">
                  <InstanceIcon name={inst.name} loader={inst.loader} icon={inst.icon} size={44} />
                </Link>
                <Link to={`/instances/${inst.id}`} style={{ color: 'inherit', textDecoration: 'none', flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{inst.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {inst.lastPlayed
                      ? t('home.playedOn', { date: new Date(inst.lastPlayed).toLocaleDateString(t.dateLocale) })
                      : t('home.neverPlayed')}{' '}
                    · {inst.mcVersion} · {inst.loader}
                  </div>
                </Link>
                <motion.button
                  className="btn-primary btn-icon-label"
                  onClick={() => handlePlay(inst.id)}
                  whileHover={{ scale: 1.04 }}
                  whileTap={{ scale: 0.96 }}
                >
                  <Icon name="play" size={15} />
                  {t('common.play')}
                </motion.button>
                <InstanceOptionsMenu instance={inst} onDeleted={refreshInstances} pushToast={pushToast} inline />
              </motion.div>
            ))}
          </motion.div>
        )}

        <div className="section-heading">
          <Icon name="globe" size={16} />
          <h3>{t('servers.title')}</h3>
        </div>
        <MinecraftServerList />
      </div>

      <AnimatePresence>
        {showCreate && (
          <CreateInstanceModal
            onClose={() => setShowCreate(false)}
            onCreated={(newId) => {
              setShowCreate(false);
              refreshInstances();
              if (newId) navigate(`/instances/${newId}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
