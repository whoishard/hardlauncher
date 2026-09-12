import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store.js';
import Icon from './Icon.jsx';
import { useT } from '../i18n.js';

export default function InstanceOptionsMenu({ instance, onDeleted, pushToast, inline = false }) {
  const t = useT();
  const navigate = useNavigate();
  const removeInstance = useAppStore((s) => s.removeInstance);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function handleDelete() {
    setDeleting(true);
    // removeInstance ya saca la instancia de la lista global al instante
    // (antes de que termine el borrado en disco), así que la tarjeta
    // desaparece de una apenas se confirma, en vez de recién después del
    // viaje de ida y vuelta a disco.
    setConfirming(false);
    try {
      await removeInstance(instance.id);
      pushToast?.(t('instances.deleted', { name: instance.name }), 'info');
      onDeleted?.();
    } catch (e) {
      pushToast?.(t('instances.deleteFailed', { error: e.message }), 'error');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div
      className={'instance-card-menu-wrap' + (inline ? ' inline' : '')}
      ref={ref}
      onClick={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        className="instance-card-menu-btn"
        title={t('common.options')}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <Icon name="dots" size={15} />
      </button>

      {open && (
        <div className="instance-card-menu">
          <button
            type="button"
            className="instance-card-menu-item"
            onClick={() => {
              setOpen(false);
              navigate(`/instances/${instance.id}?tab=settings`);
            }}
          >
            <Icon name="gear" size={14} />
            {t('instances.config')}
          </button>
          <button
            type="button"
            className="instance-card-menu-item"
            onClick={() => window.hardLauncher.instances.openFolder(instance.id)}
          >
            <Icon name="folder" size={14} />
            {t('common.openFolder')}
          </button>
          <button
            type="button"
            className="instance-card-menu-item danger"
            onClick={() => {
              setOpen(false);
              setConfirming(true);
            }}
          >
            <Icon name="trash" size={14} />
            {t('common.delete')}
          </button>
        </div>
      )}

      {confirming && (
        <div className="modal-overlay" onClick={() => !deleting && setConfirming(false)}>
          <div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{t('instances.deleteTitle', { name: instance.name })}</h3>
                <p className="modal-subtitle">{t('instances.deleteBody')}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-danger" style={{ flex: 1 }} onClick={handleDelete} disabled={deleting}>
                {deleting ? t('instances.deleting') : t('instances.confirmDelete')}
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={deleting}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
