import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import { modalOverlayMotion, modalCardMotion } from './CreateInstanceModal.jsx';
import { useT } from '../i18n.js';

// Mismos helpers que usa la tabla de versiones de ProjectDetailView.jsx —
// se duplican acá (son cortos) en vez de exportarse desde ahí, mismo
// criterio que ya sigue UpdateInstanceVersionModal.jsx con CONTENT_TYPE_META.
const CHANNEL_LABEL = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function formatRelativeDate(dateStr) {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffDay = Math.floor(diffMs / 86400000);
  if (diffDay < 1) return 'hoy';
  if (diffDay < 7) return `hace ${diffDay}d`;
  if (diffDay < 30) return `hace ${Math.floor(diffDay / 7)}sem`;
  const diffMonth = Math.floor(diffDay / 30);
  if (diffMonth === 1) return 'el mes pasado';
  if (diffMonth < 12) return `hace ${diffMonth}m`;
  const diffYear = Math.floor(diffDay / 365);
  return diffYear === 1 ? 'el año pasado' : `hace ${diffYear}a`;
}

/**
 * Modal "Cambiar versión" de un ítem de contenido ya instalado en una
 * instancia. Se abre desde el botón "swap" de la fila en la pestaña
 * Contenido — ese botón SOLO aparece cuando el ítem no tiene una
 * actualización pendiente (si la tiene, ese lugar lo ocupa el botón
 * "Actualizar" de siempre, que va directo a la más nueva sin preguntar
 * nada). Acá, en cambio, el usuario elige a mano cualquier versión
 * publicada compatible con el mcVersion/loader de la instancia — para
 * bajar de versión, probar una beta, volver a una anterior después de un
 * bug, etc. — con el mismo listado/pinta que la tabla de versiones de la
 * ficha de un proyecto en Explorar (versions-table de ProjectDetailView),
 * para que se sienta la misma acción en vez de una UI nueva a aprender.
 */
