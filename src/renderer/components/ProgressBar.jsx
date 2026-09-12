import React from 'react';
import { motion } from 'framer-motion';

/**
 * Barra de progreso genérica.
 * - Si se pasa `percent` (0-100), muestra el relleno proporcional, animado
 *   con framer-motion (spring) en vez de solo la transición CSS de "width"
 *   que había antes, así los saltos grandes de porcentaje (llega un evento
 *   con +30% de golpe) se ven como un barrido fluido y no un salto seco.
 * - Si no hay `percent` (ej. todavía no se conoce el total de un
 *   download), se muestra en modo "indeterminado" (animación en bucle),
 *   para no dejar al usuario mirando una barra vacía o trabada en 0%.
 */
export default function ProgressBar({ label, percent, hint }) {
  const known = typeof percent === 'number' && Number.isFinite(percent);
  const clamped = known ? Math.max(0, Math.min(100, percent)) : null;

  return (
    <div className="progress-bar-wrap">
      {(label || known) && (
        <div className="progress-bar-header">
          {label && <span className="progress-bar-label">{label}</span>}
          {known && <span className="progress-bar-percent">{Math.round(clamped)}%</span>}
        </div>
      )}
      <div className="progress-bar-track">
        {known ? (
          <motion.div
            className="progress-bar-fill"
            initial={false}
            animate={{ width: `${clamped}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        ) : (
          <div className="progress-bar-fill indeterminate" />
        )}
      </div>
      {hint && <div className="progress-bar-label" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}
