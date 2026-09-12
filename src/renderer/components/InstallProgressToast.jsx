import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import ProgressBar from './ProgressBar.jsx';
import Icon from './Icon.jsx';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';

function getStageLabel(t) {
  return {
    downloading: t('progress.downloading'),
    progress: t('progress.downloading'),
    dependency: t('progress.dependency'),
    'instance-created': t('progress.instanceCreated'),
    resolving: t('progress.resolving'),
  };
}

/**
 * El backend ya emitía "modrinth:installProgress" (ver electron/main.js,
 * handlers de installMod / installModpack) pero ningún componente del
 * renderer lo escuchaba: instalar un mod, resourcepack, shader o modpack
 * no mostraba ningún avance real, solo el texto fijo "Instalando..." en el
 * botón. Este toast, montado una sola vez en App.jsx, se suscribe a ese
 * evento globalmente para que el progreso se vea sin importar desde qué
 * vista se disparó la instalación (Explorar, detalle de proyecto, etc.).
 */
export default function InstallProgressToast() {
  const t = useT();
  const STAGE_LABEL = getStageLabel(t);
  const [state, setState] = useState(null); // { project, file, percent, stage }
  const hideTimer = useRef(null);
  const refreshInstances = useAppStore((s) => s.refreshInstances);
  // Ver el comentario de este flag en store.js: mientras ExploreView.jsx
  // está mostrando el progreso inline (en el propio rectángulo del mod),
  // este toast flotante se queda callado para no duplicar la misma
  // información — pero sigue escuchando el evento igual (más abajo), así
  // que si el flag se apaga a mitad de una instalación (ExploreView se
  // desmontó) el toast puede aparecer con el estado ya al día, sin perder
  // ningún progreso mientras tanto.
  const inlineInstallActive = useAppStore((s) => s.inlineInstallActive);

  useEffect(() => {
    const unsub = window.hardLauncher.modrinth.onInstallProgress((data) => {
      clearTimeout(hideTimer.current);

      // Un modpack recién creado (antes incluso de que termine de
      // descargarse) ya se guardó en disco del lado del proceso principal:
      // se refresca la lista de instancias apenas llega este evento para
      // que aparezca "en tiempo real" en Inicio/Instancias/Sidebar en vez
      // de recién mostrarse cuando la instalación completa termina.
      if (data.stage === 'instance-created') {
        refreshInstances();
      }

      if (data.stage === 'progress' && data.total) {
        setState({
          project: data.project,
          file: data.file,
          percent: (data.downloaded / data.total) * 100,
          stage: 'progress',
        });
      } else if (data.stage === 'downloading' && data.total) {
        // Progreso agregado de un lote de archivos (instalación de
        // modpack en paralelo), en vez del progreso de un único archivo.
        setState({
          project: data.project,
          file: t('progress.files', { done: data.completed, total: data.total }),
          percent: (data.completed / data.total) * 100,
          stage: 'downloading',
        });
      } else {
        setState({ project: data.project, file: data.file, percent: null, stage: data.stage });
      }
    });
    return unsub;
  }, [refreshInstances]);

  // Cuando dejan de llegar eventos (instalación terminada), se oculta el
  // toast solo después de una pequeña pausa en vez de desaparecer de golpe.
  useEffect(() => {
    if (!state) return;
    hideTimer.current = setTimeout(() => setState(null), 2200);
    return () => clearTimeout(hideTimer.current);
  }, [state]);

  return (
    <AnimatePresence>
      {state && !inlineInstallActive && (
        <motion.div
          className="install-progress-toast"
          initial={{ opacity: 0, y: 16, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.96, transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="install-progress-toast-header">
            <div className="install-progress-toast-icon">
              <Icon name="upload" size={13} />
            </div>
            <div style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {state.project || t('project.installingContent')}
            </div>
          </div>
          <ProgressBar
            label={STAGE_LABEL[state.stage] || t('progress.preparing')}
            percent={state.percent}
            hint={state.file}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
