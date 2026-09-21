import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT, formatPlaytimePlayed } from '../i18n.js';
import CreateInstanceModal from '../components/CreateInstanceModal.jsx';
import InstanceIcon, { LOADER_BADGES } from '../components/InstanceIcon.jsx';
import InstanceOptionsMenu from '../components/InstanceOptionsMenu.jsx';
import Icon from '../components/Icon.jsx';

const staggerContainer = {
  hidden: {},
  show: { transition: { staggerChildren: 0.04 } },
};
const staggerItem = {
  hidden: { opacity: 0, y: 14, scale: 0.97 },
  show: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25, ease: [0.16, 1, 0.3, 1] } },
};

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function InstanceCard({ inst, onDeleted, pushToast }) {
  const [sizeBytes, setSizeBytes] = useState(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    window.hardLauncher.instances.getSize(inst.id).then((bytes) => {
      if (!cancelled) setSizeBytes(bytes);
    });
    return () => {
      cancelled = true;
    };
  }, [inst.id]);

  // Color de acento propio del mod loader (mismo mapa que usa la insignia
  // circular del ícono, ver InstanceIcon.jsx) — se reutiliza acá para teñir
  // muy sutilmente el marco detrás del ícono y el borde superior de la
  // tarjeta, así cada instancia se distingue de un vistazo por su loader
  // sin tener que leer el texto chiquito.
  const accent = LOADER_BADGES[inst.loader]?.color || 'var(--accent-primary)';

  return (
    // BUG FIX: antes, TODA la tarjeta (ícono, nombre, stats y el menú de
    // opciones ⋯) era un único <Link>/<a> a "/instances/:id" — incluyendo
    // el propio InstanceOptionsMenu y su modal de "Exportar". Al estar
    // anidado adentro de un enlace, un click en "Exportar" (o "Config.",
    // "Eliminar", etc.) terminaba navegando a la instancia en vez de abrir
    // el modal correspondiente: el stopPropagation() de InstanceOptionsMenu
    // no alcanza a frenar la navegación del <Link>/MotionLink en todos los
    // casos. La solución es sacar el menú de adentro del <Link> del todo:
    // ahora ".instance-card" es el contenedor (posicionado, para que el
    // menú ⋯ absolute siga cayendo en la esquina igual que antes) y el
    // <Link> de navegación es un elemento hermano que solo envuelve el
    // ícono/nombre/stats — el menú de opciones queda afuera de cualquier
    // enlace, así sus clicks nunca navegan.
    <motion.div
      className="card instance-card"
      style={{ '--instance-accent': accent }}
      variants={staggerItem}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
    >
      <InstanceOptionsMenu instance={inst} onDeleted={onDeleted} pushToast={pushToast} />
      <Link
        to={`/instances/${inst.id}`}
        className="instance-card-link"
        // BUG FIX (ver comentario original más abajo, se mantiene igual):
        // al hacer click y mover apenas el mouse antes de soltar, el
        // navegador interpretaba esto como el inicio de un drag-and-drop
        // nativo de enlace — mostraba el "fantasma" gris con el título y
        // la URL completa de la instancia pegado al cursor. Se desactiva
        // el drag nativo del todo en vez de dejar que el navegador lo
        // ofrezca.
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
      >
        <div className="instance-card-icon-frame">
          <InstanceIcon name={inst.name} loader={inst.loader} icon={inst.icon} size={64} />
        </div>
        <div className="instance-card-name">{inst.name}</div>
        <span className="badge badge-sm instance-card-version">
          {inst.mcVersion} · {inst.loader}
        </span>

        <div className="instance-card-stats">
          <span className="instance-card-stat" title={t('instances.playtime')}>
            <Icon name="clock" size={12} />
            {formatPlaytimePlayed(inst.totalPlaytime, t.lang)}
          </span>
          <span className="instance-card-stat" title={t('instances.content')}>
            <Icon name="package" size={12} />
            {inst.content.length} {inst.content.length === 1 ? t('instances.contentOne') : t('instances.contentMany')}
          </span>
          <span className="instance-card-stat" title={t('instances.disk')}>
            <Icon name="database" size={12} />
            {sizeBytes === null ? t('instances.calculating') : formatBytes(sizeBytes)}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

export default function InstancesView() {
  const { instances, refreshInstances, pushToast } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const t = useT();

  async function handleImport() {
    setImporting(true);
    try {
      const instance = await window.hardLauncher.instances.importPackage();
      // null = el jugador canceló el diálogo de "abrir archivo", no es un error.
      if (instance) {
        await refreshInstances();
        pushToast(t('instances.importSuccess', { name: instance.name }), 'success');
      }
    } catch (e) {
      pushToast(t('instances.importFailed', { error: e.message }), 'error');
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <motion.div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <div>
          <h1 style={{ margin: 0 }}>{t('instances.title')}</h1>
          <span className="instances-count">
            {instances.length} {instances.length === 1 ? t('instances.countOne') : t('instances.countMany')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <motion.button
            className="btn-secondary btn-icon-label"
            onClick={handleImport}
            disabled={importing}
            whileHover={!importing ? { scale: 1.03 } : undefined}
            whileTap={!importing ? { scale: 0.97 } : undefined}
          >
            <Icon name="arrowDown" size={14} />
            {importing ? t('instances.importing') : t('instances.import')}
          </motion.button>
          <motion.button
            className="btn-primary"
            onClick={() => setShowCreate(true)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {t('instances.create')}
          </motion.button>
        </div>
      </motion.div>

      <motion.div className="grid-instances" variants={staggerContainer} initial="hidden" animate="show">
        <motion.button
          className="card instance-card instance-card-new"
          onClick={() => setShowCreate(true)}
          variants={staggerItem}
          whileHover={{ y: -3, transition: { duration: 0.15 } }}
          whileTap={{ scale: 0.97 }}
        >
          <div className="instance-card-new-icon">+</div>
          <div style={{ fontWeight: 700 }}>{t('instances.new')}</div>
        </motion.button>

        {instances.map((inst) => (
          <InstanceCard key={inst.id} inst={inst} onDeleted={refreshInstances} pushToast={pushToast} />
        ))}
      </motion.div>

      <AnimatePresence>
        {showCreate && (
          <CreateInstanceModal
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              refreshInstances();
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
