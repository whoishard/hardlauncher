import React, { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n.js';

/**
 * Reemplaza <select> nativo. El navegador/SO controla por completo el
 * popup de un <select> real y no se puede restylear de forma consistente
 * (en Windows se ve gris con bordes cuadrados sin importar el CSS) — por
 * eso se arma un dropdown propio con div/button, igual a como lo hace
 * la app real de Modrinth.
 */
export default function Select({ value, onChange, options, placeholder, disabled, style }) {
  const t = useT();
  const resolvedPlaceholder = placeholder ?? t('common.select');
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={'custom-select' + (disabled ? ' disabled' : '')} ref={ref} style={style}>
      <button
        type="button"
        className="custom-select-trigger"
        onClick={() => !disabled && setOpen((o) => !o)}
        disabled={disabled}
      >
        <span className={selected ? '' : 'custom-select-placeholder'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          className={'custom-select-arrow' + (open ? ' open' : '')}
          width="10"
          height="6"
          viewBox="0 0 10 6"
        >
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="custom-select-menu">
          {options.length === 0 && <div className="custom-select-option disabled">{t('select.empty')}</div>}
          {options.map((o) => (
            <div
              key={o.value}
              className={'custom-select-option' + (o.value === value ? ' selected' : '')}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
