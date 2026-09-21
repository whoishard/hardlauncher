import React, { useState } from 'react';
import { useT } from '../i18n.js';

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

/**
 * Modal de "Exportar instancia" (ver InstanceOptionsMenu.jsx). Deja elegir
 * si sumar mundos/capturas al paquete .hlpack (mods, configs, resource
 * packs, shaders y datapacks van siempre) y dispara el diálogo nativo de
 * "guardar como" — que vive en el proceso principal, ver
 * instances:export en electron/main.js — al confirmar.
 */
export default function ExportInstanceModal({ instance, onClose, pushToast }) {
  const t = useT();
  const [includeWorlds, setIncludeWorlds] = useState(false);
  const [includeScreenshots, setIncludeScreenshots] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const result = await window.hardLauncher.instances.export(instance.id, {
        includeWorlds,
        includeScreenshots,
      });
      // result es null si el jugador canceló el diálogo de "guardar como"
      // (no es un error, no hace falta avisar nada).
      if (result) {
        pushToast?.(t('instances.exportSuccess', { name: instance.name, size: formatBytes(result.size) }), 'success');
        onClose();
      }
    } catch (e) {
      pushToast?.(t('instances.exportFailed', { error: e.message }), 'error');
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={() => !exporting && onClose()}>
      <div className="card modal-card" style={{ width: 420 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{t('instances.exportTitle', { name: instance.name })}</h3>
            <p className="modal-subtitle">{t('instances.exportSubtitle')}</p>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <label className="custom-checkbox-row">
            <input type="checkbox" checked={includeWorlds} onChange={(e) => setIncludeWorlds(e.target.checked)} />
            <span className="custom-checkbox-box" />
            <div>
              <div>{t('instances.exportIncludeWorlds')}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                {t('instances.exportIncludeWorldsHint')}
              </div>
            </div>
          </label>
          <label className="custom-checkbox-row">
            <input
              type="checkbox"
              checked={includeScreenshots}
              onChange={(e) => setIncludeScreenshots(e.target.checked)}
            />
            <span className="custom-checkbox-box" />
            <div>{t('instances.exportIncludeScreenshots')}</div>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleExport} disabled={exporting}>
            {exporting ? t('instances.exporting') : t('instances.exportConfirm')}
          </button>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={exporting}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
}
