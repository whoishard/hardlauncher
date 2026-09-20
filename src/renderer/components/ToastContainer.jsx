import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '../store.js';
import Icon from './Icon.jsx';

const ICON_BY_TYPE = { error: 'close', success: 'check', info: 'info' };

export default function ToastContainer() {
  const { toasts, dismissToast } = useAppStore();

  return (
    <div className="toast-container">
      {/* AnimatePresence acá adentro (en vez de en el padre) para que cada
          toast anime su propia salida al descartarse, sin depender de que
          el array quede vacío — la lista sigue montada todo el tiempo. */}
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: -12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95, transition: { duration: 0.15 } }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={'toast toast-' + t.type}
            onClick={() => dismissToast(t.id)}
          >
            <span className="toast-icon">
              <Icon name={ICON_BY_TYPE[t.type] || 'info'} size={12} strokeWidth={2.4} />
            </span>
            <span>{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
