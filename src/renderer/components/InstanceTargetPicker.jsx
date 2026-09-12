import React, { useEffect, useRef, useState } from 'react';
import InstanceIcon from './InstanceIcon.jsx';
import { useT } from '../i18n.js';

/** Indicador de "instalando en X instancia", con ícono y menú propio. */
export default function InstanceTargetPicker({ instances, value, onChange }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = instances.find((i) => i.id === value);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div className="target-picker" ref={ref}>
      <button type="button" className="target-picker-trigger" onClick={() => setOpen((o) => !o)}>
        {selected ? (
          <>
            <InstanceIcon name={selected.name} loader={selected.loader} icon={selected.icon} size={30} radius={8} />
            <div className="target-picker-text">
              <span className="target-picker-label">{t('picker.installingIn')}</span>
              <span className="target-picker-name">{selected.name}</span>
            </div>
          </>
        ) : (
          <span className="target-picker-empty">{t('picker.noInstances')}</span>
        )}
        <svg width="10" height="6" viewBox="0 0 10 6" className={'custom-select-arrow' + (open ? ' open' : '')}>
          <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="target-picker-menu">
          {instances.map((i) => (
            <div
              key={i.id}
              className={'target-picker-option' + (i.id === value ? ' selected' : '')}
              onClick={() => {
                onChange(i.id);
                setOpen(false);
              }}
            >
              <InstanceIcon name={i.name} loader={i.loader} icon={i.icon} size={26} radius={7} />
              <div>
                <div className="target-picker-option-name">{i.name}</div>
                <div className="target-picker-option-meta">{i.mcVersion} · {i.loader}</div>
              </div>
            </div>
          ))}
          {instances.length === 0 && <div className="custom-select-option disabled">{t('picker.noInstances')}</div>}
        </div>
      )}
    </div>
  );
}
