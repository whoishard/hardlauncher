import React from 'react';
import { motion } from 'framer-motion';

/**
 * Fondo ambiental fijo detrás de toda la app: un resplandor superior sutil
 * con el color de acento del tema activo + dos anillos que giran muy lento.
 * Tomado del "BackgroundEffects" de Solaris Launcher. Se monta una sola vez
 * en App.jsx, por eso las animaciones son "infinite" en vez de disparadas
 * por interacción — es ambiente, no feedback.
 */
export default function AmbientBackground() {
  return (
    <div className="ambient-bg" aria-hidden="true">
      <div className="ambient-bg-iso" />
      <div className="ambient-bg-glow" />
      <motion.div
        className="ambient-bg-ring ambient-bg-ring--a"
        animate={{ rotate: 360 }}
        transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
      />
      <motion.div
        className="ambient-bg-ring ambient-bg-ring--b"
        animate={{ rotate: -360 }}
        transition={{ duration: 180, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}
