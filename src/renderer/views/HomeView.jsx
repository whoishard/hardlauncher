import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT, formatPlaytimeShort } from '../i18n.js';
import MinecraftServerList from '../components/MinecraftServerList.jsx';
import InstanceIcon from '../components/InstanceIcon.jsx';
import Icon from '../components/Icon.jsx';
import CreateInstanceModal from '../components/CreateInstanceModal.jsx';
import InstanceOptionsMenu from '../components/InstanceOptionsMenu.jsx';
import skinPreview from '../assets/skin-preview.png';

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
  // Solo se usa para el path de la carpeta de instancias (acceso rápido
  // "Abrir carpeta" más abajo) — ya no se muestra ningún total en bytes.
  const [storage, setStorage] = useState(null);
  // null mientras no se sabe nada todavía (o si el launcher no tiene
  // configurado el contador, ver onlinePresenceConfig.js) — en ese caso el
  // badge directamente no se muestra, en vez de mostrar "0" y sugerir que
  // no hay nadie jugando.
  const [onlinePlayers, setOnlinePlayers] = useState(null);

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

  const recent = [...instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 2);
  const totalPlaytimeMs = instances.reduce((sum, inst) => sum + (inst.totalPlaytime || 0), 0);

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
            <motion.div className="home-hero-stat" variants={staggerItem}>
              <div className="home-hero-stat-value">{instances.length}</div>
              <div className="home-hero-stat-label">{t('home.stats.instances')}</div>
            </motion.div>
            <div className="home-hero-stat-divider" />
            <motion.div className="home-hero-stat" variants={staggerItem}>
              <div className="home-hero-stat-value">{formatPlaytimeShort(totalPlaytimeMs, t.lang)}</div>
              <div className="home-hero-stat-label">{t('home.playtime')}</div>
            </motion.div>
            <div className="home-hero-stat-divider" />
            <motion.div className="home-hero-stat home-hero-stat-online" variants={staggerItem}>
              <div className="home-hero-stat-value">
                <span className="home-hero-stat-online-dot" />
                {onlinePlayers === null ? '—' : onlinePlayers}
              </div>
              <div className="home-hero-stat-label">{t('home.stats.online')}</div>
            </motion.div>
          </motion.div>
          <div className="home-hero-stats">
            <div className="home-hero-skin-widget">
              <img className="home-hero-skin-widget-img" src={skinPreview} alt="Skin de Minecraft" />
              <span className="home-hero-skin-chat">
                <span className="home-hero-skin-chat-name">NoSoyHard</span>: GTA 6 peak.
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
