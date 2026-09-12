import React, { useEffect, useRef, useState } from 'react';

/**
 * Dropdown de filtro: un botón compacto que abre un popover flotante.
 * Al estar flotando (position: absolute) en vez de vivir permanentemente
 * en el flujo de la página, su scroll interno nunca compite con el scroll
 * de la página — eso es justamente lo que causaba que el explorador se
 * "trabara" al bajar con la barra de filtros lateral anterior.
 */
export default function FilterDropdown({ label, count = 0, children, width = 260 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div className="filter-dropdown" ref={ref}>
      <button type="button" className={'filter-dropdown-trigger' + (count > 0 ? ' active' : '')} onClick={() => setOpen((o) => !o)}>
        {label}
        {count > 0 && <span className="filter-dropdown-count">{count}</span>}
        <svg width="10" height="6" viewBox="0 0 10 6" className={'custom-select-arrow' + (open ? ' open' : '')}>
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="filter-dropdown-menu" style={{ width }}>
          {children}
        </div>
      )}
    </div>
  );
}
