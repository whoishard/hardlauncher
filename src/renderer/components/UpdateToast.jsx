import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ProgressBar from './ProgressBar.jsx';
import Icon from './Icon.jsx';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';

/**
 * Escucha los eventos de electron-updater (ver electron/updater.js) y
 * muestra:
 * - una tarjeta flotante con progreso mientras se descarga la actualización
 *   (igual que InstallProgressToast, pero para la app en sí en vez de un mod),
 * - la misma tarjeta con un botón "Reiniciar ahora" cuando ya está lista,
 * - toasts comunes (ver ToastContainer) para "ya tenés la última versión" o
 *   errores, que no necesitan quedarse pegados en pantalla.
 *
 * No hace nada en modo desarrollo: electron/updater.js no registra ningún
 * listener ahí, así que 'updater:event' nunca llega.
 */
export default function UpdateToast() {
  const t = useT();
  const pushToast = useAppStore((s) => s.pushToast);
  const [state, setState] = useState(null); // { status, percent, version, message, url }

  useEffect(() => {
    if (!window.hardLauncher?.updater) return undefined;
    const unsub = window.hardLauncher.updater.onEvent((payload) => {
      if (
        payload.status === 'downloading' ||
        payload.status === 'available' ||
        payload.status === 'ready' ||
        payload.status === 'manual'
      ) {
        setState(payload);
      } else if (payload.status === 'not-available') {
        setState(null);
        pushToast(t('updater.upToDate'), 'info');
      } else if (payload.status === 'error') {
        setState(null);
        pushToast(t('updater.error', { message: payload.message }), 'error');
      }
      // 'checking' no se muestra: pasa casi siempre desapercibido (chequeo
      // silencioso al arrancar) y no vale la pena una tarjeta para eso.
    });
    return unsub;
  }, [pushToast, t]);

  function handleInstall() {
    window.hardLauncher.updater.install();
  }

  // Caso Linux instalado desde .deb (o corrido sin AppImage): no hay forma
  // de autoinstalar (ver electron/updater.js), así que el botón abre la
  // página de la Release en el navegador para bajarla a mano.
  function handleManualDownload() {
    window.hardLauncher.system.openExternal(state.url);
  }

  if (!state) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="update-toast"
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 16, scale: 0.96, transition: { duration: 0.15 } }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="update-toast-header">
          <div className="update-toast-icon">
            <Icon name={state.status === 'ready' ? 'check' : 'refresh'} size={13} />
          </div>
          <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {state.status === 'ready'
              ? t('updater.ready', { version: state.version })
              : state.status === 'manual'
                ? t('updater.manualReady', { version: state.version })
                : t('updater.downloading')}
          </div>
        </div>

        {state.status === 'ready' ? (
          <>
            <p className="update-toast-hint">{t('updater.readyHint')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary btn-icon-label" style={{ flex: 1 }} onClick={handleInstall}>
                <Icon name="refresh" size={13} />
                {t('updater.restartNow')}
              </button>
              <button className="btn-secondary" onClick={() => setState(null)}>
                {t('updater.later')}
              </button>
            </div>
          </>
        ) : state.status === 'manual' ? (
          <>
            <p className="update-toast-hint">{t('updater.manualHint')}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-primary btn-icon-label" style={{ flex: 1 }} onClick={handleManualDownload}>
                <Icon name="refresh" size={13} />
                {t('updater.download')}
              </button>
              <button className="btn-secondary" onClick={() => setState(null)}>
                {t('updater.later')}
              </button>
            </div>
          </>
        ) : (
          <ProgressBar percent={state.percent ?? null} />
        )}
      </motion.div>
    </AnimatePresence>
  );
}
