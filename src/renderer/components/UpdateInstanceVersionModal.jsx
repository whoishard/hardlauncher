import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Select from './Select.jsx';
import Icon from './Icon.jsx';
import ProgressBar from './ProgressBar.jsx';
import { LoaderGlyph, LOADER_BADGES } from './InstanceIcon.jsx';
import { modalOverlayMotion, modalCardMotion, LOADERS } from './CreateInstanceModal.jsx';
import { useT } from '../i18n.js';

// Mismo mapa que usa InstanceDetailView.jsx para la pestaña Contenido —
// copiado acá en vez de importado para no depender de que esa vista lo
// exporte, y porque acá solo hace falta para pintar ícono/etiqueta de
// cada fila de la lista de "no compatibles", nada más.
const CONTENT_TYPE_META = {
  mod: { label: 'Mod', icon: 'package', color: '#2dd4bf' },
  resourcepack: { label: 'Resource Pack', icon: 'image', color: '#38bdf8' },
  shader: { label: 'Shader', icon: 'sparkles', color: '#fbbf24' },
};

/** Fila compacta de un ítem de contenido, para la lista de "no compatibles". */
function ContentRow({ item }) {
  const meta = CONTENT_TYPE_META[item.type] || CONTENT_TYPE_META.mod;
  return (
    <div className="content-row" style={{ cursor: 'default' }}>
      {item.iconUrl ? (
        <img src={item.iconUrl} alt="" className="content-row-icon" />
      ) : (
        <div className="content-row-icon content-row-icon-fallback" style={{ background: meta.color + '26', color: meta.color }}>
          <Icon name={meta.icon} size={17} />
        </div>
      )}
      <div className="content-row-info">
        <div className="content-row-title">{item.projectTitle}</div>
        <div className="content-row-subtitle">{meta.label} · {item.fileName}</div>
      </div>
    </div>
  );
}

/**
 * Ajustes de instancia → Instalación → "Actualizar versión". Asistente de
 * varios pasos, calcado en espíritu del paso "Custom setup" de Crear
 * instancia (mismo selector de loader + versión de MC + versión de
 * loader), pero para una instancia YA EXISTENTE:
 *
 *  1. 'pick' — elegir la versión/loader/versión de loader destino.
 *  2. 'checking' — se le pregunta al proceso principal qué contenido
 *     (mods/resourcepacks/shaders) tiene una versión compatible para ese
 *     destino y cuál no (ver checkVersionUpdatePlan en modInstaller.js).
 *  3. 'incompatible' — SOLO si algo no es compatible: se le muestra la
 *     lista y se le pide que elija entre omitir-y-eliminar / continuar
 *     igual / cancelar. Si todo es compatible (o no hay nada instalado),
 *     este paso se salta directo a 'applying'.
 *  4. 'applying' — se aplica de verdad (descarga las versiones nuevas,
 *     borra o conserva las incompatibles según lo elegido, y al final
 *     pisa mcVersion/loader/loaderVersion de la instancia).
 *  5. 'done' — listo; se avisa al padre (onUpdated) para que recargue la
 *     instancia y se cierra el modal.
 */
