import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import ImportJobCard from './ImportJobCard.jsx';
import Icon from './Icon.jsx';
import { useJobsStore, initJobs } from '../jobsStore.js';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';

/**
 * Panel flotante (abajo a la derecha) con todas las importaciones e
 * instalaciones en curso o recién terminadas. Está montado una sola vez en
 * App.jsx, así que sigue ahí aunque se cierre el asistente de "Crear
 * instancia" o se navegue a otra pantalla: la instalación corre en el
 * proceso principal y este panel solo la muestra.
 */
export default function ImportJobsPanel() {
  const t = useT();
  const navigate = useNavigate();
  const pushToast = useAppStore((s) => s.pushToast);
  const jobs = useJobsStore((s) => s.jobs);
  const watchedJobId = useJobsStore((s) => s.watchedJobId);
  const collapsed = useJobsStore((s) => s.panelCollapsed);
  const setPanelCollapsed = useJobsStore((s) => s.setPanelCollapsed);
  const dismiss = useJobsStore((s) => s.dismiss);
  const clearFinished = useJobsStore((s) => s.clearFinished);
  const lastStatus = useRef(new Map());

  useEffect(() => {
    initJobs();
  }, []);

  // Aviso al terminar (o fallar) una importación que no se estaba mirando en
  // el modal: es el caso típico de "la dejé corriendo en segundo plano".
  useEffect(() => {
    for (const job of jobs) {
      const prev = lastStatus.current.get(job.id);
      lastStatus.current.set(job.id, job.status);
      if (prev !== 'running' || job.status === 'running') continue;
      if (job.id === watchedJobId) continue;
      const name = job.instanceName || job.title;
      if (job.status === 'done') pushToast(t('jobs.doneOne', { name }), 'success');
      else pushToast(`${t('jobs.failed')}: ${job.error}`, 'error');
    }
    // Los que ya estaban terminados al cargar no deben avisar: se anotan sin disparar nada.
    for (const job of jobs) if (!lastStatus.current.has(job.id)) lastStatus.current.set(job.id, job.status);
  }, [jobs]);

  const visible = jobs.filter((j) => j.id !== watchedJobId);
  const running = visible.filter((j) => j.status === 'running').length;
  const finished = visible.length - running;

  function open(instanceId) {
    navigate(`/instances/${instanceId}`);
  }

  return (
    <AnimatePresence>
      {visible.length > 0 && (
        <motion.div
          className="jobs-panel"
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97, transition: { duration: 0.15 } }}
          transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="jobs-panel-header">
            <button
              type="button"
              className="jobs-panel-toggle"
              onClick={() => setPanelCollapsed(!collapsed)}
              title={collapsed ? t('jobs.expand') : t('jobs.collapse')}
            >
              <Icon name="download" size={13} />
              <span>{t('jobs.title')}</span>
              {running > 0 && <span className="jobs-panel-badge">{t('jobs.running', { n: running })}</span>}
              <span className={'jobs-panel-chevron' + (collapsed ? ' collapsed' : '')}>
                <Icon name="chevronDown" size={13} />
              </span>
            </button>
            {finished > 0 && (
              <button type="button" className="import-job-link" onClick={clearFinished}>
                {t('jobs.clearFinished')}
              </button>
            )}
          </div>

          {!collapsed && (
            <div className="jobs-panel-list">
              {visible.map((job) => (
                <ImportJobCard key={job.id} job={job} onOpen={open} onDismiss={() => dismiss(job.id)} />
              ))}
            </div>
          )}
          {collapsed && running > 0 && (
            <div className="jobs-panel-mini">
              {visible
                .filter((j) => j.status === 'running')
                .map((job) => (
                  <div key={job.id} className="jobs-panel-mini-row">
                    <span className="jobs-panel-mini-name">{job.instanceName || job.title}</span>
                    <span>{job.percent != null ? `${Math.round(job.percent)}%` : '…'}</span>
                  </div>
                ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
