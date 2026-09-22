import React, { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import InstanceIcon from '../components/InstanceIcon.jsx';
import InstanceSettingsPanel from '../components/InstanceSettingsPanel.jsx';
import Icon from '../components/Icon.jsx';
import hardcoreHeartIcon from '../assets/hardcore-heart.png';
import Select from '../components/Select.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import ConsoleView from '../components/ConsoleView.jsx';
import UpdateInstanceVersionModal from '../components/UpdateInstanceVersionModal.jsx';
import ChangeModVersionModal from '../components/ChangeModVersionModal.jsx';
import TextFileEditor from '../components/TextFileEditor.jsx';
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

const TAB_IDS = ['content', 'files', 'worlds', 'screenshots', 'console'];
const TAB_LABEL_KEY = {
  content: 'tab.content',
  files: 'tab.files',
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
    touchInstanceLastPlayed,
  } = useAppStore();
  const [instance, setInstance] = useState(null);
  const [tab, setTab] = useState('content');
  const [showSettings, setShowSettings] = useState(false);
  // Cambiar la versión/loader de la instancia vivía SOLO adentro del modal
  // de Ajustes → Instalación, o sea a dos clics de distancia y escondido
  // entre el resto de la config — mucha gente ni sabía que se podía. Ahora
  // el mismo asistente (UpdateInstanceVersionModal) también se abre desde
  // el encabezado de esta pantalla: con un botón propio al lado de "Abrir
  // carpeta" y clickeando las propias chapitas de versión/loader, que es
  // donde uno intuitivamente va a tocar para cambiarlas.
  const [showVersionUpdate, setShowVersionUpdate] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [progress, setProgress] = useState(null);
  const [lastExitCode, setLastExitCode] = useState(null);
  // Contador que se incrementa cada vez que el juego se cierra. Se lo
  // pasamos a WorldsTab para que recargue la lista de mundos al volver de
  // jugar: adentro del juego se puede cambiar dificultad/hardcore (o crear
  // mundos nuevos) y sin esto la pestaña se quedaba mostrando los datos de
  // antes de esa partida hasta cambiar de instancia y volver.
  const [worldsRefreshSignal, setWorldsRefreshSignal] = useState(0);

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
      setWorldsRefreshSignal((n) => n + 1);
      // BUG FIX: launcher.js ya actualiza lastPlayed/totalPlaytime en disco
      // apenas el proceso del juego cierra, pero acá nunca se avisaba al
      // store global (useAppStore) para que vuelva a pedir la lista de
      // instancias. Esta vista sí quedaba con los datos viejos hasta que se
      // llamaba reload() por otro motivo (cambiar de instancia, tocar
      // contenido, etc.) — y como "continuar donde quedaste" en Inicio
      // ordena por lastPlayed usando ese store global, una instancia recién
      // jugada no le ganaba a la que estaba arriba antes hasta cerrar y
      // reabrir el launcher. Con este refreshInstances() el orden se
      // actualiza apenas volvés del juego.
      refreshInstances();
    });
    return () => {
      unsubLog();
      unsubProgress();
      unsubExit();
    };
  }, [id]);

  // Cambiar de versión reescribe el contenido de la carpeta de la
  // instancia (baja los mods/resource packs/shaders de la versión nueva y
  // borra los que quedaron incompatibles). Con el juego abierto esa
  // carpeta está en uso, así que se corta acá con un aviso en vez de
  // dejar que el asistente falle a mitad de camino.
  function openVersionUpdate() {
    if (runningInstance && runningInstance.id === id) {
      pushToast(t('instanceDetail.changeVersionWhileRunning'), 'error');
      return;
    }
    setShowVersionUpdate(true);
  }

  async function handleLaunch(directConnect = null, quickPlaySingleplayer = null) {
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
    // recomendado, el botón "Jugar" de un mundo puntual, o el botón "Jugar"
    // de esta misma pantalla).
    if (runningInstance && runningInstance.id !== id) {
      pushToast(t('servers.anotherRunning', { name: runningInstance.name }), 'error');
      return;
    }
    if (runningInstance && runningInstance.id === id) {
      if (!directConnect && !quickPlaySingleplayer) {
        // "Jugar" de esta misma instancia sin pedir conexión directa a
        // ningún servidor puntual: no hay nada nuevo que hacer, solo llevar
        // al jugador a ver la consola de lo que ya está corriendo.
        pushToast(t('instanceDetail.toastAlreadyRunning'), 'info');
        setTab('console');
        return;
      }
      // El jugador quiere entrar a un servidor o un mundo puntual (botón
      // "Jugar" de un servidor recomendado o de un mundo de la pestaña
      // "Mundos") y esta MISMA instancia ya está corriendo: como no hay
      // forma de pedirle al proceso viejo que se conecte a otro lado, se lo
      // reinicia — se cierra y se lo vuelve a lanzar ya apuntando directo
      // ahí. Se avisa antes por si había progreso sin guardar en la partida
      // abierta.
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
    // Actualiza "Continuar donde quedaste" al instante, apenas se toca
    // "Jugar" — sin esto había que esperar a que el juego terminara de
    // abrir (o de cerrarse) para ver la instancia recién jugada arriba de
    // la lista. Ver touchInstanceLastPlayed en store.js.
    touchInstanceLastPlayed(id);
    try {
      await window.hardLauncher.game.launch(id, directConnect, quickPlaySingleplayer);
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
      const joinName = searchParams.get('joinName');
      const directConnect = joinHost
        ? { host: joinHost, port: joinPort ? Number(joinPort) : 25565, name: joinName || null }
        : null;
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

  // A diferencia de toggle/remove, actualizar sí necesita el viaje real a
  // disco antes de reflejar nada (hay que descargar el archivo nuevo), así
  // que no hay optimismo acá: se espera la respuesta y recién ahí se
  // recarga la instancia entera (por si el nombre del archivo cambió).
  async function handleUpdateOne(item) {
    try {
      await window.hardLauncher.modrinth.updateContent(id, item.fileName);
      pushToast(t('content.updateSuccess', { name: item.projectTitle }), 'success');
      refreshInstances();
    } catch (e) {
      pushToast(t('content.updateFailed', { error: e.message }), 'error');
    } finally {
      reload();
    }
  }

  async function handleToggleFreeze(item) {
    const nextFrozen = !item.frozen;
    setInstance((prev) => ({
      ...prev,
      content: prev.content.map((c) => (c.fileName === item.fileName ? { ...c, frozen: nextFrozen } : c)),
    }));
    try {
      await window.hardLauncher.modrinth.toggleContentFreeze(id, item.fileName, nextFrozen);
    } catch (e) {
      pushToast(t('content.toggleFailed', { error: e.message }), 'error');
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
            <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'center' }}>
              {/* Las chapitas de versión y loader son el atajo más
                  "obvio" para cambiarlas: son justamente el dato que se
                  quiere editar, así que se comportan como un botón
                  (hover con borde de acento + ícono de intercambio) en vez
                  de ser texto muerto. El botón del encabezado hace
                  exactamente lo mismo, para quien no adivine que esto se
                  puede clickear. */}
              <button
                type="button"
                className="badge badge-version-switch"
                onClick={openVersionUpdate}
                title={t('instanceDetail.changeVersionTooltip')}
              >
                <span>{instance.mcVersion}</span>
                <span className="badge-version-switch-sep" />
                <span>{instance.loader}</span>
                <Icon name="swap" size={12} className="badge-version-switch-icon" />
              </button>
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
            className="btn-secondary btn-icon-label"
            onClick={openVersionUpdate}
            title={t('instanceDetail.changeVersionTooltip')}
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
          >
            <Icon name="swap" size={15} />
            {t('instanceDetail.changeVersion')}
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
            {/* size 26 (antes 22): el ícono de "play" ahora es solo contorno
                (no relleno), que a igual tamaño pesa menos visualmente, así
                que se agranda un poco más para que no se vea chico al lado
                del label en fontSize 15 dentro del botón grande (padding
                10px 28px) de "Jugar". */}
            {!launching && <Icon name="play" size={26} />}
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
          {tab === 'content' && (
            <ContentTab
              instance={instance}
              onToggle={handleToggle}
              onRemove={handleRemove}
              onReload={reload}
              onUpdateOne={handleUpdateOne}
              onToggleFreeze={handleToggleFreeze}
              pushToast={pushToast}
            />
          )}
          {tab === 'files' && <FilesTab instanceId={id} pushToast={pushToast} />}
          {tab === 'worlds' && (
            <WorldsTab
              instanceId={id}
              pushToast={pushToast}
              refreshSignal={worldsRefreshSignal}
              onPlayWorld={(world) => handleLaunch(null, world.name)}
            />
          )}
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

      {/* Mismo asistente que se abre desde Ajustes → Instalación; acá se
          monta con su propio estado para poder llegar directo desde el
          encabezado sin tener que pasar por el modal de ajustes. */}
      {showVersionUpdate && (
        <UpdateInstanceVersionModal
          instance={instance}
          onClose={() => setShowVersionUpdate(false)}
          onUpdated={reload}
          pushToast={pushToast}
        />
      )}
    </div>
  );
}

const CONTENT_TYPE_META = {
  mod: { label: 'Mod', icon: 'package', color: '#2dd4bf' },
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

// Carpeta en disco por tipo de contenido — mismo criterio que folderForType()
// del lado del proceso principal (src/api/modInstaller.js), pero acá solo
// hace falta para armar la ruta relativa de "Mostrar archivo".
const CONTENT_FOLDER_BY_TYPE = {
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
  mod: 'mods',
};

function ContentTab({ instance, onToggle, onRemove, onReload, onUpdateOne, onToggleFreeze, pushToast }) {
  const t = useT();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('name-asc');
  const [uploading, setUploading] = useState(false);
  // Actualizaciones disponibles por archivo ({ fileName: { versionId, versionNumber, versionData } }),
  // resueltas aparte (no viven en el store hasta que se aplican) para no
  // tener que esperar a un round-trip a Modrinth antes de poder mostrar la
  // pestaña con lo que ya está instalado.
  const [updates, setUpdates] = useState({});
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updatingFile, setUpdatingFile] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [changeVersionFor, setChangeVersionFor] = useState(null);
  const [menuFor, setMenuFor] = useState(null);
  const menuRef = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuFor(null);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function checkUpdates() {
    try {
      const result = await window.hardLauncher.modrinth.refreshContentMeta(instance.id);
      setUpdates(result?.updates || {});
    } catch {
      // best-effort: sin conexión momentánea, rate limit, etc. — simplemente
      // no aparece ningún botón de "Actualizar" hasta el próximo refresco.
    }
  }

  useEffect(() => {
    checkUpdates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  async function handleUpload() {
    setUploading(true);
    try {
      // Con el filtro activo (Mods/Resource Packs/Shaders/Data Packs) le
      // avisamos al proceso principal en qué subcarpeta de la instancia
      // debe abrirse el diálogo, en vez de dejarlo caer en Documentos.
      const added = await window.hardLauncher.instances.addLocalFiles(instance.id, filter);
      if (added.length) onReload();
    } finally {
      setUploading(false);
    }
  }

  // El botón de abajo de la lista ("Refrescar") relee el contenido desde
  // disco (por si se agregó/sacó algo a mano) y de paso vuelve a chequear
  // actualizaciones — es literalmente lo mismo que se hacía antes al abrir
  // la pestaña, nada más que ahora también dispara el chequeo.
  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onReload();
      await checkUpdates();
    } finally {
      setRefreshing(false);
    }
  }

  async function handleUpdateAllClick() {
    setUpdatingAll(true);
    try {
      const results = await window.hardLauncher.modrinth.updateAllContent(instance.id);
      const okCount = results.filter((r) => r.ok).length;
      pushToast?.(t('content.updateAllDone', { n: okCount }), 'success');
    } catch (e) {
      pushToast?.(t('content.updateFailed', { error: e.message }), 'error');
    } finally {
      setUpdatingAll(false);
      onReload();
      checkUpdates();
    }
  }

  async function handleUpdateOneClick(item) {
    setUpdatingFile(item.fileName);
    try {
      await onUpdateOne(item);
    } finally {
      setUpdatingFile(null);
      checkUpdates();
    }
  }

  async function handleShowFile(item) {
    const folder = CONTENT_FOLDER_BY_TYPE[item.type] || 'mods';
    const diskName = item.enabled === false ? `${item.fileName}.disabled` : item.fileName;
    try {
      await window.hardLauncher.instances.revealPath(instance.id, `${folder}/${diskName}`);
    } catch (e) {
      pushToast?.(t('content.showFileFailed', { error: e.message }), 'error');
    }
  }

  function handleCopyLink(item) {
    if (!item.projectId) return;
    navigator.clipboard?.writeText(`https://modrinth.com/${item.type}/${item.projectId}`);
    pushToast?.(t('content.linkCopied'), 'success');
  }

  const availableTypes = new Set(instance.content.map((c) => c.type));
  const visibleFilters = CONTENT_FILTERS.filter((f) => f.id === 'all' || availableTypes.has(f.id));
  const updateCount = Object.keys(updates).length;

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
          <div className="content-sort-group">
            {updateCount > 0 && (
              <button
                type="button"
                className="content-refresh-link danger"
                onClick={handleUpdateAllClick}
                disabled={updatingAll}
              >
                {updatingAll ? <span className="mini-spinner" /> : <Icon name="download" size={14} />}
                {updatingAll ? t('content.updating') : `${t('content.updateAll')} (${updateCount})`}
              </button>
            )}
            <button
              type="button"
              className={'content-refresh-link' + (refreshing ? ' spinning' : '')}
              onClick={handleRefresh}
              disabled={refreshing}
              title={t('content.refresh')}
            >
              <Icon name="refresh" size={14} />
              {t('content.refresh')}
            </button>
            <Select
              value={sort}
              onChange={setSort}
              style={{ minWidth: 190 }}
              options={CONTENT_SORT_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            />
          </div>
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
            const updateInfo = updates[item.fileName];
            // Antes había que darle a un botoncito de brújula (fácil de pasar
            // por alto) para ir al proyecto en el explorador. Ahora toda la
            // fila es clickeable y lleva ahí directamente — más fácil de
            // encontrar y de acertar con el mouse. Las acciones de la derecha
            // (actualizar, activar/desactivar, eliminar, "...") cortan la
            // propagación para no disparar también la navegación.
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
                className={'content-row content-row-entry' + (item.projectId ? ' clickable' : '')}
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
                <div className="content-row-main">
                  {item.iconUrl ? (
                    <img src={item.iconUrl} alt="" className="content-row-icon" />
                  ) : (
                    <div
                      className="content-row-icon content-row-icon-fallback"
                      style={{ background: meta.color + '26', color: meta.color }}
                    >
                      <Icon name={meta.icon} size={25} />
                    </div>
                  )}
                  <div className="content-row-info">
                    <div className="content-row-title">{item.projectTitle}</div>
                    <div className="content-row-subtitle">
                      {item.author ? (
                        <span className="content-row-author">
                          {item.authorAvatar ? (
                            <img src={item.authorAvatar} alt="" className="content-row-author-avatar" />
                          ) : (
                            <span className="content-row-author-avatar content-row-author-avatar-fallback">
                              {item.author[0]?.toUpperCase()}
                            </span>
                          )}
                          {item.author}
                        </span>
                      ) : (
                        meta.label
                      )}
                      {item.manual && <span className="badge" style={{ marginLeft: 6 }}>{t('common.manual')}</span>}
                      {item.frozen && <span className="badge" style={{ marginLeft: 6 }}>{t('content.frozenBadge')}</span>}
                    </div>
                  </div>
                </div>
                <div className="content-row-version">
                  <div className="content-row-version-number">{item.versionNumber || item.versionId || '—'}</div>
                  <div className="content-row-version-file">{item.fileName}</div>
                </div>
                <div className="content-row-actions" onClick={(e) => e.stopPropagation()}>
                  {updateInfo ? (
                    <button
                      className="icon-btn content-row-update"
                      onClick={() => handleUpdateOneClick(item)}
                      disabled={updatingFile === item.fileName || updatingAll}
                      title={
                        updatingFile === item.fileName
                          ? t('content.updating')
                          : `${t('content.update')}${updateInfo.versionNumber ? ` · ${updateInfo.versionNumber}` : ''}`
                      }
                    >
                      {updatingFile === item.fileName ? (
                        <span className="mini-spinner" />
                      ) : (
                        <Icon name="download" size={26} />
                      )}
                    </button>
                  ) : (
                    item.projectId && (
                      <button
                        className="icon-btn content-row-changeversion"
                        onClick={() => setChangeVersionFor(item)}
                        title={t('content.changeVersion')}
                      >
                        <Icon name="swap" size={22} />
                      </button>
                    )
                  )}
                  <div
                    className={'toggle content-row-toggle' + (item.enabled ? ' on' : '')}
                    onClick={() => onToggle(item)}
                    title={item.enabled ? t('content.disable') : t('content.enable')}
                  />
                  <button
                    className="icon-btn danger content-row-delete"
                    onClick={() => onRemove(item)}
                    title={t('common.delete')}
                  >
                    <Icon name="trash" size={22} />
                  </button>
                  <div
                    className="instance-card-menu-wrap inline"
                    ref={menuFor === item.fileName ? menuRef : undefined}
                    style={{ position: 'relative' }}
                  >
                    <button
                      type="button"
                      className="instance-card-menu-btn"
                      title={t('common.options')}
                      onClick={() => setMenuFor((cur) => (cur === item.fileName ? null : item.fileName))}
                    >
                      <Icon name="dots" size={15} />
                    </button>
                    {menuFor === item.fileName && (
                      <div className="instance-card-menu" style={{ right: 0, left: 'auto' }}>
                        <button
                          type="button"
                          className="instance-card-menu-item"
                          onClick={() => {
                            setMenuFor(null);
                            handleShowFile(item);
                          }}
                        >
                          <Icon name="folder" size={14} />
                          {t('content.showFile')}
                        </button>
                        {item.projectId && (
                          <button
                            type="button"
                            className="instance-card-menu-item"
                            onClick={() => {
                              setMenuFor(null);
                              handleCopyLink(item);
                            }}
                          >
                            <Icon name="link" size={14} />
                            {t('content.copyLink')}
                          </button>
                        )}
                        {item.projectId && (
                          <button
                            type="button"
                            className="instance-card-menu-item"
                            onClick={() => {
                              setMenuFor(null);
                              onToggleFreeze(item);
                            }}
                          >
                            <Icon name={item.frozen ? 'unlock' : 'lock'} size={14} />
                            {item.frozen ? t('content.unfreeze') : t('content.freeze')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {instance.content.length > 0 && (
        <div className="content-refresh-row">
          <button
            className={'content-refresh-link' + (refreshing ? ' spinning' : '')}
            onClick={handleRefresh}
            disabled={refreshing}
            title={t('content.refresh')}
          >
            <Icon name="refresh" size={12} />
            {t('content.refresh')}
          </button>
        </div>
      )}

      {changeVersionFor && (
        <ChangeModVersionModal
          instance={instance}
          item={changeVersionFor}
          onClose={() => setChangeVersionFor(null)}
          onChanged={async () => {
            setChangeVersionFor(null);
            await onReload();
            checkUpdates();
          }}
          pushToast={pushToast}
        />
      )}
    </div>
  );
}

// Íconos por nombre de carpeta conocida (mods, config, saves, etc. — las
// que Minecraft/los loaders crean solos en toda instancia) para que se
// distingan de un vistazo, igual que en CurseForge App/Modrinth App. Una
// carpeta que no está acá (una que el jugador creó a mano, o una de un mod
// puntual) sigue usando el ícono de carpeta genérico.
const KNOWN_FOLDER_ICONS = {
  config: 'gear',
  mods: 'package',
  resourcepacks: 'palette',
  shaderpacks: 'sparkles',
  saves: 'globe',
  screenshots: 'image',
  datapacks: 'database',
  logs: 'code',
  'crash-reports': 'alertTriangle',
};

// Extensiones que el editor de texto integrado sabe abrir con confianza
// (todas las que realmente aparecen en una instancia: configs de mods,
// listas de servidores/opciones en texto plano, logs, etc.). Cualquier otra
// extensión (imágenes, .jar, .nbt binario) se abre con la app del sistema en
// vez de intentar mostrarla como texto.
const EDITABLE_TEXT_EXTENSIONS = new Set([
  'txt', 'json', 'json5', 'toml', 'cfg', 'conf', 'config', 'properties', 'yml', 'yaml',
  'mcmeta', 'lang', 'log', 'ini', 'xml', 'md', 'csv', 'sh', 'bat', 'gitignore', 'js', 'snbt',
]);

function fileExtension(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}
function isEditableTextFile(name) {
  return EDITABLE_TEXT_EXTENSIONS.has(fileExtension(name));
}
function fileIconFor(name) {
  const ext = fileExtension(name);
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'].includes(ext)) return 'image';
  if (['nbt', 'dat', 'dat_old'].includes(ext)) return 'database';
  if (['jar', 'zip'].includes(ext)) return 'package';
  if (isEditableTextFile(name)) return 'code';
  return 'file';
}

function formatFileSize(bytes) {
  if (bytes == null) return '';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
function formatFileDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleString(undefined, {
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Explorador de archivos de la instancia: navega la carpeta en disco (mods,
 * config, saves, etc. y cualquier subcarpeta), permite crear/renombrar/
 * borrar, y abre un editor de texto integrado para los archivos de config
 * reconocidos (ver EDITABLE_TEXT_EXTENSIONS) — que es el pedido concreto de
 * poder tocar los archivos de la instancia sin salir del launcher. Todo pasa
 * por rutas RELATIVAS a la carpeta de la instancia; instanceStore.js del
 * lado del proceso principal es quien valida que nunca se escape de ahí.
 */
function FilesTab({ instanceId, pushToast }) {
  const t = useT();
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [rowMenuFor, setRowMenuFor] = useState(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [renaming, setRenaming] = useState(null); // { path, name }
  const [renamingBusy, setRenamingBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // { paths: [...] }
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dropTargetPath, setDropTargetPath] = useState(null); // carpeta puntual resaltada al arrastrar encima
  const [editingFile, setEditingFile] = useState(null); // { path, name, content, dirty, loading, saving }
  const addMenuRef = useRef(null);
  const rowMenuRef = useRef(null);

  async function load(targetPath) {
    setEntries(null);
    setSelected(new Set());
    try {
      const list = await window.hardLauncher.instances.listFiles(instanceId, targetPath);
      setEntries(list);
      setCurrentPath(targetPath);
    } catch (e) {
      pushToast?.(t('files.loadFailed', { error: e.message }), 'error');
      if (targetPath !== '') load('');
      else setEntries([]);
    }
  }

  useEffect(() => {
    load('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  useEffect(() => {
    function onClickOutside(e) {
      if (addMenuRef.current && !addMenuRef.current.contains(e.target)) setAddMenuOpen(false);
      if (rowMenuRef.current && !rowMenuRef.current.contains(e.target)) setRowMenuFor(null);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const segments = currentPath ? currentPath.split('/').filter(Boolean) : [];
  const filtered = (entries || []).filter((e) => e.name.toLowerCase().includes(query.toLowerCase()));

  function iconFor(item) {
    if (item.isDirectory) return (segments.length === 0 && KNOWN_FOLDER_ICONS[item.name]) || 'folder';
    return fileIconFor(item.name);
  }

  async function openEditor(item) {
    setEditingFile({ path: item.path, name: item.name, content: '', dirty: false, loading: true, saving: false });
    try {
      const content = await window.hardLauncher.instances.readTextFile(instanceId, item.path);
      setEditingFile({ path: item.path, name: item.name, content, dirty: false, loading: false, saving: false });
    } catch (e) {
      pushToast?.(t('files.readFailed', { error: e.message }), 'error');
      setEditingFile(null);
    }
  }

  async function handleRowActivate(item) {
    if (item.isDirectory) {
      load(item.path);
      return;
    }
    if (isEditableTextFile(item.name)) {
      openEditor(item);
      return;
    }
    try {
      await window.hardLauncher.instances.openPath(instanceId, item.path);
    } catch (e) {
      pushToast?.(t('files.openFailed', { error: e.message }), 'error');
    }
  }

  async function handleSaveEditor() {
    if (!editingFile) return;
    setEditingFile((prev) => ({ ...prev, saving: true }));
    try {
      await window.hardLauncher.instances.writeTextFile(instanceId, editingFile.path, editingFile.content);
      pushToast?.(t('files.savedToast', { name: editingFile.name }), 'info');
      setEditingFile(null);
      load(currentPath);
    } catch (e) {
      pushToast?.(t('files.saveFailed', { error: e.message }), 'error');
      setEditingFile((prev) => ({ ...prev, saving: false }));
    }
  }

  function toggleSelect(path) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  function toggleSelectAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((e) => e.path))));
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      await window.hardLauncher.instances.createFolder(instanceId, currentPath, name);
      setNewFolderOpen(false);
      setNewFolderName('');
      load(currentPath);
    } catch (e) {
      pushToast?.(t('files.createFailed', { error: e.message }), 'error');
    } finally {
      setCreatingFolder(false);
    }
  }

  async function handleRenameConfirm() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    setRenamingBusy(true);
    try {
      await window.hardLauncher.instances.renamePath(instanceId, renaming.path, name);
      setRenaming(null);
      load(currentPath);
    } catch (e) {
      pushToast?.(t('files.renameFailed', { error: e.message }), 'error');
    } finally {
      setRenamingBusy(false);
    }
  }

  async function handleDeleteConfirmed() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      await window.hardLauncher.instances.deletePaths(instanceId, confirmDelete.paths);
      setConfirmDelete(null);
      load(currentPath);
    } catch (e) {
      pushToast?.(t('files.deleteFailed', { error: e.message }), 'error');
    } finally {
      setDeleting(false);
    }
  }

  async function handleUpload() {
    setAddMenuOpen(false);
    setUploading(true);
    try {
      const added = await window.hardLauncher.instances.importFiles(instanceId, currentPath);
      if (added.length) load(currentPath);
    } catch (e) {
      pushToast?.(t('files.uploadFailed', { error: e.message }), 'error');
    } finally {
      setUploading(false);
    }
  }

  // Arrastrar y soltar archivos desde fuera del launcher (el Explorador de
  // Windows, Finder, etc.) directamente sobre la lista de "Archivos", como
  // atajo al mismo "Agregar > Subir archivos" de arriba pero sin pasar por
  // el diálogo nativo. dragCounter cuenta enter/leave anidados en vez de
  // guiarse por un solo dragOver: al arrastrar sobre la tabla, cada fila
  // hija dispara su propio dragEnter/dragLeave, y con un booleano simple el
  // resaltado parpadeaba cada vez que el cursor cruzaba de una fila a otra.
  const dragCounter = useRef(0);

  function handleDragEnter(e) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current += 1;
    setDragOver(true);
  }

  function handleDragOver(e) {
    // Necesario para que el navegador permita soltar acá (por default
    // rechaza el drop en cualquier elemento que no sea un input de archivo).
    e.preventDefault();
  }

  function handleDragLeave(e) {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) {
      setDragOver(false);
      setDropTargetPath(null);
    }
  }

  async function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    setDropTargetPath(null);
    const files = Array.from(e.dataTransfer.files || []);
    // File.path es lo que expone Electron (no existe en un navegador
    // normal) con la ruta absoluta en disco del archivo soltado — es lo que
    // necesita el proceso principal para copiarlo, a diferencia de un
    // <input type="file"> normal donde alcanzaría con leer el Blob.
    const filePaths = files.map((f) => f.path).filter(Boolean);
    if (filePaths.length === 0) return;
    setUploading(true);
    try {
      const added = await window.hardLauncher.instances.importFilesFromPaths(instanceId, currentPath, filePaths);
      if (added.length) load(currentPath);
    } catch (err) {
      pushToast?.(t('files.uploadFailed', { error: err.message }), 'error');
    } finally {
      setUploading(false);
    }
  }

  // Soltar encima puntualmente de una fila de carpeta (no en cualquier
  // parte de la lista): en vez de agregar los archivos a currentPath, van
  // directo adentro de esa subcarpeta sin tener que entrar primero. Cada
  // fila de carpeta se resalta (ver dropTargetPath) mientras el arrastre
  // pasa por encima, para que quede claro dónde va a caer el archivo antes
  // de soltarlo.
  function handleRowDragEnter(item, e) {
    if (!item.isDirectory) return;
    if (!e.dataTransfer.types.includes('Files')) return;
    setDropTargetPath(item.path);
  }

  function handleRowDragLeave(item, e) {
    if (!item.isDirectory) return;
    // Igual que en el contenedor grande: un hijo (el ícono, el texto del
    // nombre) puede disparar su propio dragLeave al pasar el cursor por
    // encima sin haber salido realmente de la fila.
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDropTargetPath((cur) => (cur === item.path ? null : cur));
  }

  async function handleRowDrop(item, e) {
    if (!item.isDirectory) return;
    e.preventDefault();
    // Corta acá la propagación: sin esto, el mismo evento de drop seguiría
    // subiendo hasta el handleDrop del contenedor grande de más abajo, que
    // volvería a importar los mismos archivos pero a currentPath — el
    // archivo terminaría duplicado, una vez adentro de la subcarpeta y otra
    // en la carpeta en la que ya se estaba parado.
    e.stopPropagation();
    setDropTargetPath(null);
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    const filePaths = files.map((f) => f.path).filter(Boolean);
    if (filePaths.length === 0) return;
    setUploading(true);
    try {
      const added = await window.hardLauncher.instances.importFilesFromPaths(instanceId, item.path, filePaths);
      // Ya que se agregaron archivos adentro de una subcarpeta y no de la
      // que se está viendo, alcanza con recargar currentPath para que se
      // actualice su contador de "N elementos" — no hace falta navegar dentro.
      if (added.length) load(currentPath);
    } catch (err) {
      pushToast?.(t('files.uploadFailed', { error: err.message }), 'error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className={'files-dropzone' + (dragOver ? ' drag-over' : '')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="files-drop-overlay">
          <Icon name="upload" size={32} />
          <span>
            {dropTargetPath
              ? t('files.dropIntoFolder', {
                  name: (entries || []).find((e) => e.path === dropTargetPath)?.name || '',
                })
              : t('files.dropHint')}
          </span>
        </div>
      )}
      <div className="content-toolbar">
        <button
          type="button"
          className="files-home-btn"
          title={t('files.home')}
          onClick={() => load('')}
          disabled={currentPath === ''}
        >
          <Icon name="home" size={16} />
        </button>
        <div className="content-search">
          <Icon name="search" size={15} />
          <input
            placeholder={t('files.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button className="btn-secondary btn-icon-label" onClick={() => load(currentPath)} title={t('files.refresh')}>
          <Icon name="refresh" size={14} />
          {t('files.refresh')}
        </button>
        <div className="instance-card-menu-wrap inline" ref={addMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn-primary btn-icon-label"
            onClick={() => setAddMenuOpen((o) => !o)}
            disabled={uploading}
          >
            <Icon name="plus" size={14} />
            {uploading ? t('files.uploading') : t('files.addMenu')}
            <Icon name="chevronDown" size={12} />
          </button>
          {addMenuOpen && (
            <div className="instance-card-menu" style={{ right: 0, left: 'auto' }}>
              <button
                type="button"
                className="instance-card-menu-item"
                onClick={() => {
                  setAddMenuOpen(false);
                  setNewFolderOpen(true);
                }}
              >
                <Icon name="folder" size={14} />
                {t('files.newFolder')}
              </button>
              <button type="button" className="instance-card-menu-item" onClick={handleUpload}>
                <Icon name="upload" size={14} />
                {t('files.uploadFiles')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="files-breadcrumb">
        <button type="button" className={'files-breadcrumb-item' + (segments.length === 0 ? ' current' : '')} onClick={() => load('')}>
          {t('files.root')}
        </button>
        {segments.map((seg, i) => {
          const isCurrent = i === segments.length - 1;
          return (
            <React.Fragment key={i}>
              <span className="files-breadcrumb-sep">
                <Icon name="chevronRight" size={13} />
              </span>
              <button
                type="button"
                className={'files-breadcrumb-item' + (isCurrent ? ' current' : '')}
                onClick={() => load(segments.slice(0, i + 1).join('/'))}
              >
                {seg}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {selected.size > 0 && (
        <div className="files-selection-bar">
          <span>{t('files.selected', { n: selected.size })}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-danger btn-icon-label"
              onClick={() => setConfirmDelete({ paths: Array.from(selected) })}
            >
              <Icon name="trash" size={13} />
              {t('common.delete')}
            </button>
            <button className="btn-secondary btn-icon-label" onClick={() => setSelected(new Set())}>
              {t('files.clearSelection')}
            </button>
          </div>
        </div>
      )}

      {entries === null ? (
        <p style={{ color: 'var(--text-secondary)' }}>{t('files.loading')}</p>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="folder" size={64} strokeWidth={1.3} />
          </div>
          <div className="empty-state-title">{t('files.emptyTitle')}</div>
          <div className="empty-state-subtitle">{t('files.emptySub')}</div>
        </div>
      ) : filtered.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>{t('files.noMatch')}</p>
      ) : (
        <div className="files-table">
          <div className="files-table-head">
            <label className="custom-checkbox-row" style={{ margin: 0 }}>
              <input type="checkbox" checked={selected.size === filtered.length} onChange={toggleSelectAll} />
              <span className="custom-checkbox-box" />
            </label>
            <span>{t('files.colName')}</span>
            <span>{t('files.colSize')}</span>
            <span>{t('files.colCreated')}</span>
            <span>{t('files.colModified')}</span>
            <span />
          </div>
          {filtered.map((item) => (
            <div
              key={item.path}
              className={'files-row' + (item.isDirectory && dropTargetPath === item.path ? ' drop-target' : '')}
              onDragEnter={item.isDirectory ? (e) => handleRowDragEnter(item, e) : undefined}
              onDragLeave={item.isDirectory ? (e) => handleRowDragLeave(item, e) : undefined}
              onDrop={item.isDirectory ? (e) => handleRowDrop(item, e) : undefined}
            >
              <label className="custom-checkbox-row" style={{ margin: 0 }} onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selected.has(item.path)} onChange={() => toggleSelect(item.path)} />
                <span className="custom-checkbox-box" />
              </label>
              <button
                type="button"
                className={'files-row-name-btn' + (item.isDirectory ? '' : ' is-file')}
                onClick={() => handleRowActivate(item)}
                title={item.name}
              >
                <span className="files-row-icon">
                  <Icon name={iconFor(item)} size={14} />
                </span>
                <span>{item.name}</span>
              </button>
              <span className="files-row-meta">
                {item.isDirectory
                  ? item.itemCount === 1
                    ? t('files.itemOne')
                    : t('files.itemsCount', { n: item.itemCount })
                  : formatFileSize(item.size)}
              </span>
              <span className="files-row-meta">{formatFileDate(item.created)}</span>
              <span className="files-row-meta">{formatFileDate(item.modified)}</span>
              <div
                className="instance-card-menu-wrap inline"
                ref={rowMenuFor === item.path ? rowMenuRef : undefined}
                style={{ position: 'relative' }}
              >
                <button
                  type="button"
                  className="instance-card-menu-btn"
                  title={t('common.options')}
                  onClick={() => setRowMenuFor((cur) => (cur === item.path ? null : item.path))}
                >
                  <Icon name="dots" size={15} />
                </button>
                {rowMenuFor === item.path && (
                  <div className="instance-card-menu" style={{ right: 0, left: 'auto' }}>
                    {!item.isDirectory && isEditableTextFile(item.name) && (
                      <button
                        type="button"
                        className="instance-card-menu-item"
                        onClick={() => {
                          setRowMenuFor(null);
                          openEditor(item);
                        }}
                      >
                        <Icon name="code" size={14} />
                        {t('files.edit')}
                      </button>
                    )}
                    <button
                      type="button"
                      className="instance-card-menu-item"
                      onClick={() => {
                        setRowMenuFor(null);
                        setRenaming({ path: item.path, name: item.name });
                      }}
                    >
                      <Icon name="pencil" size={14} />
                      {t('files.rename')}
                    </button>
                    <button
                      type="button"
                      className="instance-card-menu-item"
                      onClick={() => {
                        setRowMenuFor(null);
                        window.hardLauncher.instances.revealPath(instanceId, item.path);
                      }}
                    >
                      <Icon name="externalLink" size={14} />
                      {t('files.reveal')}
                    </button>
                    <button
                      type="button"
                      className="instance-card-menu-item danger"
                      onClick={() => {
                        setRowMenuFor(null);
                        setConfirmDelete({ paths: [item.path] });
                      }}
                    >
                      <Icon name="trash" size={14} />
                      {t('common.delete')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {newFolderOpen && (
        <div className="modal-overlay" onClick={() => !creatingFolder && setNewFolderOpen(false)}>
          <div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{t('files.newFolderTitle')}</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setNewFolderOpen(false)} aria-label={t('common.close')}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <input
              autoFocus
              placeholder={t('files.newFolderPlaceholder')}
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateFolder()}
              style={{ marginTop: 4, width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleCreateFolder} disabled={creatingFolder || !newFolderName.trim()}>
                {creatingFolder ? t('common.creating') : t('files.create')}
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setNewFolderOpen(false)} disabled={creatingFolder}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {renaming && (
        <div className="modal-overlay" onClick={() => !renamingBusy && setRenaming(null)}>
          <div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{t('files.renameTitle')}</h3>
              </div>
              <button className="modal-close-btn" onClick={() => setRenaming(null)} aria-label={t('common.close')}>
                <Icon name="close" size={16} />
              </button>
            </div>
            <input
              autoFocus
              value={renaming.name}
              onChange={(e) => setRenaming((prev) => ({ ...prev, name: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameConfirm()}
              style={{ marginTop: 4, width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-primary" style={{ flex: 1 }} onClick={handleRenameConfirm} disabled={renamingBusy || !renaming.name.trim()}>
                {renamingBusy ? t('common.saving') : t('files.rename')}
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setRenaming(null)} disabled={renamingBusy}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => !deleting && setConfirmDelete(null)}>
          <div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{t('files.deleteConfirmTitle', { n: confirmDelete.paths.length })}</h3>
                <p className="modal-subtitle">{t('files.deleteConfirmBody')}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button className="btn-danger" style={{ flex: 1 }} onClick={handleDeleteConfirmed} disabled={deleting}>
                {deleting ? t('files.deleting') : t('common.delete')}
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDelete(null)} disabled={deleting}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {editingFile && (
        <TextFileEditor
          file={editingFile}
          onChange={(content) => setEditingFile((prev) => ({ ...prev, content, dirty: true }))}
          onSave={handleSaveEditor}
          onClose={() => setEditingFile(null)}
        />
      )}
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

function WorldsTab({ instanceId, pushToast, refreshSignal, onPlayWorld }) {
  const t = useT();
  const [worlds, setWorlds] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [settingsWorld, setSettingsWorld] = useState(null);
  const [exportingPath, setExportingPath] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  // Mismo motivo que en FilesTab: cuenta enter/leave anidados en vez de un
  // solo booleano, porque cada hijo del dropzone (tarjetas, íconos) dispara
  // su propio dragEnter/dragLeave al pasar el cursor por encima sin haber
  // salido en realidad del contenedor grande.
  const dragCounter = useRef(0);

  // `silent`: no prende el indicador de "Actualizando..." — se usa para los
  // disparadores automáticos (montaje, refreshSignal, foco de ventana) para
  // no meter un spinner encima de la grilla cada vez que alguna de esas
  // señales se dispara sin que el jugador haya pedido nada. El botón manual
  // de abajo sí lo prende, para que quede claro que el click hizo algo.
  function reload(silent = true) {
    if (!silent) setRefreshing(true);
    return window.hardLauncher.instances
      .listWorlds(instanceId)
      .then(setWorlds)
      .finally(() => {
        if (!silent) setRefreshing(false);
      });
  }

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId]);

  // Recarga también cuando el juego se cierra (refreshSignal cambia en el
  // padre en cada onExit): adentro del juego se puede haber cambiado la
  // dificultad, activado hardcore, creado un mundo nuevo, etc.
  const isFirstRefreshSignal = useRef(true);
  useEffect(() => {
    if (isFirstRefreshSignal.current) {
      isFirstRefreshSignal.current = false;
      return;
    }
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal]);

  // Red de seguridad además de refreshSignal (que depende de que
  // game.onExit se haya disparado): cada vez que el jugador vuelve a
  // enfocar la ventana del launcher mientras esta pestaña está montada, se
  // vuelve a leer /saves de disco. Cubre los casos en los que el proceso
  // del juego termina de una forma que el launcher no llega a detectar
  // como "salida normal" (cierre forzado, crash), o simplemente el jugador
  // vuelve a mirar el launcher sin haber cerrado Minecraft todavía.
  useEffect(() => {
    const unsub = window.hardLauncher.window.onFocus(() => reload());
    return unsub;
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

  // Arrastrar y soltar la carpeta o el .zip de un mundo directo sobre
  // "Mundos", como atajo a copiar/descomprimir a mano dentro de /saves.
  // Uno por uno (no en paralelo) para no pisarse entre sí al elegir nombre
  // de carpeta libre si se sueltan varios a la vez con el mismo nombre base.
  function handleDragEnter(e) {
    e.preventDefault();
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current += 1;
    setDragOver(true);
  }

  function handleDragOver(e) {
    e.preventDefault();
  }

  function handleDragLeave(e) {
    if (!e.dataTransfer.types.includes('Files')) return;
    dragCounter.current = Math.max(0, dragCounter.current - 1);
    if (dragCounter.current === 0) setDragOver(false);
  }

  async function handleDrop(e) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []);
    const filePaths = files.map((f) => f.path).filter(Boolean);
    if (filePaths.length === 0) return;

    setImporting(true);
    let importedCount = 0;
    for (const filePath of filePaths) {
      try {
        const world = await window.hardLauncher.instances.importWorld(instanceId, filePath);
        setWorlds((prev) => [world, ...(prev || [])]);
        importedCount += 1;
      } catch (err) {
        pushToast?.(t('world.toastImportFailed', { error: err.message }), 'error');
      }
    }
    setImporting(false);
    if (importedCount > 0) {
      pushToast?.(
        importedCount === 1 ? t('world.toastImported') : t('world.toastImportedMany', { n: importedCount }),
        'success'
      );
    }
  }

  // Botón de refresco manual: además de los disparadores automáticos
  // (montaje, cierre del juego, foco de ventana — ver los useEffect de
  // arriba), esto le da al jugador una forma directa de forzar una
  // relectura fresca de /saves si por lo que sea no confía en que ya se
  // haya actualizado sola (ej. cambió algo y volvió al launcher sin que la
  // ventana perdiera el foco en el medio).
  const refreshButton = (
    <button
      type="button"
      className={'content-refresh-link' + (refreshing ? ' spinning' : '')}
      onClick={() => reload(false)}
      disabled={refreshing}
      title={t('worlds.refresh')}
    >
      <Icon name="refresh" size={14} />
      {refreshing ? t('worlds.refreshing') : t('worlds.refresh')}
    </button>
  );

  if (worlds === null) return <p style={{ color: 'var(--text-secondary)' }}>{t('worlds.loading')}</p>;
  if (worlds.length === 0) {
    return (
      <div
        className={'files-dropzone' + (dragOver ? ' drag-over' : '')}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="files-drop-overlay">
            <Icon name="upload" size={32} />
            <span>{t('worlds.dropHint')}</span>
          </div>
        )}
        <div className="content-toolbar" style={{ justifyContent: 'flex-end' }}>
          {refreshButton}
        </div>
        <div className="empty-state">
          <div className="empty-state-icon">
            <Icon name="globe" size={64} strokeWidth={1.3} />
          </div>
          <div className="empty-state-title">{t('worlds.emptyTitle')}</div>
          <div className="empty-state-subtitle">{importing ? t('worlds.importing') : t('worlds.emptySub')}</div>

          {/* Indicador permanente de que se puede arrastrar y soltar acá
              (antes solo aparecía el aviso MIENTRAS se estaba arrastrando
              un archivo encima — dragOver — así que si nadie probaba a
              arrastrar, nunca se enteraba de que la opción existía). Con
              este recuadro punteado siempre visible, más el mismo texto que
              ya usa worlds.dropHint, queda claro de entrada sin depender de
              adivinar. */}
          {!importing && (
            <div className="empty-state-drop-hint">
              <Icon name="upload" size={18} />
              <span>{t('worlds.dropHint')}</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={'files-dropzone' + (dragOver ? ' drag-over' : '')}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && (
        <div className="files-drop-overlay">
          <Icon name="upload" size={32} />
          <span>{t('worlds.dropHint')}</span>
        </div>
      )}
      <div className="content-toolbar" style={{ justifyContent: 'flex-end' }}>
        {refreshButton}
      </div>
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
            onPlay={onPlayWorld ? () => onPlayWorld(w) : undefined}
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
    </div>
  );
}

function WorldCard({ world, index, exporting, onConfigure, onDuplicate, onExport, onOpenFolder, onDelete, onPlay }) {
  const t = useT();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const info = world.info;
  const isHardcore = !!info?.hardcore;

  return (
    <motion.div
      className={'world-card' + (isHardcore ? ' world-card-hardcore' : '')}
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

        {/* Distintivo de hardcore: corazón (PNG pixel art) en la esquina
            opuesta al menú, para que un mundo de una sola vida se identifique
            de entrada con solo mirar la miniatura (no solo leyendo el badge
            de texto más abajo). */}
        {isHardcore && (
          <div className="world-card-hardcore-tag" title={t('world.hardcoreBadge')}>
            <img src={hardcoreHeartIcon} alt="" className="world-card-hardcore-tag-icon" />
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

        {onPlay && (
          <div className="world-card-play-overlay">
            {/* Mismo botón "Jugar" (ícono + texto, estilo btn-primary) que se
                usa en la lista de servidores recomendados, en vez del círculo
                genérico anterior, para que la acción principal se lea igual
                de clara en ambos lugares. */}
            <motion.button
              type="button"
              className="btn-primary btn-icon-label world-card-play-btn"
              title={t('world.play')}
              whileHover={{ scale: 1.04 }}
              whileTap={{ scale: 0.96 }}
              onClick={(e) => {
                e.stopPropagation();
                onPlay();
              }}
            >
              <Icon name="play" size={17} />
              {t('world.play')}
            </motion.button>
          </div>
        )}

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
          {/* En hardcore el modo de juego siempre es Supervivencia (Minecraft
              lo fuerza así), así que ese badge es redundante junto al de
              Hardcore: se lo reemplaza en vez de mostrar los dos. Hardcore
              va primero porque es el dato más importante del mundo. */}
          {info && !info.hardcore && (
            <span className="badge badge-sm">{t(GAME_TYPE_KEYS[info.gameType] ?? GAME_TYPE_KEYS[0])}</span>
          )}
          {info?.hardcore && (
            <span className="badge badge-sm badge-hardcore">
              <img src={hardcoreHeartIcon} alt="" className="badge-hardcore-icon" />
              {t('world.hardcoreBadge')}
            </span>
          )}
          {info && <span className="badge badge-sm">{t(DIFFICULTY_KEYS[info.difficulty] ?? DIFFICULTY_KEYS[2])}</span>}
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

  // El hardcore de Minecraft no es un modificador más: mientras está
  // prendido, el juego mismo fuerza modo Supervivencia + dificultad Difícil
  // y no deja activar trucos (si perdés toda tu vida, se acabó — dejar
  // cualquiera de esas tres cosas "sueltas" abriría la puerta a un mundo
  // hardcore más fácil de lo que debería ser, o directamente inconsistente
  // con lo que el juego reescribe solo la próxima vez que lo abrís). Así que
  // acá se refleja lo mismo: al prender el toggle, se pisan gameType/
  // difficulty/allowCommands al toque, y mientras siga prendido esos tres
  // controles quedan bloqueados (ver `disabled` más abajo) para que no se
  // puedan volver a tocar sin antes apagar hardcore.
  useEffect(() => {
    if (hardcore) {
      setGameType(0);
      setDifficulty(3);
      setAllowCommands(false);
    }
  }, [hardcore]);

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
                    disabled={hardcore}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="modal-section-label">{t('world.difficultyLabel')}</div>
                  <Select
                    value={difficulty}
                    onChange={setDifficulty}
                    options={DIFFICULTY_KEYS.map((key, value) => ({ value, label: t(key) }))}
                    disabled={hardcore}
                  />
                </div>
              </div>
              {hardcore && (
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: -6 }}>
                  {t('world.hardcoreLocksHint')}
                </div>
              )}

              <div className="content-row" style={{ padding: '10px 12px' }}>
                <div className="content-row-info">
                  <div className="content-row-title">{t('world.hardcoreBadge')}</div>
                  <div className="content-row-subtitle">{t('world.hardcoreDesc')}</div>
                </div>
                <div className={'toggle' + (hardcore ? ' on' : '')} onClick={() => setHardcore((v) => !v)} />
              </div>

              <div className="content-row" style={{ padding: '10px 12px', opacity: hardcore ? 0.5 : 1 }}>
                <div className="content-row-info">
                  <div className="content-row-title">{t('world.cheatsBadge')}</div>
                  <div className="content-row-subtitle">{t('world.cheatsDesc')}</div>
                </div>
                <div
                  className={'toggle' + (allowCommands ? ' on' : '')}
                  onClick={() => !hardcore && setAllowCommands((v) => !v)}
                  style={hardcore ? { pointerEvents: 'none', cursor: 'not-allowed' } : undefined}
                />
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
                    onClick={() => window.hardLauncher.instances.showScreenshotInFolder(instanceId, current.path)}
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
