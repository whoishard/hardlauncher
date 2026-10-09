import React, { useEffect, useState } from 'react';
import ProgressBar from './ProgressBar.jsx';
import Icon from './Icon.jsx';
import { useT } from '../i18n.js';

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Cronómetro que avanza mientras el job corre y se congela cuando termina. */
function useElapsed(job) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (job.status !== 'running') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status]);
  return formatElapsed((job.finishedAt || now) - job.startedAt);
}

/**
 * Tarjeta de una importación/instalación: etapa actual, barra de progreso,
 * archivo en curso, tiempo transcurrido y, al terminar, el resultado con sus
 * avisos. Se usa tanto dentro del modal de "Crear instancia" como en el panel
 * flotante global (ImportJobsPanel).
 */
export default function ImportJobCard({ job, onOpen, onDismiss, children }) {
  const t = useT();
  const elapsed = useElapsed(job);
  const [showLog, setShowLog] = useState(false);

  const running = job.status === 'running';
  const failed = job.status === 'error';
  const name = job.instanceName || job.title;

  const phaseKey = `jobs.phase.${job.phase}`;
  const phaseLabel = running ? t(phaseKey) : '';
  const countHint =
    job.total != null && job.completed != null
      ? `${t('progress.files', { done: job.completed, total: job.total })}${job.detail ? ` · ${job.detail}` : ''}`
      : job.detail || undefined;

  let resultText = '';
  if (job.status === 'done') {
    resultText =
      job.results.length > 1
        ? t('jobs.doneMany', { n: job.results.length })
        : t('jobs.doneOne', { name: job.results[0]?.name || name });
  }

  return (
    <div className={'import-job-card' + (failed ? ' is-error' : '') + (job.status === 'done' ? ' is-done' : '')}>
      <div className="import-job-header">
        <div className={'import-job-icon' + (failed ? ' error' : job.status === 'done' ? ' done' : '')}>
          {running ? <span className="mini-spinner" /> : <Icon name={failed ? 'alertTriangle' : 'check'} size={13} />}
        </div>
        <div className="import-job-title" title={name}>
          {name}
        </div>
        <div className="import-job-elapsed">{elapsed}</div>
        {!running && onDismiss && (
          <button type="button" className="import-job-x" onClick={onDismiss} title={t('jobs.dismiss')}>
            <Icon name="close" size={12} />
          </button>
        )}
      </div>

      {running && <ProgressBar label={phaseLabel} percent={job.percent} hint={countHint} />}
      {job.status === 'done' && <div className="import-job-result">{resultText}</div>}
      {failed && <div className="import-job-error">{t('jobs.failed')}: {job.error}</div>}

      {job.warnings.length > 0 && (
        <div className="import-job-warnings">
          <Icon name="alertTriangle" size={12} />
          {t('jobs.warnings', { n: job.warnings.length })}
        </div>
      )}

      {children}

      <div className="import-job-actions">
        <button type="button" className="import-job-link" onClick={() => setShowLog((v) => !v)}>
          {showLog ? t('jobs.hideDetails') : t('jobs.showDetails')}
        </button>
        {job.status === 'done' && job.instanceId && onOpen && (
          <button type="button" className="btn-primary import-job-open" onClick={() => onOpen(job.instanceId)}>
            {t('jobs.open')}
          </button>
        )}
      </div>

      {showLog && (
        <div className="import-job-log">
          {job.log.length === 0 ? (
            <div>—</div>
          ) : (
            job.log.slice(-40).map((line, i) => <div key={i}>{line}</div>)
          )}
        </div>
      )}
    </div>
  );
}