export default function UpdateInstanceVersionModal({ instance, onClose, onUpdated, pushToast }) {
  const t = useT();
  const [step, setStep] = useState('pick');

  const [versions, setVersions] = useState([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [mcVersion, setMcVersion] = useState(instance.mcVersion);
  const [loader, setLoader] = useState(instance.loader);
  const [loaderVersions, setLoaderVersions] = useState([]);
  const [channel, setChannel] = useState('stable');
  const [loaderVersion, setLoaderVersion] = useState(instance.loaderVersion || '');
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false);
  const [error, setError] = useState('');

  const [plan, setPlan] = useState(null); // { compatible, incompatible, unmanaged }
  const [progress, setProgress] = useState(null); // último evento de onVersionUpdateProgress

  useEffect(() => {
    window.hardLauncher.versions.list().then((data) => setVersions(data.versions));
  }, []);

  // Mismo mecanismo que CustomSetupStep (CreateInstanceModal.jsx): cada vez
  // que cambia el loader o la versión de MC elegidos, se recarga la lista
  // de versiones de ese loader disponibles para esa versión.
  useEffect(() => {
    setLoaderVersions([]);
    setLoaderVersion('');
    setChannel('stable');
    if (loader === 'vanilla' || !mcVersion) return;

    setLoadingLoaderVersions(true);
    setError('');
    window.hardLauncher.loaders
      .list(loader, mcVersion)
      .then((list) => {
        setLoaderVersions(list);
        const stable = list.find((v) => v.stable);
        if (stable) {
          setChannel('stable');
          setLoaderVersion(stable.version);
        } else if (list[0]) {
          setChannel('latest');
          setLoaderVersion(list[0].version);
        }
      })
      .catch((e) => setError(t('create.loaderVersionsFailed', { error: e.message })))
      .finally(() => setLoadingLoaderVersions(false));
  }, [loader, mcVersion]);

  useEffect(() => {
    if (step !== 'applying') return;
    const unsub = window.hardLauncher.instances.onVersionUpdateProgress?.((data) => setProgress(data));
    return () => unsub?.();
  }, [step]);

  const visibleVersions = versions.filter((v) => showSnapshots || v.type === 'release');
  const stableLoaderVersions = loaderVersions.filter((v) => v.stable);

  function selectChannel(next) {
    setChannel(next);
    if (next === 'stable' && stableLoaderVersions[0]) setLoaderVersion(stableLoaderVersions[0].version);
    else if (next === 'latest' && loaderVersions[0]) setLoaderVersion(loaderVersions[0].version);
  }

  function buildTarget() {
    return {
      mcVersion,
      versionType: versions.find((v) => v.id === mcVersion)?.type || 'release',
      loader,
      loaderVersion: loader !== 'vanilla' ? loaderVersion : null,
    };
  }

  async function handleCheck() {
    if (loader !== 'vanilla' && !loaderVersion) {
      setError(t('verupdate.selectLoaderVersion'));
      return;
    }
    setError('');
    setStep('checking');
    try {
      const result = await window.hardLauncher.instances.checkVersionUpdate(instance.id, buildTarget());
      setPlan(result);
      if (result.incompatible.length > 0) {
        setStep('incompatible');
      } else {
        applyUpdate('continue', result);
      }
    } catch (e) {
      setError(t('verupdate.checkFailed', { error: e.message }));
      setStep('pick');
    }
  }

  async function applyUpdate(decision) {
    setStep('applying');
    setProgress(null);
    try {
      await window.hardLauncher.instances.applyVersionUpdate(instance.id, buildTarget(), decision);
      setStep('done');
      pushToast?.(t('verupdate.done'), 'success');
      onUpdated?.();
      onClose?.();
    } catch (e) {
      pushToast?.(t('verupdate.failed', { error: e.message }), 'error');
      setStep('pick');
    }
  }

  const busy = step === 'checking' || step === 'applying';

  return (
    <motion.div className="modal-overlay" onClick={() => !busy && onClose?.()} {...modalOverlayMotion}>
      <motion.div
        className="card modal-card instance-modal"
        onClick={(e) => e.stopPropagation()}
        {...modalCardMotion}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{t('verupdate.title')}</h3>
            <p className="modal-subtitle">{t('verupdate.subtitle')}</p>
          </div>
          {!busy && (
            <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        {(step === 'pick' || step === 'checking') && (
          <>
            <div className="instance-form-field">
              <label className="instance-form-label">{t('create.loader')}</label>
              <div className="loader-chip-row">
                {LOADERS.map((l) => (
                  <button
                    key={l}
                    type="button"
                    className={'loader-chip' + (loader === l ? ' selected' : '')}
                    onClick={() => setLoader(l)}
                    disabled={busy}
                  >
                    <span className="loader-chip-glyph" style={{ background: LOADER_BADGES[l].color }}>
                      <LoaderGlyph glyph={LOADER_BADGES[l].glyph} size={12} />
                    </span>
                    {l.charAt(0).toUpperCase() + l.slice(1)}
                    {loader === l && <Icon name="check" size={12} strokeWidth={3} />}
                  </button>
                ))}
              </div>
            </div>

            <div className="instance-form-field">
              <label className="instance-form-label">{t('create.mcVersion')}</label>
              <Select
                style={{ width: '100%' }}
                value={mcVersion}
                onChange={setMcVersion}
                disabled={busy}
                options={visibleVersions.map((v) => ({
                  value: v.id,
                  label: `${v.id}${v.type !== 'release' ? ` (${v.type})` : ''}`,
                }))}
              />
              <label className="custom-checkbox-row" style={{ marginTop: 10 }}>
                <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} disabled={busy} />
                <span className="custom-checkbox-box" />
                {t('create.showSnapshots')}
              </label>
            </div>

            {loader !== 'vanilla' && (
              <div className="instance-form-field">
                <label className="instance-form-label">
                  {t('create.loaderVersion', { loader: loader.charAt(0).toUpperCase() + loader.slice(1) })}
                </label>
                {loadingLoaderVersions ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('create.loadingVersions')}</div>
                ) : (
                  <>
                    <div className="loader-channel-tabs">
                      <button
                        type="button"
                        className={'loader-channel-tab' + (channel === 'stable' ? ' selected' : '')}
                        onClick={() => selectChannel('stable')}
                        disabled={busy || stableLoaderVersions.length === 0}
                      >
                        {channel === 'stable' && <Icon name="check" size={12} strokeWidth={3} />}
                        Stable
                      </button>
                      <button
                        type="button"
                        className={'loader-channel-tab' + (channel === 'latest' ? ' selected' : '')}
                        onClick={() => selectChannel('latest')}
                        disabled={busy || loaderVersions.length === 0}
                      >
                        {channel === 'latest' && <Icon name="check" size={12} strokeWidth={3} />}
                        Latest
                      </button>
                      <button
                        type="button"
                        className={'loader-channel-tab' + (channel === 'other' ? ' selected' : '')}
                        onClick={() => selectChannel('other')}
                        disabled={busy || loaderVersions.length === 0}
                      >
                        Other
                      </button>
                    </div>
                    {channel === 'other' && (
                      <Select
                        style={{ width: '100%', marginTop: 10 }}
                        value={loaderVersion}
                        onChange={setLoaderVersion}
                        disabled={busy}
                        options={loaderVersions.map((lv) => ({ value: lv.version, label: lv.version }))}
                      />
                    )}
                  </>
                )}
              </div>
            )}

            {error && <div className="instance-form-error">{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button className="btn-secondary" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </button>
              <button
                className="btn-primary btn-icon-label"
                style={{ flex: 1 }}
                onClick={handleCheck}
                disabled={busy || !mcVersion || loadingLoaderVersions}
              >
                {step === 'checking' ? (
                  <>
                    <Icon name="refresh" size={14} />
                    {t('verupdate.checking')}
                  </>
                ) : (
                  <>
                    <Icon name="refresh" size={14} />
                    {t('verupdate.checkBtn')}
                  </>
                )}
              </button>
            </div>
          </>
        )}

        {step === 'incompatible' && plan && (
          <>
            <div className="instance-form-error" style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <Icon name="alertTriangle" size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  {t('verupdate.incompatibleTitle', { n: plan.incompatible.length })}
                </div>
                <div style={{ fontSize: 12.5 }}>{t('verupdate.incompatibleHint')}</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto', margin: '12px 0' }}>
              <AnimatePresence initial={false}>
                {plan.incompatible.map((item) => (
                  <ContentRow key={item.fileName} item={item} />
                ))}
              </AnimatePresence>
            </div>

            {plan.unmanaged.length > 0 && (
              <p style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 0 }}>
                {t('verupdate.unmanagedNote', { n: plan.unmanaged.length })}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              <button className="btn-danger btn-icon-label" style={{ width: '100%', justifyContent: 'center' }} onClick={() => applyUpdate('omitAndDelete')}>
                <Icon name="trash" size={13} />
                {t('verupdate.omitAndDelete')}
              </button>
              <button className="btn-secondary btn-icon-label" style={{ width: '100%', justifyContent: 'center' }} onClick={() => applyUpdate('continue')}>
                <Icon name="check" size={13} />
                {t('verupdate.continueAnyway')}
              </button>
              <button className="btn-secondary" style={{ width: '100%' }} onClick={onClose}>
                {t('common.cancel')}
              </button>
            </div>
          </>
        )}

        {step === 'applying' && (
          <div style={{ padding: '10px 0 4px' }}>
            <ProgressBar
              label={t('verupdate.applying')}
              hint={progress?.project ? t('verupdate.applyingItem', { project: progress.project }) : null}
            />
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
