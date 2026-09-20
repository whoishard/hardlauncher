import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
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
  const { instances, refreshInstances, reorderInstances, openSettingsModal, settingsModalOpen } = useAppStore();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const t = useT();
  const NAV_ITEMS = [
    { to: '/', icon: 'home', label: t('nav.home'), end: true },
    { to: '/explore', icon: 'compass', label: t('nav.explore') },
    { to: '/instances', icon: 'layers', label: t('nav.instances') },
  ];

  // Copia local del orden, para que arrastrar se sienta instantáneo: en
  // cada frame de drag, framer-motion (Reorder.Group/Item más abajo)
  // reacomoda ESTE array, sin esperar a que la escritura a disco
  // (reorderInstances -> IPC, ver store.js) vuelva. Se resincroniza con la
  // store cada vez que "instances" cambia de verdad (se creó/borró una
  // instancia en otro lado) — salvo mientras hay un drag en curso, para no
  // pisarle al usuario el reordenamiento a medio hacer.
  const [order, setOrder] = useState(instances);
  const draggingRef = useRef(false);
  // Límite del arrastre: sin esto, framer-motion deja que el ícono agarrado
  // se despegue del todo de la lista (Reorder.Item arrastra libre en el eje
  // Y por defecto) y se pueda tirar bien para arriba, tapando los íconos de
  // navegación (Inicio/Explorar/Instancias), o bien para abajo, tapando el
  // botón de "+" — se ve raro y además, al soltarlo ahí afuera, igual
  // termina reordenando la lista como si lo hubiese soltado en el extremo
  // más cercano, así que la sensación de que "se pasa" no ayuda a apuntar
  // mejor. listRef apunta al wrapper sidebar-instance-drag-bounds de más
  // abajo (que envuelve SOLO los íconos, no el botón "+"), así el límite de
  // abajo queda justo donde termina el último ícono en vez de incluir
  // también al "+" — ver el comentario junto a ese wrapper para el porqué
  // de que esté separado del Reorder.Group entero.
  const listRef = useRef(null);
  useEffect(() => {
    if (!draggingRef.current) setOrder(instances);
  }, [instances]);

  function handleDragEnd() {
    draggingRef.current = false;
    reorderInstances(order.map((inst) => inst.id));
  }

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

      {/* "as" en Group/Item mantiene todo como <div> (el default de
          Reorder es <ul>/<li>, que traería su propio padding/list-style y
          rompería el flex de .sidebar-instance-list). El drag vertical
          (axis="y") es justo el gesto natural acá: agarrar un ícono y
          soltarlo más arriba/abajo en la misma columna. */}
      <Reorder.Group
        as="div"
        axis="y"
        values={order}
        onReorder={setOrder}
        className="sidebar-instance-list"
      >
        {/* dragConstraints apunta a ESTE wrapper (sidebar-instance-drag-bounds),
            no al Reorder.Group entero — si apuntara al grupo entero, sus
            límites incluirían también el botón "+" de acá abajo (es hijo
            del mismo Reorder.Group, para que el flex/gap lo posicione justo
            debajo de la lista), y el ícono arrastrado podría taparlo. Con el
            límite acá adentro, el borde de abajo del arrastre queda justo
            donde termina el último ícono, antes del "+". El Context de
            framer-motion que conecta Reorder.Group con cada Reorder.Item
            viaja por React, no por el DOM, así que este div intermedio no
            rompe nada del reordenamiento. */}
        <div ref={listRef} className="sidebar-instance-drag-bounds">
          <AnimatePresence initial={false}>
            {order.map((inst) => (
            // sidebar-instance-slot es una caja de tamaño FIJO (54x54) con
            // overflow:hidden que en sí misma nunca se transforma. El
            // whileHover con scale vive en el motion.div de adentro: por
            // más que el ícono crezca al pasar el cursor, queda recortado
            // por este contenedor. Reorder.Item ya trae su propio "layout"
            // (para reacomodar la lista al arrastrar/agregar/borrar), así
            // que el whileHover sigue separado en el motion.div interno en
            // vez de vivir en el mismo elemento — mismo motivo que antes:
            // framer mide el layout con getBoundingClientRect, que durante
            // el hover ya incluye el scale aplicado.
            <Reorder.Item
              as="div"
              key={inst.id}
              value={inst}
              className="sidebar-instance-draggable"
              onDragStart={() => {
                draggingRef.current = true;
              }}
              onDragEnd={handleDragEnd}
              initial={{ opacity: 0, scale: 0.7, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              whileDrag={{ scale: 1.12, zIndex: 30, boxShadow: '0 10px 24px rgba(0,0,0,0.4)' }}
              // Frena el arrastre en los bordes de sidebar-instance-drag-bounds
              // (listRef) en vez de dejarlo seguir libre — ver el comentario
              // junto a listRef más arriba. dragElastic bien chico (en vez
              // de 0 seco) deja una resistencia mínima al llegar al borde,
              // así se siente "frenado" y no "topado con una pared".
              dragConstraints={listRef}
              dragElastic={0.08}
            >
              {/* El overflow:hidden del recorte de hover vive en este div
                  ADENTRO del Reorder.Item (que es el que en realidad
                  arrastra y escala/hace sombra en whileDrag) para que esa
                  sombra y el scale del arrastre no queden recortados por su
                  propio contenedor — solo el hover chiquito de más abajo
                  necesita quedar contenido en la caja de 54x54. */}
              <div className="sidebar-instance-slot">
                <motion.div whileHover={{ scale: 1.08 }} whileTap={{ scale: 0.92 }}>
                  <NavLink
                    to={`/instances/${inst.id}`}
                    className={({ isActive }) => 'sidebar-instance-icon' + (isActive ? ' active' : '')}
                    title={inst.name}
                    draggable={false}
                  >
                    <InstanceIcon name={inst.name} loader={inst.loader} icon={inst.icon} size={42} radius={11} />
                  </NavLink>
                </motion.div>
              </div>
            </Reorder.Item>
            ))}
          </AnimatePresence>
        </div>
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
      </Reorder.Group>

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
