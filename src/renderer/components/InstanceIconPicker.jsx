import React, { useState } from 'react';
import InstanceIcon from './InstanceIcon.jsx';
import Icon from './Icon.jsx';
import IconStudioModal from './IconStudioModal.jsx';
import { fileToResizedDataUrl } from './iconStudioData.js';
import { useT } from '../i18n.js';

/**
 * Selector de ícono de instancia: abre el Estudio de íconos (fondo +
 * símbolo estilo voxel, o pestaña de imagen personalizada) al hacer clic en
 * la miniatura o en "Editar ícono". Arrastrar un archivo directo sobre la
 * miniatura sigue siendo un atajo rápido para subir una imagen sin pasar
 * por el estudio, igual que antes.
 */
export default function InstanceIconPicker({ name, loader, value, onChange, isRandomDefault, modpackIcon }) {
  const t = useT();
  const [dragOver, setDragOver] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setError(t('icon.needImage'));
      return;
    }
    setError('');
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      onChange(dataUrl);
    } catch (e) {
      setError(t('icon.processFail'));
    }
  }

  return (
    <div className="icon-picker">
      <div
        className={'icon-picker-preview' + (dragOver ? ' drag-over' : '')}
        onClick={() => setStudioOpen(true)}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          handleFile(e.dataTransfer.files?.[0]);
        }}
        title={t('icon.edit')}
      >
        <InstanceIcon name={name || '?'} loader={loader} icon={value} size={56} radius={13} />
        <div className="icon-picker-overlay">
          <Icon name="palette" size={18} />
        </div>
      </div>

      <div className="icon-picker-actions">
        <div>
          <div className="icon-picker-title">{t('icon.title')}</div>
          <div className="icon-picker-hint">
            {!value ? t('icon.auto') : isRandomDefault ? t('icon.randomAssigned') : t('icon.custom')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn-secondary btn-icon-label" onClick={() => setStudioOpen(true)}>
            <Icon name="palette" size={13} />
            {t('icon.edit')}
          </button>
        </div>
      </div>

      {error && <div className="instance-form-error" style={{ marginTop: 8 }}>{error}</div>}

      {studioOpen && (
        <IconStudioModal
          name={name}
          loader={loader}
          value={value}
          onChange={onChange}
          onClose={() => setStudioOpen(false)}
          modpackIcon={modpackIcon}
        />
      )}
    </div>
  );
}
