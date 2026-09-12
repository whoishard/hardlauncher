import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import Select from './Select.jsx';
import Icon from './Icon.jsx';
import InstanceIconPicker from './InstanceIconPicker.jsx';
import { LoaderGlyph, LOADER_BADGES } from './InstanceIcon.jsx';

// Mismo par overlay+card (fade del fondo, scale+slide de la tarjeta) que
// usa el Modal genérico de Solaris Launcher. Se define una sola vez acá y
// se reutiliza en los 3 modales de la app (éste, AccountModal, SettingsModal)
// para que las transiciones se sientan idénticas en todos lados.
export const modalOverlayMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.22 },
};
export const modalCardMotion = {
  initial: { opacity: 0, scale: 0.96, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 10 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
};

const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

const TYPE_OPTIONS = [
  { id: 'custom', icon: 'layers', titleKey: 'create.customTitle', descKey: 'create.customDesc' },
  { id: 'modpack', icon: 'package', titleKey: 'create.modpackTitle', descKey: 'create.modpackDesc' },
  { id: 'import', icon: 'swap', titleKey: 'create.importTitle', descKey: 'create.importDesc' },
];

/**
 * "Crear instancia" ahora es un asistente de varios pasos en vez de un solo
 * formulario largo, calcado de la pantalla de Modrinth App: primero se
 * elige QUÉ tipo de instancia se quiere (armar una a mano, instalar un
 * modpack, o importar una de otro launcher), y cada camino tiene su propio
 * paso siguiente. `step` guarda en cuál estamos; "Atrás" siempre vuelve al
 * paso anterior sin perder lo ya completado.
 */
export default function CreateInstanceModal({ onClose, onCreated }) {
  const [step, setStep] = useState('type');

  return (
    <motion.div className="modal-overlay" onClick={onClose} {...modalOverlayMotion}>
      <motion.div className="card modal-card instance-modal" onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
        {step === 'type' && <TypeStep onClose={onClose} onPick={setStep} />}
        {step === 'custom' && <CustomSetupStep onClose={onClose} onBack={() => setStep('type')} onCreated={onCreated} />}
        {step === 'modpack' && <ModpackStep onClose={onClose} onBack={() => setStep('type')} onCreated={onCreated} />}
        {step === 'import' && <ImportStep onClose={onClose} onBack={() => setStep('type')} onCreated={onCreated} />}
      </motion.div>
    </motion.div>
  );
}

function ModalHeader({ title, subtitle, onClose }) {
  const t = useT();
  return (
    <div className="modal-header">
      <div>
        <h3 className="modal-title">{title}</h3>
        {subtitle && <p className="modal-subtitle">{subtitle}</p>}
      </div>
      <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')}>
        <Icon name="close" size={15} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paso 1: elegir tipo de instancia
// ---------------------------------------------------------------------------

function TypeStep({ onClose, onPick }) {
  const t = useT();
  return (
    <>
      <ModalHeader title={t('create.title')} onClose={onClose} />
      <div className="instance-type-list">
        <div className="instance-type-list-label">{t('create.pickType')}</div>
        {TYPE_OPTIONS.map((opt) => (
          <button key={opt.id} type="button" className="instance-type-option" onClick={() => onPick(opt.id)}>
            <div className="instance-type-option-icon">
              <Icon name={opt.icon} size={22} />
            </div>
            <div>
              <div className="instance-type-option-title">{t(opt.titleKey)}</div>
              <div className="instance-type-option-desc">{t(opt.descKey)}</div>
            </div>
          </button>
        ))}
      </div>
      <p className="instance-type-hint">{t('create.hint')}</p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Paso 2a: Custom setup
// ---------------------------------------------------------------------------

function CustomSetupStep({ onClose, onBack, onCreated }) {
  const t = useT();
  const [versions, setVersions] = useState([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState(null);
  const [mcVersion, setMcVersion] = useState('');
  const [loader, setLoader] = useState('vanilla');
  const [loaderVersions, setLoaderVersions] = useState([]); // [{ version, stable }]
  const [channel, setChannel] = useState('stable'); // 'stable' | 'latest' | 'other'
  const [loaderVersion, setLoaderVersion] = useState('');
  const [loadingLoaderVersions, setLoadingLoaderVersions] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.hardLauncher.versions.list().then((data) => {
      setVersions(data.versions);
      setMcVersion(data.latest.release);
    });
  }, []);

  // Cada vez que cambia el loader o la versión de MC, se recarga la lista de
  // versiones de loader disponibles. Sin esto el launcher intentaba lanzar
  // con loaderVersion = null y la API de Fabric/Quilt respondía 400.
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
        if (list.length === 0) {
          setError(t('create.noLoaderVersions', { loader, mcVersion }));
          return;
        }
        const stable = list.find((v) => v.stable);
        if (stable) {
          setChannel('stable');
          setLoaderVersion(stable.version);
        } else {
          setChannel('latest');
          setLoaderVersion(list[0].version);
        }
      })
      .catch((e) => setError(t('create.loaderVersionsFailed', { error: e.message })))
      .finally(() => setLoadingLoaderVersions(false));
  }, [loader, mcVersion]);

  const visibleVersions = versions.filter((v) => showSnapshots || v.type === 'release');
  const stableLoaderVersions = loaderVersions.filter((v) => v.stable);

  // Pestañas "Stable / Latest / Other", igual a Modrinth App: Stable y
  // Latest eligen automáticamente la versión correspondiente (no hace falta
  // desplegable); Other deja elegir cualquiera de la lista completa.
  function selectChannel(next) {
    setChannel(next);
    if (next === 'stable' && stableLoaderVersions[0]) setLoaderVersion(stableLoaderVersions[0].version);
    else if (next === 'latest' && loaderVersions[0]) setLoaderVersion(loaderVersions[0].version);
  }

  async function handleCreate() {
    if (loader !== 'vanilla' && !loaderVersion) {
      setError(t('create.selectLoaderVersion'));
      return;
    }
    setCreating(true);
    setError('');
    try {
      const created = await window.hardLauncher.instances.create({
        name: name || `${mcVersion} ${loader !== 'vanilla' ? loader : ''}`.trim(),
        mcVersion,
        versionType: versions.find((v) => v.id === mcVersion)?.type || 'release',
        loader,
        loaderVersion: loader !== 'vanilla' ? loaderVersion : null,
        icon,
      });
      onCreated(created?.id);
    } catch (e) {
      setError(t('create.createFailed', { error: e.message }));
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <ModalHeader title={t('create.title')} onClose={onClose} />

      <div className="instance-form-field">
        <InstanceIconPicker name={name || t('create.namePlaceholder')} loader={loader} value={icon} onChange={setIcon} />
      </div>
      <div className="instance-form-field">
        <label className="instance-form-label">{t('create.name')}</label>
        <input
          style={{ width: '100%' }}
          placeholder={t('create.namePlaceholder')}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="instance-form-field">
        <label className="instance-form-label">{t('create.loader')}</label>
        <div className="loader-chip-row">
          {LOADERS.map((l) => (
            <button
              key={l}
              type="button"
              className={'loader-chip' + (loader === l ? ' selected' : '')}
              onClick={() => setLoader(l)}
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
          options={visibleVersions.map((v) => ({
            value: v.id,
            label: `${v.id}${v.type !== 'release' ? ` (${v.type})` : ''}`,
          }))}
        />
        <label className="custom-checkbox-row" style={{ marginTop: 10 }}>
          <input type="checkbox" checked={showSnapshots} onChange={(e) => setShowSnapshots(e.target.checked)} />
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
                  disabled={stableLoaderVersions.length === 0}
                >
                  {channel === 'stable' && <Icon name="check" size={12} strokeWidth={3} />}
                  Stable
                </button>
                <button
                  type="button"
                  className={'loader-channel-tab' + (channel === 'latest' ? ' selected' : '')}
                  onClick={() => selectChannel('latest')}
                  disabled={loaderVersions.length === 0}
                >
                  {channel === 'latest' && <Icon name="check" size={12} strokeWidth={3} />}
                  Latest
                </button>
                <button
                  type="button"
                  className={'loader-channel-tab' + (channel === 'other' ? ' selected' : '')}
                  onClick={() => selectChannel('other')}
                  disabled={loaderVersions.length === 0}
                >
                  Other
                </button>
              </div>
              {channel === 'other' && (
                <Select
                  style={{ width: '100%', marginTop: 10 }}
                  value={loaderVersion}
                  onChange={setLoaderVersion}
                  options={loaderVersions.map((lv) => ({ value: lv.version, label: lv.version }))}
                />
              )}
            </>
          )}
        </div>
      )}

      {error && <div className="instance-form-error">{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn-secondary btn-icon-label" onClick={onBack}>
          <Icon name="arrowLeft" size={14} />
          {t('common.back')}
        </button>
        <button
          className="btn-primary btn-icon-label"
          style={{ flex: 1 }}
          onClick={handleCreate}
          disabled={creating || !mcVersion || loadingLoaderVersions}
        >
          <Icon name="plus" size={14} />
          {creating ? t('common.creating') : t('create.title')}
        </button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Paso 2b: Install modpack
// ---------------------------------------------------------------------------

function ModpackStep({ onClose, onBack, onCreated }) {
  const t = useT();
  const pushToast = useAppStore((s) => s.pushToast);
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [installingId, setInstallingId] = useState(null);
  const [importingFile, setImportingFile] = useState(false);
  const [error, setError] = useState('');
  // Modpacks más descargados de Modrinth, para mostrar de entrada al hacer
  // foco en el buscador (antes de escribir nada) — igual que cuando un
  // buscador vacío sugiere lo popular en vez de no mostrar nada.
  const [popular, setPopular] = useState([]);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const wrapRef = useRef(null);

  useEffect(() => {
    window.hardLauncher.modrinth
      .search({ projectType: 'modpack', index: 'downloads', limit: 6 })
      .then((data) => setPopular(data.hits || []))
      .catch(() => setPopular([]))
      .finally(() => setLoadingPopular(false));
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setDropdownOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Autocompletado: se busca en Modrinth con un pequeño debounce mientras
  // se escribe, igual que el desplegable "Search for modpack" de Modrinth App.
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      window.hardLauncher.modrinth
        .search({ query, projectType: 'modpack', index: 'relevance', limit: 8 })
        .then((data) => setResults(data.hits || []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function handlePickResult(hit) {
    setInstallingId(hit.project_id);
    setError('');
    try {
      const compatible = await window.hardLauncher.modrinth.versions(hit.project_id, {});
      const withMrpack = compatible.find((v) => (v.files || []).some((f) => f.filename.toLowerCase().endsWith('.mrpack')));
      if (!withMrpack) throw new Error(t('create.noInstallableVersion'));
      const instance = await window.hardLauncher.modrinth.installModpackFromVersion(withMrpack, hit.title);
      pushToast(t('create.installed', { title: hit.title }), 'success');
      onCreated(instance?.id);
    } catch (e) {
      setError(t('create.installFailed', { error: e.message }));
    } finally {
      setInstallingId(null);
    }
  }

  async function handleImportFile() {
    setError('');
    try {
      const filePath = await window.hardLauncher.modrinth.pickMrpackFile();
      if (!filePath) return;
      setImportingFile(true);
      const instance = await window.hardLauncher.modrinth.installModpack(filePath, null);
      pushToast(t('create.installed', { title: instance.name }), 'success');
      onCreated(instance?.id);
    } catch (e) {
      setError(t('create.importFailed', { error: e.message }));
    } finally {
      setImportingFile(false);
    }
  }

  function handleBrowse() {
    onClose();
    navigate('/explore?type=modpack');
  }

  const busy = installingId !== null || importingFile;

  return (
    <>
      <ModalHeader title={t('create.pickModpack')} onClose={onClose} />

      <div className="instance-form-field" ref={wrapRef} style={{ position: 'relative' }}>
        <label className="instance-form-label">{t('create.knowModpack')}</label>
        <div className="modpack-search-input-wrap">
          <input
            style={{ width: '100%' }}
            placeholder={t('create.searchModpack')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setDropdownOpen(true)}
            disabled={busy}
          />
          <Icon name="search" size={14} />
        </div>

        {dropdownOpen && (
          <div className="modpack-search-dropdown">
            {query.trim() ? (
              <>
                {searching && <div className="modpack-search-empty">{t('explore.searching')}</div>}
                {!searching && results.length === 0 && <div className="modpack-search-empty">{t('create.noResults')}</div>}
                {!searching &&
                  results.map((hit) => (
                    <ModpackResultItem key={hit.project_id} hit={hit} busy={busy} installingId={installingId} onPick={handlePickResult} />
                  ))}
              </>
            ) : (
              <>
                <div className="modpack-search-dropdown-heading">{t('create.popular')}</div>
                {loadingPopular && <div className="modpack-search-empty">{t('common.loading')}</div>}
                {!loadingPopular && popular.length === 0 && <div className="modpack-search-empty">{t('create.noSuggestions')}</div>}
                {!loadingPopular &&
                  popular.map((hit) => (
                    <ModpackResultItem key={hit.project_id} hit={hit} busy={busy} installingId={installingId} onPick={handlePickResult} />
                  ))}
              </>
            )}
          </div>
        )}
      </div>

      <div className="instance-modal-or-divider">
        <span />
        {t('common.or')}
        <span />
      </div>

      {error && <div className="instance-form-error">{error}</div>}

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary btn-icon-label" style={{ flex: 1 }} onClick={handleImportFile} disabled={busy}>
          <Icon name="download" size={14} />
          {importingFile ? t('create.importing') : t('create.importModpack')}
        </button>
        <button className="btn-primary btn-icon-label" style={{ flex: 1 }} onClick={handleBrowse} disabled={busy}>
          <Icon name="compass" size={14} />
          {t('create.exploreModpacks')}
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <button className="btn-secondary btn-icon-label" onClick={onBack} disabled={busy}>
          <Icon name="arrowLeft" size={14} />
          {t('common.back')}
        </button>
      </div>
    </>
  );
}

// Fila de resultado reutilizada tanto para la búsqueda en vivo como para
// los "Más descargados" que se muestran de entrada al hacer foco.
function ModpackResultItem({ hit, busy, installingId, onPick }) {
  return (
    <button type="button" className="modpack-search-item" onClick={() => onPick(hit)} disabled={busy}>
      {hit.icon_url ? (
        <img src={hit.icon_url} alt="" />
      ) : (
        <div className="modpack-search-item-fallback">
          <Icon name="package" size={14} />
        </div>
      )}
      <span className="modpack-search-item-title">{hit.title}</span>
      {installingId === hit.project_id && <span className="mini-spinner" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Paso 2c: Import instance
// ---------------------------------------------------------------------------

function ImportStep({ onClose, onBack, onCreated }) {
  const t = useT();
  const pushToast = useAppStore((s) => s.pushToast);
  const [paths, setPaths] = useState([]);
  const [adding, setAdding] = useState(false);
  const [pendingPath, setPendingPath] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  function addPath() {
    const trimmed = pendingPath.trim();
    if (!trimmed) return;
    if (!paths.includes(trimmed)) setPaths((p) => [...p, trimmed]);
    setPendingPath('');
    setAdding(false);
  }

  async function pickFolder() {
    const picked = await window.hardLauncher.instances.pickLauncherFolder();
    if (picked) setPendingPath(picked);
  }

  function removePath(p) {
    setPaths((prev) => prev.filter((x) => x !== p));
  }

  async function handleImport() {
    if (paths.length === 0) return;
    setImporting(true);
    setError('');
    const allImported = [];
    const failures = [];
    for (const launcherPath of paths) {
      try {
        const imported = await window.hardLauncher.instances.importFromLauncherPath(launcherPath);
        allImported.push(...imported);
      } catch (e) {
        failures.push(`${launcherPath}: ${e.message}`);
      }
    }
    setImporting(false);

    if (allImported.length > 0) {
      pushToast(
        allImported.length === 1
          ? t('create.importedOne', { name: allImported[0].name })
          : t('create.importedMany', { n: allImported.length }),
        'success'
      );
    }
    if (failures.length > 0) {
      setError(failures.join('\n'));
    }
    if (allImported.length > 0) {
      onCreated(allImported[0].id);
    }
  }

  return (
    <>
      <ModalHeader title={t('create.importTitle')} onClose={onClose} />

      <div className="instance-form-field">
        <label className="instance-form-label">{t('create.otherLaunchers')}</label>

        {paths.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: adding ? 10 : 0 }}>
            {paths.map((p) => (
              <div key={p} className="import-path-row">
                <Icon name="folder" size={14} />
                <span className="import-path-text">{p}</span>
                <button type="button" className="modal-close-btn" style={{ width: 26, height: 26 }} onClick={() => removePath(p)}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        {adding ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn-secondary" style={{ padding: '0 12px' }} onClick={pickFolder} title={t('create.pickFolder')}>
              <Icon name="folder" size={15} />
            </button>
            <input
              style={{ flex: 1 }}
              placeholder={t('create.launcherPath')}
              value={pendingPath}
              onChange={(e) => setPendingPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addPath()}
              autoFocus
            />
            <button type="button" className="btn-secondary" onClick={addPath} disabled={!pendingPath.trim()}>
              {t('create.add')}
            </button>
          </div>
        ) : (
          <button type="button" className="btn-secondary btn-icon-label" style={{ width: '100%' }} onClick={() => setAdding(true)}>
            <Icon name="plus" size={13} />
            {t('create.addPath')}
          </button>
        )}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>{t('create.importHint')}</p>
      </div>

      {error && <div className="instance-form-error" style={{ whiteSpace: 'pre-line' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button className="btn-secondary btn-icon-label" onClick={onBack} disabled={importing}>
          <Icon name="arrowLeft" size={14} />
          {t('common.back')}
        </button>
        <button
          className="btn-primary btn-icon-label"
          style={{ flex: 1 }}
          onClick={handleImport}
          disabled={importing || paths.length === 0}
        >
          <Icon name="download" size={14} />
          {importing ? t('create.importing') : t('create.import')}
        </button>
      </div>
    </>
  );
}
