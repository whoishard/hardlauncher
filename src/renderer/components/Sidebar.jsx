import React, { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import CreateInstanceModal from './CreateInstanceModal.jsx';
import InstanceIcon from './InstanceIcon.jsx';
import Icon from './Icon.jsx';

// NavLink no es un motion component por defecto; envolverlo así permite
// usar whileHover/whileTap sobre el mismo <a> que ya maneja el ruteo,
// en vez de agregar un <motion.div> extra alrededor (que rompería el
// title/tooltip nativo del enlace).
const MotionNavLink = motion(NavLink);

export default function Sidebar() {
  const { instances, refreshInstances, openSettingsModal, settingsModalOpen } = useAppStore();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const t = useT();
  const NAV_ITEMS = [
    { to: '/', icon: 'home', label: t('nav.home'), end: true },
    { to: '/explore', icon: 'compass', label: t('nav.explore') },
    { to: '/instances', icon: 'layers', label: t('nav.instances') },
  ];

  return (
    <div className="sidebar">
      {NAV_ITEMS.map((item) => (
        <MotionNavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => 'sidebar-icon-btn' + (isActive ? ' active' : '')}
          title={item.label}
          whileHover={{ scale: 1.08 }}
          whileTap={{ scale: 0.92 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          <Icon name={item.icon} size={24} />
        </MotionNavLink>
      ))}

      <div className="sidebar-divider" />

      <div className="sidebar-instance-list">
        <AnimatePresence initial={false}>
          {instances.map((inst, i) => (
            // OJO: "layout" (para reacomodar la lista al agregar/borrar) y
            // "whileHover" con scale NO pueden ir en el mismo elemento acá.
            // Framer-motion mide el layout con getBoundingClientRect, que
            // durante el hover ya incluye el scale aplicado — lo interpreta
            // como si el elemento hubiera cambiado de tamaño "de verdad" y
            // lo compensa moviéndolo, lo que se sentía como que el ícono se
            // corría de costado al pasar el mouse entre instancia y el botón
            // "+". Separando el hover en un motion.div interno (sin layout)
            // ese cálculo ya no se dispara.
            <motion.div
              key={inst.id}
              layout
              initial={{ opacity: 0, scale: 0.7, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.22, delay: i * 0.03, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* sidebar-instance-slot es una caja de tamaño FIJO (54x54)
                  con overflow:hidden que en sí misma nunca se transforma.
                  El whileHover con scale vive en el motion.div de adentro:
                  por más que el ícono crezca al pasar el cursor, queda
                  recortado por este contenedor, que siempre mide 54x54 sin
                  importar el hover. Así .sidebar-instance-list nunca ve
                  cambiar la altura de contenido por culpa del hover, pase
                  lo que pase con el motor de render (a diferencia de
                  will-change, que no daba una garantía real). */}
              <div className="sidebar-instance-slot">
                <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}>
                  <NavLink
                    to={`/instances/${inst.id}`}
                    className={({ isActive }) => 'sidebar-instance-icon' + (isActive ? ' active' : '')}
                    title={inst.name}
                  >
                    <InstanceIcon name={inst.name} loader={inst.loader} icon={inst.icon} size={42} radius={11} />
                  </NavLink>
                </motion.div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="sidebar-instance-slot">
          <motion.button
            className="sidebar-icon-btn"
            title={t('nav.createInstance')}
            onClick={() => setShowCreate(true)}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          >
            <Icon name="plus" size={20} />
          </motion.button>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      <motion.button
        type="button"
        className={'sidebar-icon-btn' + (settingsModalOpen ? ' active' : '')}
        title={t('nav.settings')}
        onClick={openSettingsModal}
        whileHover={{ scale: 1.08 }}
        whileTap={{ scale: 0.92 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      >
        <Icon name="gear" size={24} />
      </motion.button>

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
