import React, { useState } from 'react';
import { useT } from '../i18n.js';

export default function Pagination({ page, totalPages, onChange, disabled, variant = 'bottom' }) {
  const [manualPage, setManualPage] = useState('');
  const t = useT();

  if (totalPages <= 1) return null;

  function goTo(p) {
    const clamped = Math.min(Math.max(1, p), totalPages);
    onChange(clamped);
  }

  function handleManualSubmit(e) {
    e.preventDefault();
    const n = parseInt(manualPage, 10);
    if (!Number.isNaN(n)) goTo(n);
    setManualPage('');
  }

  // Ventana de páginas visibles alrededor de la actual (máx. 5 números).
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  let end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pageNumbers = [];
  for (let p = start; p <= end; p++) pageNumbers.push(p);

  return (
    <div className={'pagination' + (variant === 'top' ? ' pagination-top' : '')}>
      <button className="pagination-btn" onClick={() => goTo(1)} disabled={disabled || page === 1} title={t('page.firstTitle')}>
        {t('page.first')}
      </button>
      <button className="pagination-btn" onClick={() => goTo(page - 1)} disabled={disabled || page === 1} title={t('common.previous')}>
        ‹
      </button>

      {start > 1 && <span className="pagination-ellipsis">…</span>}
      {pageNumbers.map((p) => (
        <button
          key={p}
          className={'pagination-btn' + (p === page ? ' active' : '')}
          onClick={() => goTo(p)}
          disabled={disabled}
        >
          {p}
        </button>
      ))}
      {end < totalPages && <span className="pagination-ellipsis">…</span>}

      <button className="pagination-btn" onClick={() => goTo(page + 1)} disabled={disabled || page === totalPages} title={t('common.next')}>
        ›
      </button>
      <button className="pagination-btn" onClick={() => goTo(totalPages)} disabled={disabled || page === totalPages} title={t('page.lastTitle')}>
        {t('page.last')}
      </button>

      <form onSubmit={handleManualSubmit} className="pagination-jump">
        <input
          type="number"
          min={1}
          max={totalPages}
          placeholder={t('page.goPlaceholder')}
          value={manualPage}
          onChange={(e) => setManualPage(e.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={disabled}>
          {t('page.go')}
        </button>
      </form>

      <span className="pagination-summary">
        {t('page.summary', { page, total: totalPages })}
      </span>
    </div>
  );
}
