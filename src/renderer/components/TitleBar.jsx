import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import logoMark from '../assets/logo-mark.png';

export default function TitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const runningInstance = useAppStore((s) => s.runningInstance);
  const t = useT();

  useEffect(() => {
    window.hardLauncher.window.isMaximized().then(setIsMaximized);
    const unsub = window.hardLauncher.window.onMaximizedChanged(setIsMaximized);
    return unsub;
  }, []);

  return (
    <div className="titlebar">
      <div className="titlebar-drag">
        {/* Antes había un cuadradito violeta liso a modo de marca; ahora es
            el isotipo real del launcher (versión sin fondo, para que se
            funda con la barra en vez de traer su propio recuadro). */}
        <motion.img
          src={logoMark}
          alt=""
          className="titlebar-logo"
          animate={{ y: [0, -1.5, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <span className="titlebar-title">
          Hard <span className="titlebar-title-accent">Launcher</span>
        </span>
      </div>

      {/* Indicador global: se actualiza sin importar en qué pantalla estés
          (ver el listener a nivel de App). Va agrupado junto a los controles
          de ventana (min/max/cerrar), no centrado en la barra, para que se
          lea como parte de esa misma franja de "estado del programa". */}
      <div className="titlebar-right">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={runningInstance ? runningInstance.name : 'idle'}
            className={'titlebar-status' + (runningInstance ? ' running' : '')}
            title={runningInstance ? t('title.playing', { name: runningInstance.name }) : t('title.idle')}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
          >
            <span className="titlebar-status-dot" />
            {runningInstance ? t('title.running', { name: runningInstance.name }) : t('title.idle')}
          </motion.div>
        </AnimatePresence>

        <div className="titlebar-controls">
        <button className="titlebar-btn" onClick={() => window.hardLauncher.window.minimize()} title={t('window.minimize')}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect y="4.5" width="10" height="1" fill="currentColor" /></svg>
        </button>
        <button className="titlebar-btn" onClick={() => window.hardLauncher.window.toggleMaximize()} title={t('window.maximize')}>
          {isMaximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect x="1.5" y="0.5" width="8" height="8" fill="none" stroke="currentColor" />
              <rect x="0.5" y="1.5" width="8" height="8" fill="var(--bg-panel)" stroke="currentColor" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
          )}
        </button>
        <button className="titlebar-btn titlebar-btn-close" onClick={() => window.hardLauncher.window.close()} title={t('common.close')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <line x1="0.5" y1="0.5" x2="9.5" y2="9.5" stroke="currentColor" />
            <line x1="9.5" y1="0.5" x2="0.5" y2="9.5" stroke="currentColor" />
          </svg>
        </button>
        </div>
      </div>
    </div>
  );
}
