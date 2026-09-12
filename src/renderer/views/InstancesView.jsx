import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT, formatPlaytimePlayed } from '../i18n.js';
import CreateInstanceModal from '../components/CreateInstanceModal.jsx';
import InstanceIcon from '../components/InstanceIcon.jsx';
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

// Link no es un motion component; se envuelve así (en vez de meterlo dentro
// de un <motion.div>) para que siga siendo EL elemento del grid — con un
// wrapper extra, el grid le aplicaría el tamaño de celda al div y el Link
// de adentro necesitaría 100% width/height para heredarlo, y no vale la
// pena tocar el CSS del grid solo por esto.
const MotionLink = motion(Link);

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

  return (
    <MotionLink
      to={`/instances/${inst.id}`}
      className="card instance-card"
      variants={staggerItem}
      whileHover={{ y: -3, transition: { duration: 0.15 } }}
    >
      <InstanceOptionsMenu instance={inst} onDeleted={onDeleted} pushToast={pushToast} />
      <InstanceIcon name={inst.name} loader={inst.loader} icon={inst.icon} size={72} />
      <div style={{ fontWeight: 700, marginTop: 4 }}>{inst.name}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
        {inst.mcVersion} · {inst.loader}
      </div>

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
    </MotionLink>
  );
}

export default function InstancesView() {
  const { instances, refreshInstances, pushToast } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const t = useT();

  return (
    <div>
      <motion.div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1 style={{ margin: 0 }}>{t('instances.title')}</h1>
        <motion.button
          className="btn-primary"
          onClick={() => setShowCreate(true)}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
        >
          {t('instances.create')}
        </motion.button>
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
