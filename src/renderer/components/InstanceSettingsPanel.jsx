import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import InstanceIconPicker from './InstanceIconPicker.jsx';
import MemorySlider from './MemorySlider.jsx';
import Icon from './Icon.jsx';
import { modalOverlayMotion, modalCardMotion } from './CreateInstanceModal.jsx';
import { useT } from '../i18n.js';

function getNavItems(t) {
  return [
    { id: 'general', label: t('iset.general'), icon: 'info' },
    { id: 'installation', label: t('iset.installation'), icon: 'wrench' },
    { id: 'window', label: t('iset.window'), icon: 'monitor' },
    { id: 'java', label: t('iset.java'), icon: 'cpu' },
    { id: 'hooks', label: t('iset.hooks'), icon: 'code' },
  ];
}

/** Fila "Custom X" con toggle: título + descripción a la izquierda, switch a la derecha. */
function ToggleCard({ title, hint, checked, onChange, children }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: hint ? 4 : 0 }}>{title}</div>
          {hint && <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{hint}</div>}
        </div>
        <div className={'toggle' + (checked ? ' on' : '')} onClick={() => onChange(!checked)} />
      </div>
      {children && (
        <div style={{ marginTop: 14, opacity: checked ? 1 : 0.45, pointerEvents: checked ? 'auto' : 'none' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function KeyValueRow({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--border-subtle)', fontSize: 13 }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

/**
 * Ajustes de una instancia, como un apartado propio que se abre por encima
 * del launcher (modal), en vez de vivir mezclado entre las demás pestañas
 * de la instancia (Contenido/Mundos/Capturas/Consola) — separarlo así se ve
 * mejor y es más cómodo: se abre con la tuerca, se edita, se cierra, y se
 * vuelve exactamente a donde se estaba. Reutiliza el mismo patrón de modal
 * que "Crear instancia" (.modal-overlay + .modal-card), con navegación
 * lateral de pestañas adentro (General / Instalación / Ventana / Java y
 * memoria / Hooks de lanzamiento), igual al panel de Modrinth App.
 */
export default function InstanceSettingsPanel({ instance, onClose, onSaved, navigate, pushToast }) {
  const t = useT();
  const NAV_ITEMS = getNavItems(t);
  const { settings, loadSettings, removeInstance } = useAppStore();
  const [section, setSection] = useState('general');

  const [name, setName] = useState(instance.name);
  const [icon, setIcon] = useState(instance.icon || null);

  const [customWindow, setCustomWindow] = useState(!!instance.customWindow);
  const [fullscreen, setFullscreen] = useState(!!instance.fullscreen);
  const [resW, setResW] = useState(instance.resolutionWidth);
  const [resH, setResH] = useState(instance.resolutionHeight);

  const [customJava, setCustomJava] = useState(!!instance.customJava);
  const [javaPath, setJavaPath] = useState(instance.javaPath || '');
  const [customMemory, setCustomMemory] = useState(!!instance.customMemory);
  const [memoryMin, setMemoryMin] = useState(instance.memoryMin);
  const [memoryMax, setMemoryMax] = useState(instance.memoryMax);
  const [customJvmArgs, setCustomJvmArgs] = useState(!!instance.customJvmArgs);
  const [jvmArgs, setJvmArgs] = useState(instance.jvmArgs || '');
  const [customEnvVars, setCustomEnvVars] = useState(!!instance.customEnvVars);
  const [envVars, setEnvVars] = useState(instance.envVars || '');

  const [customHooks, setCustomHooks] = useState(!!instance.customHooks);
  const [preLaunchHook, setPreLaunchHook] = useState(instance.preLaunchHook || '');
  const [wrapperHook, setWrapperHook] = useState(instance.wrapperHook || '');
  const [postExitHook, setPostExitHook] = useState(instance.postExitHook || '');

  const [maxSystemMemory, setMaxSystemMemory] = useState(16384);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [repairing, setRepairing] = useState(false);

  useEffect(() => {
    window.hardLauncher.system.getTotalMemoryMB().then(setMaxSystemMemory);
    if (!settings) loadSettings();
  }, []);

  async function save() {
    setSaving(true);
    try {
      await window.hardLauncher.instances.update(instance.id, {
        name: name.trim() || instance.name,
        icon,
        customWindow,
        fullscreen,
        resolutionWidth: Number(resW),
        resolutionHeight: Number(resH),
        customJava,
        javaPath: customJava ? javaPath || null : null,
        customMemory,
        memoryMin: Number(memoryMin),
        memoryMax: Number(memoryMax),
        customJvmArgs,
        jvmArgs,
        customEnvVars,
        envVars,
        customHooks,
        preLaunchHook,
        wrapperHook,
        postExitHook,
      });
      onSaved();
      pushToast?.(t('iset.saved'), 'success');
    } finally {
      setSaving(false);
    }
  }

  // BUG FIX: antes esto llamaba directo a window.hardLauncher.instances.delete
  // (el IPC crudo), sin pasar por removeInstance() del store global. Ese IPC
  // borra la instancia en disco/electron-store, pero nunca actualiza el
  // array `instances` que Sidebar, Inicio e Instancias leen del store — así
  // que la instancia borrada seguía apareciendo en todos lados hasta que
  // alguna otra acción disparara un refreshInstances() (por ejemplo, entrar
  // a la vista de detalle de otra instancia). removeInstance() ya hace el
  // borrado optimista: saca la instancia del store al instante y recién
  // después dispara el borrado real, igual que el mismo botón "Eliminar"
  // del menú de la tarjeta en Instancias/Inicio.
  async function handleDelete() {
    setDeleting(true);
    try {
      await removeInstance(instance.id);
      pushToast?.(t('instances.deleted', { name: instance.name }), 'info');
      onClose?.();
      navigate('/instances');
    } catch (e) {
      pushToast?.(t('instances.deleteFailed', { error: e.message }), 'error');
      setDeleting(false);
    }
  }

  async function handleDuplicate() {
    setDuplicating(true);
    try {
      const copy = await window.hardLauncher.instances.duplicate(instance.id);
      pushToast?.(t('iset.duplicated', { name: copy.name }), 'success');
      onClose?.();
      navigate(`/instances/${copy.id}`);
    } catch (e) {
      pushToast?.(t('iset.dupFailed', { error: e.message }), 'error');
    } finally {
      setDuplicating(false);
    }
  }

  async function handleRepair() {
    setRepairing(true);
    const unsubLog = window.hardLauncher.instances.onRepairLog?.(() => {});
    try {
      await window.hardLauncher.instances.repair(instance.id);
      pushToast?.(t('iset.repaired'), 'success');
      onSaved();
    } catch (e) {
      pushToast?.(t('iset.repairFailed', { error: e.message }), 'error');
    } finally {
      unsubLog?.();
      setRepairing(false);
    }
  }

  async function pickInstanceJava() {
    const picked = await window.hardLauncher.settings.pickJavaExecutable();
    if (picked) setJavaPath(picked);
  }

  const defaultMemMin = settings?.defaultMemoryMin ?? 1024;
  const defaultMemMax = settings?.defaultMemoryMax ?? 4096;
  const defaultResW = settings?.defaultResolutionWidth ?? 854;
  const defaultResH = settings?.defaultResolutionHeight ?? 480;

  return (
    <motion.div className="modal-overlay" onClick={() => !confirmingDelete && onClose?.()} {...modalOverlayMotion}>
      <motion.div
        className="card modal-card instance-settings-modal"
        onClick={(e) => e.stopPropagation()}
        {...modalCardMotion}
      >
        <div className="modal-header">
          <div>
            <p className="instance-settings-breadcrumb">
              {t('iset.breadcrumb', { name: instance.name })}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="settings-layout instance-settings-layout" style={{ gridTemplateColumns: '200px 1fr' }}>
          <nav>
            <div className="settings-nav-group">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  className={'settings-nav-item' + (section === item.id ? ' active' : '')}
                  onClick={() => setSection(item.id)}
                >
                  <Icon name={item.icon} size={16} />
                  {item.label}
                </button>
              ))}
            </div>
          </nav>

          <div className="instance-settings-modal-body">
            {section === 'general' && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="instance-form-field" style={{ marginBottom: 14 }}>
                <InstanceIconPicker name={name || instance.name} loader={instance.loader} value={icon} onChange={setIcon} />
              </div>
              <div className="instance-form-field" style={{ marginBottom: 0 }}>
                <label className="instance-form-label">{t('iset.name')}</label>
                <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} />
              </div>
            </div>

            <div className="card" style={{ marginBottom: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('iset.duplicate')}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  {t('iset.duplicateHint')}
                </div>
              </div>
              <button className="btn-secondary btn-icon-label" onClick={handleDuplicate} disabled={duplicating}>
                <Icon name="copy" size={14} />
                {duplicating ? t('iset.duplicating') : t('iset.dupBtn')}
              </button>
            </div>

            <div className="danger-zone" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div className="danger-zone-title">{t('iset.delete')}</div>
                <div className="danger-zone-hint" style={{ maxWidth: 'none' }}>
                  {t('iset.deleteHint')}
                </div>
              </div>
              <button type="button" className="btn-danger" onClick={() => setConfirmingDelete(true)}>
                <Icon name="trash" size={14} />
                {t('common.delete')}
              </button>
            </div>
          </div>
        )}

        {section === 'installation' && (
          <div>
            <div className="card" style={{ marginBottom: 14 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{t('iset.installInfo')}</div>
              <KeyValueRow label={t('iset.platform')} value={instance.loader} />
              <KeyValueRow label={t('iset.gameVersion')} value={instance.mcVersion} />
              {instance.loader !== 'vanilla' && (
                <KeyValueRow label={t('iset.loaderVersion', { loader: instance.loader })} value={instance.loaderVersion || t('common.automatic')} />
              )}
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
                {t('iset.installLocked')}
              </p>
            </div>

            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{t('iset.repair')}</div>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 0, marginBottom: 12 }}>
                {t('iset.repairHint')}
              </p>
              <button className="btn-secondary btn-icon-label" onClick={handleRepair} disabled={repairing}>
                <Icon name="refresh" size={14} />
                {repairing ? t('iset.repairing') : t('iset.repairBtn')}
              </button>
            </div>
          </div>
        )}

        {section === 'window' && (
          <div>
            <ToggleCard
              title={t('iset.customWindow')}
              hint={t('iset.customWindowHint')}
              checked={customWindow}
              onChange={setCustomWindow}
            />

            <div className="card" style={{ marginBottom: 14, opacity: customWindow ? 1 : 0.45, pointerEvents: customWindow ? 'auto' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('iset.fullscreen')}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {t('iset.fullscreenHint')}
                  </div>
                </div>
                <div className={'toggle' + (fullscreen ? ' on' : '')} onClick={() => setFullscreen(!fullscreen)} />
              </div>
            </div>

            <div className="card" style={{ opacity: customWindow && !fullscreen ? 1 : 0.45, pointerEvents: customWindow && !fullscreen ? 'auto' : 'none' }}>
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('settings.width')}</label>
              <input type="number" value={resW} onChange={(e) => setResW(e.target.value)} placeholder={String(defaultResW)} style={{ width: '100%', marginBottom: 12 }} />
              <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'block', marginBottom: 6 }}>{t('settings.height')}</label>
              <input type="number" value={resH} onChange={(e) => setResH(e.target.value)} placeholder={String(defaultResH)} style={{ width: '100%' }} />
            </div>
          </div>
        )}

        {section === 'java' && (
          <div>
            <ToggleCard
              title={t('iset.customJava')}
              hint={t('iset.customJavaHint')}
              checked={customJava}
              onChange={setCustomJava}
            >
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={javaPath}
                  onChange={(e) => setJavaPath(e.target.value)}
                  placeholder={t('iset.javaPath')}
                  style={{ flex: 1 }}
                />
                <button className="btn-secondary" type="button" onClick={pickInstanceJava}>
                  {t('common.pick')}
                </button>
              </div>
            </ToggleCard>

            <ToggleCard
              title={t('iset.customMem')}
              hint={t('iset.customMemHint', { min: defaultMemMin, max: defaultMemMax })}
              checked={customMemory}
              onChange={setCustomMemory}
            >
              <MemorySlider label={t('settings.memMin')} value={memoryMin} min={512} max={maxSystemMemory} step={256} onChange={setMemoryMin} />
              <div style={{ height: 16 }} />
              <MemorySlider label={t('settings.memMax')} value={memoryMax} min={512} max={maxSystemMemory} step={256} onChange={setMemoryMax} />
            </ToggleCard>

            <ToggleCard
              title={t('iset.customJvm')}
              checked={customJvmArgs}
              onChange={setCustomJvmArgs}
            >
              <input value={jvmArgs} onChange={(e) => setJvmArgs(e.target.value)} placeholder="-XX:+UseG1GC" style={{ width: '100%' }} />
            </ToggleCard>

            <ToggleCard
              title={t('iset.customEnv')}
              checked={customEnvVars}
              onChange={setCustomEnvVars}
            >
              <textarea
                value={envVars}
                onChange={(e) => setEnvVars(e.target.value)}
                placeholder={'UNA_VARIABLE=valor\nOTRA_VARIABLE=valor'}
                rows={3}
                style={{ width: '100%', resize: 'vertical', fontFamily: 'monospace', fontSize: 12.5 }}
              />
            </ToggleCard>
          </div>
        )}

        {section === 'hooks' && (
          <div>
            <ToggleCard
              title={t('iset.customHooks')}
              hint={t('iset.customHooksHint')}
              checked={customHooks}
              onChange={setCustomHooks}
            >
              <div className="instance-form-field" style={{ marginBottom: 14 }}>
                <label className="instance-form-label">{t('iset.preLaunch')}</label>
                <input value={preLaunchHook} onChange={(e) => setPreLaunchHook(e.target.value)} placeholder={t('iset.preLaunchPh')} style={{ width: '100%' }} />
              </div>
              <div className="instance-form-field" style={{ marginBottom: 14 }}>
                <label className="instance-form-label">{t('iset.wrapper')}</label>
                <input value={wrapperHook} onChange={(e) => setWrapperHook(e.target.value)} placeholder={t('iset.wrapperPh')} style={{ width: '100%' }} />
              </div>
              <div className="instance-form-field" style={{ marginBottom: 0 }}>
                <label className="instance-form-label">{t('iset.postExit')}</label>
                <input value={postExitHook} onChange={(e) => setPostExitHook(e.target.value)} placeholder={t('iset.postExitPh')} style={{ width: '100%' }} />
              </div>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 12, marginBottom: 0 }}>
                {t('iset.hooksFolder')}
              </p>
            </ToggleCard>
          </div>
        )}
          </div>
        </div>

        <div className="instance-settings-savebar instance-settings-modal-savebar">
          <button className="btn-primary" style={{ width: '100%' }} onClick={save} disabled={saving}>
            {saving ? t('common.saving') : t('iset.save')}
          </button>
        </div>

        {/* AnimatePresence local (no hace falta el del padre: este overlay
            se monta/desmonta dentro de un componente que ya sigue vivo)
            para que la confirmación de borrado también entre/salga
            animada en vez de aparecer de golpe encima del panel de ajustes. */}
        <AnimatePresence>
          {confirmingDelete && (
            <motion.div className="modal-overlay" onClick={() => !deleting && setConfirmingDelete(false)} {...modalOverlayMotion}>
              <motion.div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
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
                  <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmingDelete(false)} disabled={deleting}>
                    {t('common.cancel')}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
