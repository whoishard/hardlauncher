import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import Select from './Select.jsx';
import Icon from './Icon.jsx';
import InstanceIconPicker from './InstanceIconPicker.jsx';
import { LoaderGlyph, LOADER_BADGES } from './InstanceIcon.jsx';
import { composeIconDataUrl, BACKGROUND_SWATCHES, RUBY_COLOR_SWATCHES } from './iconStudioData.js';
import prismLogo from '../assets/launchers/prism.webp';
import multimcLogo from '../assets/launchers/multimc.png';
import polymcLogo from '../assets/launchers/polymc.png';
import curseforgeLogo from '../assets/launchers/curseforge.webp';
import modrinthLogo from '../assets/launchers/modrinth.png';

// "1.07M" / "193.2K" / "842": mismo formato compacto de descargas que usa
// Modrinth, calcado de formatCount() en ProjectDetailView.jsx (no se
// importa de ahí para no crear una dependencia circular con este archivo,
// que ProjectDetailView ya importa para modalOverlayMotion/modalCardMotion).
function formatDownloadCount(n) {
  const num = n || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(num);
}

// Fecha relativa compacta ("hace 5d", "hace 3sem"...), calcada de
// formatRelativeDate() en ProjectDetailView.jsx por el mismo motivo de
// arriba.
function formatVersionDate(dateStr) {
  if (!dateStr) return '';
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

function capitalizeWord(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

const VERSION_CHANNEL_LABEL = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };

// Logo real de cada launcher soportado por el importador (ver
// launcherDefinitions en src/core/launcherImporter.js — el `id` de cada
// entrada tiene que coincidir con las claves de acá). Los que no están en
// este mapa (por ahora ninguno, pero por ejemplo una carpeta elegida a mano
// con "Buscar en otra carpeta") siguen usando el ícono de línea genérico
// (`source.icon`, ver más abajo).
const LAUNCHER_LOGOS = {
  prism: prismLogo,
  multimc: multimcLogo,
  polymc: polymcLogo,
  curseforge: curseforgeLogo,
  modrinth: modrinthLogo,
};

// Antes todos los logos iban sobre el mismo fondo blanco liso (necesario
// porque el anvil de CurseForge, por ejemplo, es un glifo de un solo color
// sólido y quedaba invisible sobre el degradé oscuro genérico) — pero ese
// blanco parejo para todos quedaba como un parche pegado encima del logo en
// vez de un fondo que combine con él. Ahora cada uno tiene su propio fondo
// a tono con sus colores de marca (el naranja de CurseForge, el verde muy
// oscuro de Modrinth, etc.), manteniendo igual contraste suficiente para
// que el glifo se siga viendo bien. Los que no tienen logo en el mapa de
// arriba (ninguno por ahora) siguen usando el fondo blanco por defecto de
// `.launcher-detect-icon.has-logo` en theme.css.
const LAUNCHER_LOGO_BG = {
  curseforge: 'linear-gradient(155deg, #1a1a1a, #000000)',
  modrinth: 'linear-gradient(155deg, #17291d, #0b1510)',
  prism: 'linear-gradient(155deg, #f5f5f6, #dcdde1)',
  multimc: 'linear-gradient(155deg, #f2e4d0, #ddc39b)',
  polymc: 'linear-gradient(155deg, #ebf3db, #cee497)',
};

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

// Exportado (además de usarse acá abajo) para que UpdateInstanceVersionModal.jsx
// pueda armar el mismo selector de loader al cambiar la versión de una
// instancia ya existente, sin duplicar esta lista en dos archivos.
export const LOADERS = ['vanilla', 'fabric', 'forge', 'neoforge', 'quilt'];

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
  // true mientras `icon` sigue siendo el generado al azar al abrir este paso
  // (ver el useEffect de más abajo) y el usuario todavía no lo tocó — se usa
  // solo para mostrar el texto correcto en InstanceIconPicker ("ícono
  // aleatorio asignado" vs. "imagen personalizada aplicada").
  const [iconIsRandomDefault, setIconIsRandomDefault] = useState(true);
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

  // Antes esta pantalla arrancaba con `icon: null`, así que el preview
  // mostraba siempre el mismo cuadradito gris con el glifo de caja genérico
  // (ver InstanceIcon.jsx) hasta que el usuario entraba al Estudio a mano.
  // Ahora se genera un ícono al azar apenas se abre el paso, con exactamente
  // la misma paleta de fondos y de colores de rubí del botón "Aleatorio"
  // del Estudio (ver randomize() en IconStudioModal.jsx) — así cada
  // instancia nueva ya arranca con un rubí propio y reconocible en la
  // grilla, sin que haga falta abrir "Editar ícono" a mano. El símbolo en
  // sí (el rubí) es siempre el mismo; lo único que varía es de qué color
  // sale el fondo y de qué color sale el rubí. El usuario sigue pudiendo
  // cambiarlo (Editar ícono) o sacarlo (Quitar, ver InstanceIconPicker.jsx)
  // si prefiere el default plano.
  useEffect(() => {
    const bg = BACKGROUND_SWATCHES[Math.floor(Math.random() * BACKGROUND_SWATCHES.length)];
    const rubyColor = RUBY_COLOR_SWATCHES[Math.floor(Math.random() * RUBY_COLOR_SWATCHES.length)];
    composeIconDataUrl(bg, rubyColor)
      .then(setIcon)
      .catch(() => {}); // si falla, se queda con el default plano — no rompe el resto del formulario
  }, []);

  function handleIconChange(next) {
    setIcon(next);
    setIconIsRandomDefault(false);
  }

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
        <InstanceIconPicker
          name={name || t('create.namePlaceholder')}
          loader={loader}
          value={icon}
          onChange={handleIconChange}
          isRandomDefault={iconIsRandomDefault}
        />
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
  // Modpack elegido de la búsqueda/populares cuyo listado de versiones se
  // está mostrando para que el usuario elija cuál instalar, en vez de
  // instalar directo la más nueva (ver handlePickResult más abajo).
  const [pickedHit, setPickedHit] = useState(null);
  const [pickedVersions, setPickedVersions] = useState([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  // Buscador + filtros del listado de versiones instalables de un modpack
  // elegido (ver pickedVersions arriba): antes se mostraban todas apiladas
  // sin forma de acotar por nombre, versión de Minecraft o canal, y con
  // modpacks que tienen muchas versiones (ver captura: "Fresh & Smooth")
  // quedaba desordenado y difícil de encontrar la que se busca.
  const [versionQuery, setVersionQuery] = useState('');
  const [versionMcFilter, setVersionMcFilter] = useState('');
  const [versionChannelFilter, setVersionChannelFilter] = useState([]);

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

  // Antes esto instalaba directo la primera versión con .mrpack que
  // encontraba (la más nueva compatible), sin dejarle al usuario elegir
  // otra — por ejemplo una versión anterior del modpack, o la misma
  // release pero para otra versión de Minecraft. Ahora solo trae el
  // listado de versiones instalables y las muestra (ver pickedHit más
  // abajo); la instalación en sí queda en handleInstallVersion, recién
  // cuando el usuario elige una fila concreta.
  async function handlePickResult(hit) {
    setError('');
    setPickedHit(hit);
    setPickedVersions([]);
    setVersionQuery('');
    setVersionMcFilter('');
    setVersionChannelFilter([]);
    setLoadingVersions(true);
    try {
      const compatible = await window.hardLauncher.modrinth.versions(hit.project_id, {});
      const withMrpack = compatible.filter((v) => (v.files || []).some((f) => f.filename.toLowerCase().endsWith('.mrpack')));
      if (!withMrpack.length) throw new Error(t('create.noInstallableVersion'));
      setPickedVersions(withMrpack);
    } catch (e) {
      setError(t('create.installFailed', { error: e.message }));
      setPickedHit(null);
    } finally {
      setLoadingVersions(false);
    }
  }

  async function handleInstallVersion(version) {
    setInstallingId(version.id);
    setError('');
    try {
      const instance = await window.hardLauncher.modrinth.installModpackFromVersion(version, pickedHit.title);
      pushToast(t('create.installed', { title: pickedHit.title }), 'success');
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

  // Paso intermedio: ya se eligió el modpack (de la búsqueda o de
  // populares), pero todavía no la versión — se muestra el listado en vez
  // de saltar directo al form de búsqueda de arriba.
  if (pickedHit) {
    // Opciones para el filtro de versión de Minecraft, en el mismo orden en
    // que ya vienen (más nueva primero) en vez de reordenarlas alfabético.
    const allVersionMcOptions = [];
    for (const v of pickedVersions) {
      for (const gv of v.game_versions || []) {
        if (!allVersionMcOptions.includes(gv)) allVersionMcOptions.push(gv);
      }
    }
    const allVersionChannels = [];
    for (const v of pickedVersions) {
      const c = v.version_type || 'release';
      if (!allVersionChannels.includes(c)) allVersionChannels.push(c);
    }

    const q = versionQuery.trim().toLowerCase();
    const filteredVersions = pickedVersions.filter((v) => {
      if (versionMcFilter && !(v.game_versions || []).includes(versionMcFilter)) return false;
      if (versionChannelFilter.length && !versionChannelFilter.includes(v.version_type || 'release')) return false;
      if (!q) return true;
      const haystack = [v.name, v.version_number, ...(v.game_versions || [])].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(q);
    });
    const hasActiveVersionFilters = versionMcFilter !== '' || versionChannelFilter.length > 0;

    function toggleVersionChannel(c) {
      setVersionChannelFilter((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
    }
    function clearVersionFilters() {
      setVersionQuery('');
      setVersionMcFilter('');
      setVersionChannelFilter([]);
    }

    return (
      <>
        <ModalHeader title={pickedHit.title} subtitle={t('create.pickVersion')} onClose={onClose} />

        {error && <div className="instance-form-error">{error}</div>}

        {!loadingVersions && pickedVersions.length > 0 && (
          <div className="modpack-version-filters">
            <div className="modpack-search-input-wrap">
              <input
                style={{ width: '100%' }}
                placeholder={t('create.searchVersion')}
                value={versionQuery}
                onChange={(e) => setVersionQuery(e.target.value)}
                disabled={installingId !== null}
              />
              <Icon name="search" size={14} />
            </div>

            <div className="modpack-version-filter-row">
              {allVersionMcOptions.length > 1 && (
                <Select
                  value={versionMcFilter}
                  onChange={setVersionMcFilter}
                  options={[{ value: '', label: t('create.allGameVersions') }, ...allVersionMcOptions.map((gv) => ({ value: gv, label: gv }))]}
                  style={{ minWidth: 150 }}
                />
              )}
              {allVersionChannels.length > 1 &&
                allVersionChannels.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className={'chip' + (versionChannelFilter.includes(c) ? ' active' : '')}
                    onClick={() => toggleVersionChannel(c)}
                  >
                    {VERSION_CHANNEL_LABEL[c] || capitalizeWord(c)}
                  </button>
                ))}
              {hasActiveVersionFilters && (
                <button type="button" className="clear-filters-btn versions-clear-btn" onClick={clearVersionFilters}>
                  <Icon name="close" size={11} strokeWidth={2.2} />
                  {t('filter.clear')}
                </button>
              )}
            </div>
          </div>
        )}

        {loadingVersions ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 2px', fontSize: 12.5, color: 'var(--text-muted)' }}>
            <span className="mini-spinner" />
            {t('common.loading')}
          </div>
        ) : filteredVersions.length === 0 ? (
          <div className="card" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            {t('create.noVersionMatch')}
          </div>
        ) : (
          <div className="import-instance-list modpack-version-list">
            {filteredVersions.map((v) => (
              <button
                key={v.id}
                type="button"
                className="import-instance-row modpack-version-row"
                onClick={() => handleInstallVersion(v)}
                disabled={installingId !== null}
              >
                <span
                  className={'version-type-dot type-' + (v.version_type || 'release')}
                  title={VERSION_CHANNEL_LABEL[v.version_type] || v.version_type}
                >
                  {(v.version_type || '?').charAt(0).toUpperCase()}
                </span>

                <div className="import-instance-row-info">
                  <div className="import-instance-row-name">{v.name || v.version_number}</div>
                  <div className="import-instance-row-meta modpack-version-badges">
                    {(v.game_versions || []).slice(0, 3).map((gv) => (
                      <span key={gv} className="badge badge-sm">{gv}</span>
                    ))}
                    {(v.game_versions || []).length > 3 && (
                      <span className="badge badge-sm">+{v.game_versions.length - 3}</span>
                    )}
                    {(v.loaders || []).map((l) => (
                      <span key={l} className="badge badge-sm badge-loader">{capitalizeWord(l)}</span>
                    ))}
                  </div>
                </div>

                <span className="version-date">{formatVersionDate(v.date_published)}</span>
                {v.downloads != null && <span className="version-downloads">{formatDownloadCount(v.downloads)}</span>}

                {installingId === v.id && <span className="mini-spinner" />}
              </button>
            ))}
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <button
            className="btn-secondary btn-icon-label"
            onClick={() => {
              setPickedHit(null);
              setError('');
            }}
            disabled={installingId !== null}
          >
            <Icon name="arrowLeft" size={14} />
            {t('common.back')}
          </button>
        </div>
      </>
    );
  }

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

// Nombre "lindo" de una carpeta agregada a mano, para el header del paso de
// selección — no se puede usar el `path` de Node en el renderer, así que se
// arma a mano en vez de con path.basename().
function folderLabel(p) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || p;
}

/**
 * Paso "Importar instancia": arranca revisando solo qué launchers
 * compatibles (Prism, MultiMC, PolyMC, CurseForge, Modrinth App) están
 * instalados en esta PC, en sus ubicaciones por defecto. El usuario elige
 * uno de la lista (o agrega otra carpeta a mano) y ahí sí ve, con
 * checkboxes, cuáles de las instancias que se le encontraron adentro quiere
 * traer — en vez del flujo anterior, que traía TODO lo que hubiera bajo la
 * carpeta sin poder elegir.
 */
function ImportStep({ onClose, onBack, onCreated }) {
  const t = useT();
  const pushToast = useAppStore((s) => s.pushToast);
  const [detecting, setDetecting] = useState(true);
  const [detected, setDetected] = useState([]);
  const [customSources, setCustomSources] = useState([]);
  const [scanningCustom, setScanningCustom] = useState(false);
  const [activeSource, setActiveSource] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    window.hardLauncher.instances
      .detectLaunchers()
      .then((found) => setDetected(found || []))
      .catch(() => setDetected([]))
      .finally(() => setDetecting(false));
  }, []);

  function openSource(source) {
    setActiveSource(source);
    // Todas tildadas de entrada: lo más cómodo para el caso común (traer
    // todo lo que encontró), el usuario destilda lo que no quiera.
    setChecked(new Set(source.instances.map((i) => i.dir)));
    setError('');
  }

  function toggleDir(dir) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }

  function toggleAll() {
    if (!activeSource) return;
    setChecked((prev) =>
      prev.size === activeSource.instances.length ? new Set() : new Set(activeSource.instances.map((i) => i.dir))
    );
  }

  async function pickCustomFolder() {
    const picked = await window.hardLauncher.instances.pickLauncherFolder();
    if (!picked) return;
    setScanningCustom(true);
    setError('');
    try {
      const instances = await window.hardLauncher.instances.scanLauncherFolder(picked);
      const source = { id: `custom:${picked}`, name: folderLabel(picked), icon: 'folder', path: picked, instances };
      setCustomSources((prev) => [...prev.filter((s) => s.path !== picked), source]);
      openSource(source);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanningCustom(false);
    }
  }

  async function handleImport() {
    if (checked.size === 0) return;
    setImporting(true);
    setError('');
    try {
      const imported = await window.hardLauncher.instances.importSelected(Array.from(checked));
      if (imported.length > 0) {
        pushToast(
          imported.length === 1 ? t('create.importedOne', { name: imported[0].name }) : t('create.importedMany', { n: imported.length }),
          'success'
        );
        onCreated(imported[0].id);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setImporting(false);
    }
  }

  const instanceCountLabel = (n) => (n === 0 ? t('create.noInstancesFound') : n === 1 ? t('create.instanceFoundOne') : t('create.instancesFoundMany', { n }));

  return (
    <>
      <ModalHeader title={t('create.importTitle')} onClose={onClose} />

      {!activeSource && (
        <>
          <div className="instance-form-field">
            <label className="instance-form-label">{t('create.detectedLaunchers')}</label>
            {detecting ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 2px', fontSize: 12.5, color: 'var(--text-muted)' }}>
                <span className="mini-spinner" />
                {t('create.detecting')}
              </div>
            ) : detected.length === 0 ? (
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>{t('create.noLaunchersDetected')}</p>
            ) : (
              <div className="launcher-detect-grid">
                {detected.map((source) => (
                  <button key={source.id} type="button" className="launcher-detect-item" onClick={() => openSource(source)}>
                    <div
                      className={'launcher-detect-icon' + (LAUNCHER_LOGOS[source.id] ? ' has-logo' : '')}
                      style={LAUNCHER_LOGO_BG[source.id] ? { background: LAUNCHER_LOGO_BG[source.id] } : undefined}
                    >
                      {LAUNCHER_LOGOS[source.id] ? (
                        <img className="launcher-detect-logo" src={LAUNCHER_LOGOS[source.id]} alt="" />
                      ) : (
                        <Icon name={source.icon} size={18} />
                      )}
                    </div>
                    <div>
                      <div className="launcher-detect-name">{source.name}</div>
                      <div className="launcher-detect-count">{instanceCountLabel(source.instances.length)}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {customSources.length > 0 && (
            <div className="instance-form-field">
              <label className="instance-form-label">{t('create.customFolders')}</label>
              <div className="launcher-detect-grid">
                {customSources.map((source) => (
                  <button key={source.id} type="button" className="launcher-detect-item" onClick={() => openSource(source)}>
                    <div className="launcher-detect-icon">
                      <Icon name="folder" size={18} />
                    </div>
                    <div>
                      <div className="launcher-detect-name">{source.name}</div>
                      <div className="launcher-detect-count">{instanceCountLabel(source.instances.length)}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button type="button" className="btn-secondary btn-icon-label" style={{ width: '100%' }} onClick={pickCustomFolder} disabled={scanningCustom}>
            <Icon name="plus" size={13} />
            {scanningCustom ? t('create.detecting') : t('create.addPath')}
          </button>

          <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>{t('create.importHint')}</p>
        </>
      )}

      {activeSource && (
        <div className="instance-form-field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <label className="instance-form-label" style={{ margin: 0 }}>
              {activeSource.name}
            </label>
            {activeSource.instances.length > 0 && (
              <label className="custom-checkbox-row" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={checked.size === activeSource.instances.length} onChange={toggleAll} />
                <span className="custom-checkbox-box" />
                {t('create.selectAll')}
              </label>
            )}
          </div>

          {activeSource.instances.length === 0 ? (
            <>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', margin: 0 }}>{t('create.noInstancesFound')}</p>
              {/* BUG FIX: antes, si algo fallaba leyendo Modrinth (app.db no
                  se pudo abrir, sql.js no cargó, etc.) la única señal para
                  el usuario era este mismo mensaje genérico — el motivo real
                  quedaba en un console.error que nadie ve en la app
                  empaquetada. Ahora, si el importador dejó algún detalle
                  (ver `debug` en launcherImporter.js), se muestra acá. */}
              {activeSource.debug?.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.08)',
                  }}
                >
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 4px' }}>{t('create.importDebugTitle')}</p>
                  {activeSource.debug.map((msg, i) => (
                    <p key={i} style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-secondary)', margin: '2px 0', wordBreak: 'break-word' }}>
                      {msg}
                    </p>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="import-instance-list">
              {activeSource.instances.map((inst) => {
                const badge = LOADER_BADGES[inst.loader] || LOADER_BADGES.vanilla;
                return (
                  <label key={inst.dir} className="import-instance-row custom-checkbox-row">
                    <input type="checkbox" checked={checked.has(inst.dir)} onChange={() => toggleDir(inst.dir)} />
                    <span className="custom-checkbox-box" />
                    <span className="loader-chip-glyph" style={{ background: badge.color }}>
                      <LoaderGlyph glyph={badge.glyph} size={12} />
                    </span>
                    <div className="import-instance-row-info">
                      <div className="import-instance-row-name">{inst.name}</div>
                      <div className="import-instance-row-meta">
                        {inst.mcVersion} · {inst.format}
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}

      {error && <div className="instance-form-error" style={{ whiteSpace: 'pre-line' }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <button
          className="btn-secondary btn-icon-label"
          onClick={activeSource ? () => setActiveSource(null) : onBack}
          disabled={importing}
        >
          <Icon name="arrowLeft" size={14} />
          {t('common.back')}
        </button>
        {activeSource && (
          <button
            className="btn-primary btn-icon-label"
            style={{ flex: 1 }}
            onClick={handleImport}
            disabled={importing || checked.size === 0}
          >
            <Icon name="download" size={14} />
            {importing ? t('create.importing') : t('create.importCount', { n: checked.size })}
          </button>
        )}
      </div>
    </>
  );
}