export default function ChangeModVersionModal({ instance, item, onClose, onChanged, pushToast }) {
  const t = useT();
  const [versions, setVersions] = useState(null); // null = todavía cargando
  const [error, setError] = useState('');
  const [installingId, setInstallingId] = useState(null);
  // Filtro de texto para encontrar una versión puntual dentro de la lista
  // (puede haber decenas). Se compara contra el nombre de la versión, el
  // canal (release/beta/alpha), las versiones de Minecraft y los loaders
  // que soporta — todo en minúsculas para que no importen mayúsculas.
  const [search, setSearch] = useState('');

  useEffect(() => {
    let cancelled = false;
    // A diferencia de "Actualizar" (que sí filtra por mcVersion porque busca
    // UNA versión compatible para instalar sola), acá el usuario elige a
    // mano: se listan TODAS las versiones publicadas del proyecto (filtrando
    // solo por loader, para no mostrar versiones de otro mod loader que ni
    // se podrían instalar) y se ordenan por fecha de lanzamiento, más nueva
    // primero — así siempre hay opciones para elegir aunque ninguna calce
    // justo con el mcVersion actual de la instancia (bajar de versión,
    // probar una beta vieja, etc.), en vez de quedar con la lista vacía.
    const loader = instance.loader && instance.loader !== 'vanilla' ? instance.loader : undefined;
    window.hardLauncher.modrinth
      .versions(item.projectId, { loader, priority: true })
      .then((data) => {
        if (cancelled) return;
        const sorted = [...(data || [])].sort(
          (a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime()
        );
        setVersions(sorted);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [item.projectId, instance.loader]);

  // Lista visible tras aplicar el buscador. Con la búsqueda vacía se
  // devuelven todas las versiones tal cual, sin tocar el orden que ya
  // vino del efecto de arriba (más nueva primero).
  const normalizedSearch = search.trim().toLowerCase();
  const filteredVersions = versions
    ? versions.filter((v) => {
        if (!normalizedSearch) return true;
        const haystack = [
          v.name,
          v.version_number,
          CHANNEL_LABEL[v.version_type] || v.version_type,
          ...(v.game_versions || []),
          ...(v.loaders || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : [];

  async function handlePick(version) {
    if (version.id === item.versionId || installingId) return;
    setInstallingId(version.id);
    setError('');
    try {
      await window.hardLauncher.modrinth.changeContentVersion(instance.id, item.fileName, version.id);
      pushToast?.(t('content.changeVersionSuccess', { name: item.projectTitle }), 'success');
      await onChanged?.();
    } catch (e) {
      setError(e.message);
      pushToast?.(t('content.changeVersionFailed', { error: e.message }), 'error');
      setInstallingId(null);
    }
  }

  return (
    <motion.div className="modal-overlay" onClick={onClose} {...modalOverlayMotion}>
      <motion.div
        className="card modal-card change-version-modal"
        onClick={(e) => e.stopPropagation()}
        {...modalCardMotion}
      >
        <div className="modal-header">
          <h3 className="modal-title">
            {t('content.changeVersion')} · {item.projectTitle}
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {versions === null && !error && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
            <span className="mini-spinner" />
          </div>
        )}

        {error && <p style={{ color: 'var(--danger)', padding: '0 20px 16px' }}>{error}</p>}

        {versions && versions.length === 0 && (
          <p style={{ color: 'var(--text-muted)', padding: '0 20px 20px' }}>{t('content.changeVersionNone')}</p>
        )}

        {versions && versions.length > 0 && (
          <div style={{ padding: '0 20px 12px' }}>
            <div className="content-search" style={{ width: '100%' }}>
              <Icon name="search" size={14} />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('content.changeVersionSearchPlaceholder')}
              />
            </div>
          </div>
        )}

        {versions && versions.length > 0 && filteredVersions.length === 0 && (
          <p style={{ color: 'var(--text-muted)', padding: '0 20px 20px' }}>{t('content.changeVersionNoMatch')}</p>
        )}

        {versions && filteredVersions.length > 0 && (
          <div
            className="card versions-table-card change-version-list"
            style={{ margin: '0 20px 20px' }}
          >
            <div className="versions-table">
              <div className="versions-table-row versions-table-head">
                <span className="versions-col-type" />
                <span>{t('project.colVersion')}</span>
                <span>{t('project.colGame')}</span>
                <span>{t('project.colPublished')}</span>
                <span className="versions-col-actions" />
              </div>
              {filteredVersions.map((v) => {
                const isCurrent = v.id === item.versionId;
                return (
                  <div key={v.id} className={'versions-table-row' + (isCurrent ? ' installed' : '')}>
                    <span
                      className={'version-type-dot type-' + (v.version_type || 'release')}
                      title={CHANNEL_LABEL[v.version_type] || v.version_type}
                    >
                      {(v.version_type || '?').charAt(0).toUpperCase()}
                    </span>

                    <div className="versions-table-name">
                      <span className="version-name-text">{v.name}</span>
                      <div className="versions-table-badges">
                        {(v.loaders || []).map((l) => (
                          <span key={l} className="badge badge-sm badge-loader">
                            {capitalize(l)}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="versions-table-badges">
                      {(v.game_versions || []).slice(0, 3).map((gv) => (
                        <span key={gv} className="badge badge-sm">
                          {gv}
                        </span>
                      ))}
                      {(v.game_versions || []).length > 3 && (
                        <span className="badge badge-sm">+{v.game_versions.length - 3}</span>
                      )}
                    </div>

                    <span className="version-date">{formatRelativeDate(v.date_published)}</span>

                    <div className="versions-table-actions">
                      {isCurrent ? (
                        <span className="version-action-btn installed">
                          <Icon name="check" size={14} strokeWidth={2.6} />
                          {t('content.changeVersionCurrent')}
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="version-action-btn install"
                          onClick={() => handlePick(v)}
                          disabled={installingId !== null}
                        >
                          {installingId === v.id && <span className="mini-spinner" />}
                          {t('content.changeVersionUse')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
