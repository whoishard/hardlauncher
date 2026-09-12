import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import InstanceIcon from '../components/InstanceIcon.jsx';
import InstanceSettingsPanel from '../components/InstanceSettingsPanel.jsx';
import Icon from '../components/Icon.jsx';
import Select from '../components/Select.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import ConsoleView from '../components/ConsoleView.jsx';
import { modalOverlayMotion, modalCardMotion } from '../components/CreateInstanceModal.jsx';
import useLightboxZoom from '../hooks/useLightboxZoom.js';
import { useT } from '../i18n.js';

// Las claves de progress.* también las usa CreateInstanceModal para el
// mismo tipo de descarga; se comparten para no traducir el mismo texto dos
// veces en el diccionario.
const PROGRESS_STAGE_KEY = {
  assets: 'progress.assets',
  libraries: 'progress.libraries',
  'java-runtime': 'progress.java',
};

const TAB_IDS = ['content', 'worlds', 'screenshots', 'console'];
const TAB_LABEL_KEY = {
  content: 'tab.content',
  worlds: 'tab.worlds',
  screenshots: 'tab.screenshots',
  console: 'tab.console',
};

export default function InstanceDetailView() {
  const t = useT();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const {
    activeAccount,
    logs,
    appendLog,
    clearLogs,
    pushToast,
    runningInstance,
    setRunningInstance,
    clearRunningInstance,
    refreshInstances,
  } = useAppStore();
  const [instance, setInstance] = useState(null);
  const [tab, setTab] = useState('content');
  const [showSettings, setShowSettings] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastExitCode, setLastExitCode] = useState(null);

  // Antes esto solo actualizaba el estado local `instance` de esta vista: al
  // cambiar el ícono (o el nombre, o el contenido) en Configuración, se veía
  // bien acá pero la Sidebar, "Instancias" y "Inicio" siguen mostrando la
  // lista cacheada en el store global (useAppStore), que no se refresca
  // sola. Por eso el ícono nuevo recién aparecía en el resto del launcher
  // después de cerrarlo y volver a abrirlo (que es lo único que repuebla
  // ese store). Ahora cada reload() también pide la lista completa
  // actualizada para que todo el launcher quede en sync al instante.
  async function reload() {
    const data = await window.hardLauncher.instances.get(id);
    setInstance(data);
    refreshInstances();
  }

  useEffect(() => {
    reload();
    const initialTab = searchParams.get('tab');
    // Ajustes ahora es un apartado propio (modal) que se abre por encima del
    // launcher en vez de un tab más — pero se sigue pudiendo abrir directo
    // con ?tab=settings desde otras pantallas (ej. el menú de opciones de
    // una instancia), así que si llega así se abre el modal en vez de
    // intentar seleccionarlo como pestaña de contenido.
    const validTabs = TAB_IDS;
    if (initialTab === 'settings') {
      setShowSettings(true);
      setTab('content');
    } else {
      setTab(validTabs.includes(initialTab) ? initialTab : 'content');
    }
    const unsubLog = window.hardLauncher.game.onLog((line) => appendLog(line));
    const unsubProgress = window.hardLauncher.game.onDownloadProgress((data) => setProgress(data));
    const unsubExit = window.hardLauncher.game.onExit((code) => {
      setLaunching(false);
      setProgress(null);
      setLastExitCode(code);
    });
    return () => {
      unsubLog();
      unsubProgress();
      unsubExit();
    };
  }, [id]);

  async function handleLaunch(directConnect = null) {
    if (!activeAccount) {
      pushToast(t('instances.needAccount'), 'error');
      return;
    }
    // Minecraft no tiene forma de pedirle a un proceso ya abierto que se
    // conecte a otro servidor o reinicie con otra config — y la carpeta de
    // la instancia queda bloqueada mientras el juego corre, así que lanzar
    // un segundo proceso para la MISMA instancia terminaría fallando solo.
    // Este guard vive acá (y no solo en los botones que navegan hasta acá,
    // ver MinecraftServerList.jsx/HomeView.jsx) porque es el único lugar
    // por el que pasa cualquier lanzamiento, sin importar desde qué parte
    // del launcher se haya pedido (recientes de Inicio, servidor
    // recomendado, o el botón "Jugar" de esta misma pantalla).
    if (runningInstance && runningInstance.id !== id) {
      pushToast(t('servers.anotherRunning', { name: runningInstance.name }), 'error');
      return;
    }
    if (runningInstance && runningInstance.id === id) {
      if (!directConnect) {
        // "Jugar" de esta misma instancia sin pedir conexión directa a
        // ningún servidor puntual: no hay nada nuevo que hacer, solo llevar
        // al jugador a ver la consola de lo que ya está corriendo.
        pushToast(t('instanceDetail.toastAlreadyRunning'), 'info');
        setTab('console');
        return;
      }
      // El jugador quiere entrar a un servidor puntual (botón "Jugar" de un
      // servidor recomendado) y esta MISMA instancia ya está corriendo: como
      // no hay forma de pedirle al proceso viejo que se conecte a otro lado,
      // se la reinicia — se cierra y se la vuelve a lanzar ya apuntando
      // directo al servidor. Se avisa antes por si había progreso sin
      // guardar en la partida abierta.
      pushToast(t('instanceDetail.toastRestarting'), 'info');
      await window.hardLauncher.game.stop(id);
      clearRunningInstance();
    }
    setLaunching(true);
    setProgress(null);
    setLastExitCode(null);
    clearLogs();
    setTab('console');
    setRunningInstance({ id, name: instance.name });
    try {
      await window.hardLauncher.game.launch(id, directConnect);
    } catch (e) {
      appendLog(`[Error] ${e.message}`);
      setLaunching(false);
      setProgress(null);
      clearRunningInstance();
    }
  }

  // Si se llega desde el botón "Jugar" de Inicio (?autoplay=1), se lanza
  // automáticamente una sola vez y se limpia el parámetro de la URL. Cuando
  // además vienen "joinHost"/"joinPort" (botón "Jugar" de un servidor
  // recomendado, ver MinecraftServerList.jsx), el juego entra directo a ese
  // servidor en vez de abrir el menú principal. Este hook debe quedar ANTES
  // del "return" condicional de abajo: los hooks de React no pueden
  // llamarse condicionalmente.
  useEffect(() => {
    if (searchParams.get('autoplay') === '1' && instance && !launching) {
      const joinHost = searchParams.get('joinHost');
      const joinPort = searchParams.get('joinPort');
      const directConnect = joinHost ? { host: joinHost, port: joinPort ? Number(joinPort) : 25565 } : null;
      navigate(`/instances/${id}`, { replace: true });
      handleLaunch(directConnect);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance]);

  if (!instance) return <div>{t('instanceDetail.loadingInstance')}</div>;

  // Ambas acciones actualizan el estado local de la instancia al instante
  // (optimista) en vez de esperar el viaje de ida y vuelta a disco antes de
  // reflejar el cambio — el interruptor cambia y el ítem desaparece de la
  // lista apenas se clickea. Si la operación real termina fallando, se
  // revierte con reload() (que trae el estado real desde disco).
  async function handleToggle(item) {
    setInstance((prev) => ({
      ...prev,
      content: prev.content.map((c) => (c.fileName === item.fileName ? { ...c, enabled: !c.enabled } : c)),
    }));
    try {
      await window.hardLauncher.modrinth.toggleContent(id, item.fileName, !item.enabled);
      refreshInstances();
    } catch (e) {
      pushToast(t('content.toggleFailed', { error: e.message }), 'error');
      reload();
    }
  }

  async function handleRemove(item) {
    setInstance((prev) => ({ ...prev, content: prev.content.filter((c) => c.fileName !== item.fileName) }));
    try {
      await window.hardLauncher.modrinth.removeContent(id, item.fileName);
      refreshInstances();
    } catch (e) {
      pushToast(t('content.removeFailed', { error: e.message }), 'error');
      reload();
    }
  }

  return (
    <div>
      <Link to="/instances" style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
        {t('instanceDetail.backToInstances')}
      </Link>

      <motion.div
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '16px 0 24px', gap: 16 }}
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <InstanceIcon name={instance.name} loader={instance.loader} icon={instance.icon} size={72} />
          <div>
            <h1 style={{ margin: 0 }}>{instance.name}</h1>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <span className="badge">{instance.mcVersion}</span>
              <span className="badge">{instance.loader}</span>
              <span className="badge">{t('instanceDetail.contentsCount', { n: instance.content.length })}</span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <motion.button
            className="btn-secondary btn-icon-label"
            onClick={() => window.hardLauncher.instances.openFolder(id)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <Icon name="folder" size={15} />
            {t('common.openFolder')}
          </motion.button>
          <motion.button
            type="button"
            className={'instance-settings-btn' + (showSettings ? ' active' : '')}
            onClick={() => setShowSettings(true)}
            title={t('instanceDetail.settingsTooltip')}
            whileHover={{ scale: 1.08 }}
            whileTap={{ scale: 0.92 }}
          >
            <Icon name="gear" size={18} />
          </motion.button>
          <motion.button
            className="btn-primary btn-icon-label"
            onClick={() => handleLaunch()}
            disabled={launching}
            style={{ padding: '10px 28px', fontSize: 15 }}
            whileHover={!launching ? { scale: 1.03 } : undefined}
            whileTap={!launching ? { scale: 0.97 } : undefined}
          >
            {!launching && <Icon name="play" size={15} />}
            {launching ? t('console.running') : t('common.play')}
          </motion.button>
        </div>
      </motion.div>

      <AnimatePresence>
        {progress && launching && (
          <motion.div
            style={{ marginBottom: 16, overflow: 'hidden' }}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            <ProgressBar
              label={progress.stage in PROGRESS_STAGE_KEY ? t(PROGRESS_STAGE_KEY[progress.stage]) : t('progress.preparing')}
              percent={progress.total ? (progress.completed / progress.total) * 100 : null}
              hint={progress.total ? `${progress.completed} / ${progress.total}` : undefined}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border-subtle)', paddingBottom: 12 }}>
        {TAB_IDS.map((tabId) => (
          <motion.button
            key={tabId}
            className={tab === tabId ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setTab(tabId)}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {t(TAB_LABEL_KEY[tabId])}
          </motion.button>
        ))}
      </div>

      {/* mode="wait" para que no se solapen dos tabs a la vez mientras
          entra/sale la animación. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        >
          {tab === 'content' && <ContentTab instance={instance} onToggle={handleToggle} onRemove={handleRemove} onReload={reload} />}
          {tab === 'worlds' && <WorldsTab instanceId={id} pushToast={pushToast} />}
          {tab === 'screenshots' && <ScreenshotsTab instanceId={id} />}
          {tab === 'console' && (
            <div style={{ height: 460 }}>
              <ConsoleView
                lines={logs}
                running={launching}
                hasError={!launching && lastExitCode != null && lastExitCode !== 0}
                onClear={clearLogs}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <AnimatePresence>
        {showSettings && (
          <InstanceSettingsPanel
            instance={instance}
            onClose={() => setShowSettings(false)}
            onSaved={reload}
            navigate={navigate}
            pushToast={pushToast}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

const CONTENT_TYPE_META = {
  mod: { label: 'Mod', icon: 'package', color: '#8b5cf6' },
  resourcepack: { label: 'Resource Pack', icon: 'image', color: '#38bdf8' },
  shader: { label: 'Shader', icon: 'sparkles', color: '#fbbf24' },
  modpack: { label: 'Modpack', icon: 'layers', color: '#34d399' },
  datapack: { label: 'Data Pack', icon: 'database', color: '#f472b6' },
};

// "Mods" / "Resource Packs" / "Shaders" / "Data Packs" quedan sin traducir
// a propósito: son nombres de categoría técnicos que Modrinth/CurseForge y
// el propio juego usan igual en cualquier idioma (como "Fabric" o "Forge").
const CONTENT_FILTERS = [
  { id: 'all', labelKey: 'content.all' },
  { id: 'mod', label: 'Mods' },
  { id: 'resourcepack', label: 'Resource Packs' },
  { id: 'shader', label: 'Shaders' },
  { id: 'datapack', label: 'Data Packs' },
];

const CONTENT_SORT_OPTIONS = [
  { value: 'name-asc', labelKey: 'content.sortNameAsc' },
  { value: 'name-desc', labelKey: 'content.sortNameDesc' },
  { value: 'type', labelKey: 'content.sortType' },
];

function ContentTab({ instance, onToggle, onRemove, onReload }) {
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name-asc');
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    setUploading(true);
    try {
      const added = await window.hardLauncher.instances.addLocalFiles(instance.id);
      if (added.length) onReload();
    } finally {
      setUploading(false);
    }
  }

  const availableTypes = new Set(instance.content.map((c) => c.type));
  const visibleFilters = CONTENT_FILTERS.filter((f) => f.id === 'all' || availableTypes.has(f.id));

  const filtered = instance.content
    .filter((c) => filter === 'all' || c.type === filter)
    .filter((c) => c.projectTitle.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => {
      if (sort === 'name-desc') return b.projectTitle.localeCompare(a.projectTitle);
      if (sort === 'type') return a.type.localeCompare(b.type) || a.projectTitle.localeCompare(b.projectTitle);
      return a.projectTitle.localeCompare(b.projectTitle);
    });

  return (
    <div>
      <div className="content-toolbar">
        <div className="content-search">
          <Icon name="search" size={15} />
          <input
            placeholder={t('content.search', { n: instance.content.length })}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn-secondary btn-icon-label" onClick={onReload} title={t('content.refresh')}>
          <Icon name="refresh" size={14} />
          {t('content.refresh')}
        </button>
        <button className="btn-secondary btn-icon-label" onClick={handleUpload} disabled={uploading}>
          <Icon name="upload" size={14} />
          {uploading ? t('content.uploading') : t('content.upload')}
        </button>
        <Link to={`/explore?instance=${instance.id}`} className="btn-primary btn-icon-label" style={{ textDecoration: 'none' }}>
          <Icon name="compass" size={14} />
          {t('content.explore')}
        </Link>
      </div>

      {instance.content.length > 0 && (
        <div className="content-filters-row">
          <div className="content-filter-chips">
            {visibleFilters.map((f) => (
              <button key={f.id} className={'chip' + (filter === f.id ? ' active' : '')} onClick={() => setFilter(f.id)}>
                {f.labelKey ? t(f.labelKey) : f.label}
              </button>
            ))}
          </div>
          <Select
            value={sort}
            onChange={setSort}
            style={{ minWidth: 190 }}
            options={CONTENT_SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
          />
        </div>
      )}

      {instance.content.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="inbox" size={64} strokeWidth={1.3} />
          </div>
          <div className="empty-state-title">{t('content.emptyTitle')}</div>
          <div className="empty-state-subtitle">{t('content.emptySub')}</div>
          <div className="empty-state-actions">
            <button className="btn-secondary btn-icon-label" onClick={handleUpload} disabled={uploading}>
              <Icon name="upload" size={14} />
              {uploading ? t('content.uploading') : t('content.upload')}
            </button>
            <Link to={`/explore?instance=${instance.id}`} className="btn-primary btn-icon-label" style={{ textDecoration: 'none' }}>
              <Icon name="compass" size={14} />
              {t('content.explore')}
            </Link>
          </div>
        </div>
      )}
      {instance.content.length > 0 && filtered.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>{t('content.noMatch')}</p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <AnimatePresence initial={false}>
          {filtered.map((item) => {
            const meta = CONTENT_TYPE_META[item.type] || CONTENT_TYPE_META.mod;
            // Antes había que darle a un botoncito de brújula (fácil de pasar
            // por alto) para ir al proyecto en el explorador. Ahora toda la
            // fila es clickeable y lleva ahí directamente — más fácil de
            // encontrar y de acertar con el mouse. Las acciones de la derecha
            // (activar/desactivar, eliminar) cortan la propagación para no
            // disparar también la navegación.
            const goToProject = () => {
              // El state.cameFromInstance es lo que le permite a
              // ProjectDetailView distinguir "vine desde adentro de esta
              // instancia" (acá) de "vine desde Explorar con esta instancia
              // nada más preseleccionada como destino" (donde el mismo
              // ?instance= también está presente, pero no significa lo
              // mismo) — ver la nota en ProjectDetailView.jsx.
              if (item.projectId) {
                navigate(`/project/${item.projectId}?instance=${instance.id}`, {
                  state: { cameFromInstance: true },
                });
              }
            };
            return (
              <motion.div
                key={item.fileName}
                layout
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 24, transition: { duration: 0.15 } }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                className={'content-row' + (item.projectId ? ' clickable' : '')}
                onClick={goToProject}
                role={item.projectId ? 'button' : undefined}
                tabIndex={item.projectId ? 0 : undefined}
                onKeyDown={(e) => {
                  if (item.projectId && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    goToProject();
                  }
                }}
              >
                {item.iconUrl ? (
                  <img src={item.iconUrl} alt="" className="content-row-icon" />
                ) : (
                  <div
                    className="content-row-icon content-row-icon-fallback"
                    style={{ background: meta.color + '26', color: meta.color }}
                  >
                    <Icon name={meta.icon} size={17} />
                  </div>
                )}
                <div className="content-row-info">
                  <div className="content-row-title">{item.projectTitle}</div>
                  <div className="content-row-subtitle">
                    {meta.label} · {item.fileName}
                    {item.manual && <span className="badge" style={{ marginLeft: 6 }}>{t('common.manual')}</span>}
                  </div>
                </div>
                <div className="content-row-actions" onClick={(e) => e.stopPropagation()}>
                  <div
                    className={'toggle' + (item.enabled ? ' on' : '')}
                    onClick={() => onToggle(item)}
                    title={item.enabled ? t('content.disable') : t('content.enable')}
                  />
                  <button className="icon-btn danger" onClick={() => onRemove(item)} title={t('common.delete')}>
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

const GAME_TYPE_KEYS = ['world.gameType.0', 'world.gameType.1', 'world.gameType.2', 'world.gameType.3'];
const DIFFICULTY_KEYS = ['world.difficulty.0', 'world.difficulty.1', 'world.difficulty.2', 'world.difficulty.3'];

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function WorldsTab({ instanceId, pushToast }) {
  const t = useT();
  const [worlds, setWorlds] = useState(null);
  const [settingsWorld, setSettingsWorld] = useState(null);
  const [exportingPath, setExportingPath] = useState(null);

  function reload() {
    return window.hardLauncher.instances.listWorlds(instanceId).then(setWorlds);
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  async function handleDuplicate(world) {
    try {
      const created = await window.hardLauncher.instances.duplicateWorld(instanceId, world.path);
      setWorlds((prev) => [created, ...(prev || [])]);
      pushToast?.(t('world.toastDuplicated', { name: world.displayName }), 'info');
    } catch (e) {
      pushToast?.(t('world.toastDuplicateFailed', { error: e.message }), 'error');
    }
  }

  async function handleDelete(world) {
    setWorlds((prev) => (prev || []).filter((w) => w.path !== world.path));
    try {
      await window.hardLauncher.instances.deleteWorld(instanceId, world.path);
      pushToast?.(t('world.toastDeleted', { name: world.displayName }), 'info');
    } catch (e) {
      pushToast?.(t('world.toastDeleteFailed', { error: e.message }), 'error');
      reload();
    }
  }

  async function handleOpenFolder(world) {
    window.hardLauncher.instances.openWorldFolder(instanceId, world.path);
  }

  async function handleExport(world) {
    setExportingPath(world.path);
    try {
      const result = await window.hardLauncher.instances.exportWorldForServer(instanceId, world.path, world.displayName);
      if (result) {
        pushToast?.(
          t('world.toastExported', { name: world.displayName, size: formatBytes(result.size) }),
          'info'
        );
      }
    } catch (e) {
      pushToast?.(t('world.toastExportFailed', { error: e.message }), 'error');
    } finally {
      setExportingPath(null);
    }
  }

  async function handleSaveSettings(world, changes) {
    const updated = await window.hardLauncher.instances.updateWorldSettings(instanceId, world.path, changes);
    let finalWorld = updated;
    if (changes.levelName && changes.levelName !== world.info?.levelName) {
      finalWorld = await window.hardLauncher.instances.renameWorld(instanceId, updated.path, changes.levelName);
    }
    setWorlds((prev) => (prev || []).map((w) => (w.path === world.path ? finalWorld : w)));
    pushToast?.(t('world.toastSettingsSaved', { name: finalWorld.displayName }), 'info');
    return finalWorld;
  }

  if (worlds === null) return <p style={{ color: 'var(--text-secondary)' }}>{t('worlds.loading')}</p>;
  if (worlds.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <Icon name="globe" size={64} strokeWidth={1.3} />
        </div>
        <div className="empty-state-title">{t('worlds.emptyTitle')}</div>
        <div className="empty-state-subtitle">{t('worlds.emptySub')}</div>
      </div>
    );
  }

  return (
    <>
      <div className="worlds-grid">
        {worlds.map((w, i) => (
          <WorldCard
            key={w.path}
            world={w}
            index={i}
            exporting={exportingPath === w.path}
            onConfigure={() => setSettingsWorld(w)}
            onDuplicate={() => handleDuplicate(w)}
            onExport={() => handleExport(w)}
            onOpenFolder={() => handleOpenFolder(w)}
            onDelete={() => handleDelete(w)}
          />
        ))}
      </div>

      <AnimatePresence>
        {settingsWorld && (
          <WorldSettingsModal
            world={settingsWorld}
            onClose={() => setSettingsWorld(null)}
            onSave={handleSaveSettings}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function WorldCard({ world, index, exporting, onConfigure, onDuplicate, onExport, onOpenFolder, onDelete }) {
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const info = world.info;

  return (
    <motion.div
      className="world-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="world-card-thumb">
        {world.icon ? (
          <img src={world.icon} alt={world.displayName} />
        ) : (
          <div className="world-card-thumb-fallback">
            <Icon name="globe" size={40} strokeWidth={1.3} />
          </div>
        )}

        <div className="world-card-dims">
          <span className="world-dim-chip active" title={t('world.overworldTooltip')}>
            <Icon name="globe" size={13} strokeWidth={2} />
          </span>
          <span
            className={'world-dim-chip nether' + (world.hasNether ? ' active' : '')}
            title={world.hasNether ? t('world.netherTooltipOn') : t('world.netherTooltipOff')}
          >
            <Icon name="flame" size={13} strokeWidth={2} />
          </span>
          <span
            className={'world-dim-chip end' + (world.hasEnd ? ' active' : '')}
            title={world.hasEnd ? t('world.endTooltipOn') : t('world.endTooltipOff')}
          >
            <Icon name="moon" size={13} strokeWidth={2} />
          </span>
        </div>

        <div className="world-card-menu-wrap" onClick={(e) => e.stopPropagation()}>
          <WorldOptionsMenu
            onConfigure={onConfigure}
            onDuplicate={onDuplicate}
            onExport={onExport}
            onOpenFolder={onOpenFolder}
            onDelete={() => setConfirmingDelete(true)}
            exporting={exporting}
          />
        </div>
      </div>

      <div className="world-card-body">
        <div className="world-card-title" title={world.displayName}>
          {world.displayName}
        </div>

        <div className="world-card-badges">
          {info && <span className="badge badge-sm">{t(GAME_TYPE_KEYS[info.gameType] ?? GAME_TYPE_KEYS[0])}</span>}
          {info && <span className="badge badge-sm">{t(DIFFICULTY_KEYS[info.difficulty] ?? DIFFICULTY_KEYS[2])}</span>}
          {info?.hardcore && <span className="badge badge-sm badge-hardcore">{t('world.hardcoreBadge')}</span>}
          {info?.allowCommands && <span className="badge badge-sm">{t('world.cheatsBadge')}</span>}
        </div>

        <div className="world-card-stats">
          <div className="world-card-stat">
            <Icon name="clock" size={13} />
            {new Date(world.lastModified).toLocaleString()}
          </div>
          <div className="world-card-stat">
            <Icon name="database" size={13} />
            {formatBytes(world.size)}
            {info?.seed && <span style={{ opacity: 0.7 }}>{t('world.seedInline', { seed: info.seed })}</span>}
          </div>
        </div>
      </div>

      <AnimatePresence>
        {confirmingDelete && (
          <motion.div
            className="modal-overlay"
            onClick={() => !deleting && setConfirmingDelete(false)}
            {...modalOverlayMotion}
          >
            <motion.div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
              <div className="modal-header">
                <div>
                  <h3 className="modal-title">{t('world.deleteConfirmTitle', { name: world.displayName })}</h3>
                  <p className="modal-subtitle">{t('world.deleteConfirmSub')}</p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  className="btn-danger"
                  style={{ flex: 1 }}
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true);
                    await onDelete();
                    setDeleting(false);
                    setConfirmingDelete(false);
                  }}
                >
                  {deleting ? t('instances.deleting') : t('world.deleteConfirmYes')}
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
  );
}

function WorldOptionsMenu({ onConfigure, onDuplicate, onExport, onOpenFolder, onDelete, exporting }) {
  const t = useT();
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
    <div className="instance-card-menu-wrap inline" ref={ref}>
      <button
        type="button"
        className="instance-card-menu-btn"
        title={t('world.menuTooltip')}
        onClick={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
      >
        <Icon name="dots" size={15} />
      </button>

      {open && (
        <div className="instance-card-menu">
          <button type="button" className="instance-card-menu-item" onClick={() => { setOpen(false); onConfigure(); }}>
            <Icon name="gear" size={14} />
            {t('world.menuConfigure')}
          </button>
          <button type="button" className="instance-card-menu-item" onClick={() => { setOpen(false); onDuplicate(); }}>
            <Icon name="copy" size={14} />
            {t('world.menuDuplicate')}
          </button>
          <button
            type="button"
            className="instance-card-menu-item"
            disabled={exporting}
            onClick={() => { setOpen(false); onExport(); }}
          >
            <Icon name="upload" size={14} />
            {exporting ? t('world.menuExporting') : t('world.menuExport')}
          </button>
          <button type="button" className="instance-card-menu-item" onClick={() => { setOpen(false); onOpenFolder(); }}>
            <Icon name="folder" size={14} />
            {t('common.openFolder')}
          </button>
          <button type="button" className="instance-card-menu-item danger" onClick={() => { setOpen(false); onDelete(); }}>
            <Icon name="trash" size={14} />
            {t('common.delete')}
          </button>
        </div>
      )}
    </div>
  );
}

function WorldSettingsModal({ world, onClose, onSave }) {
  const info = world.info;
  const t = useT();
  const [levelName, setLevelName] = useState(world.displayName);
  const [gameType, setGameType] = useState(info?.gameType ?? 0);
  const [difficulty, setDifficulty] = useState(info?.difficulty ?? 2);
  const [hardcore, setHardcore] = useState(!!info?.hardcore);
  const [allowCommands, setAllowCommands] = useState(!!info?.allowCommands);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    try {
      await onSave(world, { levelName: levelName.trim() || world.displayName, gameType, difficulty, hardcore, allowCommands });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <motion.div className="modal-overlay" onClick={() => !saving && onClose()} {...modalOverlayMotion}>
      <motion.div className="card modal-card" style={{ width: 460 }} onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{t('world.settingsTitle')}</h3>
            <p className="modal-subtitle">
              {info ? t('world.settingsSubtitleWithInfo') : t('world.settingsSubtitleNoInfo')}
            </p>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')} disabled={saving}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 14 }}>
          <div>
            <div className="modal-section-label">{t('create.name')}</div>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={levelName}
                onChange={(e) => setLevelName(e.target.value)}
                style={{ width: '100%', paddingLeft: 34 }}
              />
              <Icon
                name="pencil"
                size={14}
                style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
              />
            </div>
          </div>

          {info && (
            <>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div className="modal-section-label">{t('world.gameTypeLabel')}</div>
                  <Select
                    value={gameType}
                    onChange={setGameType}
                    options={GAME_TYPE_KEYS.map((key, value) => ({ value, label: t(key) }))}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="modal-section-label">{t('world.difficultyLabel')}</div>
                  <Select
                    value={difficulty}
                    onChange={setDifficulty}
                    options={DIFFICULTY_KEYS.map((key, value) => ({ value, label: t(key) }))}
                  />
                </div>
              </div>

              <div className="content-row" style={{ padding: '10px 12px' }}>
                <div className="content-row-info">
                  <div className="content-row-title">{t('world.hardcoreBadge')}</div>
                  <div className="content-row-subtitle">{t('world.hardcoreDesc')}</div>
                </div>
                <div className={'toggle' + (hardcore ? ' on' : '')} onClick={() => setHardcore((v) => !v)} />
              </div>

              <div className="content-row" style={{ padding: '10px 12px' }}>
                <div className="content-row-info">
                  <div className="content-row-title">{t('world.cheatsBadge')}</div>
                  <div className="content-row-subtitle">{t('world.cheatsDesc')}</div>
                </div>
                <div className={'toggle' + (allowCommands ? ' on' : '')} onClick={() => setAllowCommands((v) => !v)} />
              </div>

              {info.seed && (
                <div className="world-seed-row">
                  <div>
                    <div className="modal-section-label" style={{ marginBottom: 2 }}>
                      {t('world.seedLabel')}
                    </div>
                    <code>{info.seed}</code>
                  </div>
                  <button
                    type="button"
                    className="btn-secondary btn-icon-label"
                    onClick={() => navigator.clipboard.writeText(info.seed)}
                  >
                    <Icon name="copy" size={13} />
                    {t('console.copy')}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <button className="btn-primary" style={{ flex: 1 }} onClick={handleSave} disabled={saving}>
            {saving ? t('common.saving') : t('world.saveChanges')}
          </button>
          <button className="btn-secondary" style={{ flex: 1 }} onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ScreenshotsTab({ instanceId }) {
  const t = useT();
  const [screenshots, setScreenshots] = useState(null);
  const [images, setImages] = useState({});
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const { zoomed, dragging, bodyRef, onImageMouseDown, onImageClick, onImageDragStart } = useLightboxZoom(lightboxIndex);

  useEffect(() => {
    window.hardLauncher.instances.listScreenshots(instanceId).then(setScreenshots);
  }, [instanceId]);

  useEffect(() => {
    if (!screenshots) return;
    screenshots.slice(0, 30).forEach((s) => {
      if (images[s.path]) return;
      window.hardLauncher.instances.readImageAsDataUrl(instanceId, s.path).then((dataUrl) => {
        setImages((prev) => ({ ...prev, [s.path]: dataUrl }));
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenshots]);

  const visible = screenshots ? screenshots.slice(0, 30) : [];

  // Navegación con flechas del teclado y Escape mientras el visor está abierto.
  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => Math.min(i + 1, visible.length - 1));
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => Math.max(i - 1, 0));
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightboxIndex, visible.length]);

  if (screenshots === null) return <p style={{ color: 'var(--text-secondary)' }}>{t('shots.loading')}</p>;
  if (screenshots.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">
          <Icon name="image" size={64} strokeWidth={1.3} />
        </div>
        <div className="empty-state-title">{t('shots.emptyTitle')}</div>
        <div className="empty-state-subtitle">{t('shots.emptySub')}</div>
      </div>
    );
  }

  const current = lightboxIndex !== null ? visible[lightboxIndex] : null;

  async function handleDelete(shot) {
    // Optimista: la captura se saca de la grilla y el visor se cierra al
    // instante, sin esperar la confirmación del borrado en disco. Si el
    // borrado falla, se restaura la lista anterior.
    const previous = screenshots;
    setScreenshots((prev) => prev.filter((s) => s.path !== shot.path));
    setLightboxIndex(null);
    setDeleting(true);
    try {
      await window.hardLauncher.instances.deleteScreenshot(instanceId, shot.path);
    } catch (e) {
      setScreenshots(previous);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="screenshot-grid">
        {visible.map((s, i) => (
          <motion.button
            key={s.path}
            type="button"
            className="screenshot-thumb"
            onClick={() => setLightboxIndex(i)}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.4), ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            {images[s.path] ? (
              <img src={images[s.path]} alt={s.name} />
            ) : (
              <div className="screenshot-thumb-placeholder" />
            )}
            <div className="screenshot-thumb-overlay">
              <Icon name="search" size={18} />
            </div>
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {current && (
          <motion.div className="modal-overlay" onClick={() => setLightboxIndex(null)} {...modalOverlayMotion}>
            <motion.div className="screenshot-lightbox" onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
              <div className="screenshot-lightbox-header">
                <div>
                  <div className="screenshot-lightbox-name">{current.name}</div>
                  <div className="screenshot-lightbox-date">{new Date(current.lastModified).toLocaleString()}</div>
                </div>
                <button type="button" className="modal-close-btn" onClick={() => setLightboxIndex(null)} title={t('common.close')}>
                  <Icon name="close" size={15} />
                </button>
              </div>

              <div ref={bodyRef} className={'screenshot-lightbox-body' + (zoomed ? ' zoomed' : '')}>
                {lightboxIndex > 0 && (
                  <button
                    type="button"
                    className="screenshot-lightbox-nav prev"
                    onClick={() => setLightboxIndex((i) => i - 1)}
                    title={t('common.previous')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
                {images[current.path] ? (
                  <motion.img
                    key={current.path}
                    src={images[current.path]}
                    alt={current.name}
                    className={'screenshot-lightbox-image' + (zoomed ? ' zoomed' : '') + (dragging ? ' dragging' : '')}
                    draggable={false}
                    onMouseDown={onImageMouseDown}
                    onDragStart={onImageDragStart}
                    onClick={onImageClick}
                    title={zoomed ? t('shots.zoomOut') : t('shots.zoomIn')}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15 }}
                  />
                ) : (
                  <div className="screenshot-lightbox-loading">{t('common.loading')}</div>
                )}
                {lightboxIndex < visible.length - 1 && (
                  <button
                    type="button"
                    className="screenshot-lightbox-nav next"
                    onClick={() => setLightboxIndex((i) => i + 1)}
                    title={t('common.next')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="screenshot-lightbox-footer">
                <span className="screenshot-lightbox-counter">
                  {lightboxIndex + 1} / {visible.length}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-secondary btn-icon-label"
                    onClick={() => window.hardLauncher.instances.openFolder(instanceId)}
                  >
                    <Icon name="folder" size={14} />
                    {t('common.openFolder')}
                  </button>
                  <button
                    className="btn-danger btn-icon-label"
                    onClick={() => handleDelete(current)}
                    disabled={deleting}
                  >
                    <Icon name="trash" size={14} />
                    {deleting ? t('instances.deleting') : t('common.delete')}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
