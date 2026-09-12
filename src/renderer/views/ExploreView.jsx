import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import FilterBar from '../components/FilterBar.jsx';
import Select from '../components/Select.jsx';
import Pagination from '../components/Pagination.jsx';
import InstanceTargetPicker from '../components/InstanceTargetPicker.jsx';
import ProgressBar from '../components/ProgressBar.jsx';
import Icon from '../components/Icon.jsx';
import { useT } from '../i18n.js';

// BUG FIX: a esta lista le faltaba el tipo 'mod', que es el projectType con el
// que arranca la vista (useState('mod') más abajo). Como TYPES.find(...) no
// encontraba ningún elemento con id 'mod', el .label siguiente se leía sobre
// undefined y tiraba un TypeError en el primer render -> React desmontaba todo
// el árbol sin ningún Error Boundary que lo contuviera, dejando la pantalla
// en negro apenas se abría "Explorar". Con 'mod' presente el render nunca
// falla.
function getTypes(tr) {
  return [
    { id: 'mod', label: tr('type.mod') },
    { id: 'resourcepack', label: tr('type.resourcepack') },
    { id: 'shader', label: tr('type.shader') },
    { id: 'modpack', label: tr('type.modpack') },
    { id: 'datapack', label: tr('type.datapack') },
  ];
}

function getSortOptions(tr) {
  return [
    { id: 'relevance', label: tr('explore.sort.relevance') },
    { id: 'downloads', label: tr('explore.sort.downloads') },
    { id: 'follows', label: tr('explore.sort.follows') },
    { id: 'newest', label: tr('explore.sort.newest') },
    { id: 'updated', label: tr('explore.sort.updated') },
  ];
}

// Opciones para "cuántos ver por página", igual que el selector de View de Modrinth.
const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100];
const DEFAULT_LIMIT = 20;

export default function ExploreView() {
  const tr = useT();
  const TYPES = getTypes(tr);
  const SORT_OPTIONS = getSortOptions(tr);
  const { instances, refreshInstances, pushToast, setInlineInstallActive } = useAppStore();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Selector "elegir versión del juego" que aparece al instalar un modpack
  // directo desde los resultados de Explorar (en vez de agregarlo como
  // contenido de una instancia existente, un modpack siempre genera una
  // instancia propia nueva). { hit, gameVersions, selected, versions } | null
  const [modpackPicker, setModpackPicker] = useState(null);
  const [installingModpackId, setInstallingModpackId] = useState(null);

  // BUG FIX (raíz del bug de "dice Modpacks pero lista mods", ver también el
  // guard de requestId en doSearch más abajo): antes projectType arrancaba
  // siempre en 'mod' y un efecto aparte lo corregía a ?type=modpack un tick
  // después — eso disparaba una búsqueda de mods de más, que corría en
  // paralelo con la de modpacks y podía pisarla si volvía tarde. Inicializar
  // el estado ya directamente con el valor de la URL evita ese primer
  // request innecesario (y todo el races que traía consigo) en vez de
  // solamente mitigarlo del lado de la respuesta.
  const [projectType, setProjectType] = useState(() => {
    const type = searchParams.get('type');
    const fromInstance = searchParams.get('instance');
    if (type && TYPES.some((t) => t.id === type) && !(type === 'modpack' && fromInstance)) return type;
    return 'mod';
  });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('relevance');
  const [categories, setCategories] = useState([]);
  const [loaders, setLoaders] = useState([]);
  const [mcVersions, setMcVersions] = useState([]);

  const [allCategories, setAllCategories] = useState([]);
  const [allLoaders, setAllLoaders] = useState([]);
  const [allGameVersions, setAllGameVersions] = useState([]);

  const [results, setResults] = useState([]);
  const [totalHits, setTotalHits] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [loading, setLoading] = useState(false);
  const [installingId, setInstallingId] = useState(null);
  // Progreso (0-100 o null si es indeterminado) de la instalación en curso
  // desde esta lista — sea un mod/resourcepack/shader (installingId) o un
  // modpack (installingModpackId). Solo puede haber una instalación activa
  // por vez acá (ambos flags son un solo id, no un set), así que un único
  // estado compartido alcanza para saber qué mostrar en la fila que
  // corresponda.
  const [installProgress, setInstallProgress] = useState(null); // { percent, file } | null
  const [targetInstanceId, setTargetInstanceId] = useState(instances[0]?.id || '');
  const [appliedInstanceParam, setAppliedInstanceParam] = useState(false);

  const targetInstance = instances.find((i) => i.id === targetInstanceId);
  const installedProjectIds = new Set((targetInstance?.content || []).map((c) => c.projectId));

  // Un modpack SIEMPRE genera su propia instancia nueva (con su ícono y todo
  // su contenido ya instalado) — nunca se "agrega" adentro de una instancia
  // que ya existe. Por eso, cuando se llega acá desde el botón "Explorar" de
  // una instancia puntual (que trae ?instance= en la URL, ver
  // InstanceDetailView), la pestaña "Modpacks" no tiene sentido ahí y se
  // oculta: mostrarla invitaba a pensar que ese modpack se instalaría DENTRO
  // de la instancia actual, cuando en realidad crearía una completamente
  // aparte.
  const instanceParam = searchParams.get('instance');
  const modpacksAllowed = !instanceParam;
  const visibleTypes = modpacksAllowed ? TYPES : TYPES.filter((t) => t.id !== 'modpack');

  // Nota: el tipo inicial ya se resuelve arriba, en el useState de
  // projectType, directamente desde ?type= — no hace falta un efecto aparte
  // para "corregirlo" después del primer render (ver el BUG FIX de arriba).

  // Si se llega desde el botón "Explorar" de una instancia (ver
  // InstanceDetailView), esa instancia queda preseleccionada como destino
  // de instalación y los filtros de versión/loader se ajustan para mostrar
  // solo contenido compatible con ella.
  useEffect(() => {
    const instanceId = searchParams.get('instance');
    if (!instanceId || appliedInstanceParam || instances.length === 0) return;
    const inst = instances.find((i) => i.id === instanceId);
    if (!inst) return;
    setTargetInstanceId(inst.id);
    setMcVersions([inst.mcVersion]);
    // Igual que en handleInstall: preseleccionar el loader como filtro solo
    // tiene sentido para mods/modpacks. Si el tipo activo es resourcepack o
    // shader, ese loader no existe como categoría ahí y el resultado
    // quedaba vacío apenas se entraba desde una instancia con mod loader.
    if (inst.loader !== 'vanilla' && (projectType === 'mod' || projectType === 'modpack')) {
      setLoaders([inst.loader]);
    }
    setAppliedInstanceParam(true);
  }, [instances, searchParams, appliedInstanceParam]);

  // Carga inicial de tags (categorías/loaders/versiones) para armar los filtros.
  useEffect(() => {
    window.hardLauncher.modrinth.categories().then(setAllCategories);
    window.hardLauncher.modrinth.loaders().then(setAllLoaders);
    window.hardLauncher.modrinth.gameVersions().then(setAllGameVersions);
  }, []);

  // Progreso de instalación mostrado INLINE, en el propio rectángulo del
  // mod/modpack que se está instalando, en vez del toast flotante de
  // siempre (ver InstallProgressToast.jsx) — que mientras tanto se queda
  // callado (ver inlineInstallActive en store.js) para no duplicar la
  // misma información en dos lugares a la vez. Nada de esto bloquea el
  // resto de la pantalla: buscar, cambiar de página o pedir instalar otro
  // ítem sigue andando igual mientras esto corre en el fondo.
  //
  // Se re-suscribe cuando cambia installingId/installingModpackId nada más
  // para poder chequear "hay algo instalándose desde acá" con el valor
  // fresco sin depender de refs; el listener en sí es liviano, resuscribirse
  // no tiene costo real.
  useEffect(() => {
    const unsub = window.hardLauncher.modrinth.onInstallProgress((data) => {
      if (!installingId && !installingModpackId) return; // no es una instalación disparada desde esta lista
      if (data.stage === 'progress' && data.total) {
        setInstallProgress({ percent: (data.downloaded / data.total) * 100, file: data.file });
      } else if (data.stage === 'downloading' && data.total) {
        setInstallProgress({
          percent: (data.completed / data.total) * 100,
          file: `${data.completed} / ${data.total} archivos`,
        });
      } else {
        setInstallProgress({ percent: null, file: data.file });
      }
    });
    return unsub;
  }, [installingId, installingModpackId]);

  // Si esta vista se desmonta a mitad de una instalación (el usuario
  // navegó a otra pantalla apretando un link), el toast flotante global
  // tiene que volver a poder mostrarse — si no, la instalación seguiría
  // corriendo en segundo plano sin ningún indicador visible en ningún lado.
  useEffect(() => () => setInlineInstallActive(false), [setInlineInstallActive]);

  // BUG FIX ("Explorar" muestra un tipo de contenido pero el título de arriba
  // dice otro — ej. entrás a "Instalar modpack" -> "Explorar modpacks", el
  // botón activo/el texto quedan en "Modpacks" pero la lista de resultados
  // son mods): esta vista monta con projectType inicial 'mod' y, en el mismo
  // ciclo de renders, el efecto de más arriba lo corrige a 'modpack' según
  // ?type=modpack. El efecto de búsqueda de abajo reacciona a projectType y
  // por lo tanto dispara DOS pedidos casi seguidos: uno para 'mod' (con el
  // valor inicial) y, apenas después, uno para 'modpack' (con el valor ya
  // corregido). Como ambos son pedidos de red independientes, no hay ninguna
  // garantía de que la respuesta de 'mod' vuelva antes que la de 'modpack' —
  // si llega después, pisa los resultados ya mostrados con los del tipo
  // viejo aunque la pestaña activa siga diciendo "Modpacks". Lo mismo puede
  // pasar al cambiar de pestaña rápido o al tocar cualquier filtro dos veces
  // seguidas antes de que la primera búsqueda termine. searchRequestIdRef
  // numera cada pedido; si para cuando responde ya no es el más reciente, se
  // descarta en vez de aplicarse.
  const searchRequestIdRef = useRef(0);

  async function doSearch(nextOffset = 0, nextLimit = limit) {
    const requestId = ++searchRequestIdRef.current;
    setLoading(true);
    try {
      const data = await window.hardLauncher.modrinth.search({
        query,
        projectType,
        index: sort,
        categories,
        loaders,
        mcVersions,
        offset: nextOffset,
        limit: nextLimit,
      });
      if (requestId !== searchRequestIdRef.current) return; // llegó una búsqueda más nueva antes: se descarta esta respuesta vieja.
      setResults(data.hits);
      setTotalHits(data.total_hits);
      setOffset(nextOffset);
    } finally {
      if (requestId === searchRequestIdRef.current) setLoading(false);
    }
  }

  // Re-busca automáticamente cuando cambia cualquier filtro (tipo, categorías, loader, versión u orden).
  useEffect(() => {
    doSearch(0);
  }, [projectType, sort, categories, loaders, mcVersions]);

  // Cambiar "cuántos ver por página" vuelve a la página 1 con el nuevo tamaño.
  function handleLimitChange(newLimit) {
    setLimit(newLimit);
    doSearch(0, newLimit);
  }

  function toggleFrom(list, setList, value) {
    setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  }

  // Las categorías y loaders son específicos de cada tipo de proyecto (ej.
  // "technology" no existe para resource packs, "fabric" no aplica ahí
  // tampoco). Si quedaban seleccionados de una pestaña anterior, el facet
  // combinado no matcheaba nada y la búsqueda devolvía cero resultados.
  //
  // También se refleja el tipo elegido en la URL (?type=...) con "replace"
  // (sin agregar una entrada nueva al historial): así, si el usuario abre un
  // proyecto desde acá y después vuelve para atrás, esta vista se remonta
  // sabiendo en qué pestaña estaba (ver backHref más abajo) en vez de volver
  // siempre a "Mods" por default.
  function handleProjectTypeChange(newType) {
    setProjectType(newType);
    setCategories([]);
    setLoaders([]);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('type', newType);
        return next;
      },
      { replace: true }
    );
  }

  function clearFilters() {
    setCategories([]);
    setLoaders([]);
    setMcVersions([]);
  }

  async function handleInstall(hit) {
    if (!targetInstance) {
      pushToast(tr('explore.needTarget'), 'error');
      return;
    }
    setInstallingId(hit.project_id);
    setInstallProgress(null);
    setInlineInstallActive(true);
    try {
      // El filtro "loader" de Modrinth solo tiene sentido para mods y
      // modpacks (fabric/forge/quilt/neoforge). Los resource packs usan el
      // tag "minecraft" y los shaders usan tags como "iris"/"optifine"/
      // "canvas", que nunca coinciden con el loader de la instancia — si se
      // mandaba igual, la API devolvía 0 versiones y aparecía el falso
      // "No hay una versión compatible" para packs y shaders perfectamente
      // instalables. Solo se filtra por loader cuando aplica.
      const usesLoaderFilter = hit.project_type === 'mod' || hit.project_type === 'modpack';
      const versionsForHit = await window.hardLauncher.modrinth.versions(hit.project_id, {
        mcVersion: targetInstance.mcVersion,
        loader: usesLoaderFilter && targetInstance.loader !== 'vanilla' ? targetInstance.loader : undefined,
      });
      if (!versionsForHit.length) {
        pushToast(tr('explore.noCompat'), 'error');
        return;
      }
      await window.hardLauncher.modrinth.installMod(targetInstance.id, versionsForHit[0]);
      await refreshInstances();
      pushToast(tr('explore.installedIn', { title: hit.title, name: targetInstance.name }), 'success');
    } catch (e) {
      pushToast(tr('explore.installError', { error: e.message }), 'error');
    } finally {
      setInstallingId(null);
      setInstallProgress(null);
      setInlineInstallActive(false);
    }
  }

  // Un modpack siempre crea su propia instancia (con su ícono y todo su
  // contenido ya instalado), así que en vez del botón "Instalar" normal
  // (que agrega contenido a una instancia existente) se abre un pequeño
  // selector para elegir para qué versión del juego se quiere instalar.
  async function openModpackPicker(hit) {
    if (modpackPicker?.hit.project_id === hit.project_id) {
      setModpackPicker(null);
      return;
    }
    setModpackPicker({ hit, versions: [], gameVersions: [], selected: '', loading: true });
    try {
      const allVersions = await window.hardLauncher.modrinth.versions(hit.project_id, {});
      const withMrpack = allVersions.filter((v) => (v.files || []).some((f) => f.filename.toLowerCase().endsWith('.mrpack')));
      const gameVersions = Array.from(new Set(withMrpack.flatMap((v) => v.game_versions || [])));
      if (!withMrpack.length) {
        pushToast(tr('explore.modpackNoVersions'), 'error');
        setModpackPicker(null);
        return;
      }
      setModpackPicker({ hit, versions: withMrpack, gameVersions, selected: gameVersions[0] || '', loading: false });
    } catch (e) {
      pushToast(tr('explore.modpackVersionsError', { error: e.message }), 'error');
      setModpackPicker(null);
    }
  }

  async function confirmModpackInstall() {
    if (!modpackPicker) return;
    const match = modpackPicker.versions.find((v) => (v.game_versions || []).includes(modpackPicker.selected));
    if (!match) {
      pushToast(tr('explore.modpackNoMc'), 'error');
      return;
    }
    setInstallingModpackId(modpackPicker.hit.project_id);
    setInstallProgress(null);
    setInlineInstallActive(true);
    try {
      const instance = await window.hardLauncher.modrinth.installModpackFromVersion(match, modpackPicker.hit.title);
      await refreshInstances();
      pushToast(tr('explore.modpackInstalled', { title: modpackPicker.hit.title }), 'success');
      setModpackPicker(null);
      navigate(`/instances/${instance.id}`);
    } catch (e) {
      pushToast(tr('explore.modpackError', { error: e.message }), 'error');
    } finally {
      setInstallingModpackId(null);
      setInstallProgress(null);
      setInlineInstallActive(false);
    }
  }

  return (
    <div>
      <h1 style={{ marginBottom: 16 }}>{tr('explore.title')}</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {visibleTypes.map((type) => (
          <button
            key={type.id}
            className={projectType === type.id ? 'btn-primary' : 'btn-secondary'}
            onClick={() => handleProjectTypeChange(type.id)}
          >
            {type.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <input
          style={{ flex: 1 }}
          placeholder={tr('explore.searchPlaceholder', { type: TYPES.find((type) => type.id === projectType).label.toLowerCase() })}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch(0)}
        />
        <InstanceTargetPicker instances={instances} value={targetInstanceId} onChange={setTargetInstanceId} />
        <button className="btn-primary" onClick={() => doSearch(0)}>
          {tr('common.search')}
        </button>
      </div>

      {projectType === 'modpack' && (
        <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: -8, marginBottom: 14 }}>
          {tr('explore.modpackHint')}
        </p>
      )}

      <FilterBar
        projectType={projectType}
        allCategories={allCategories}
        allLoaders={allLoaders}
        allGameVersions={allGameVersions}
        categories={categories}
        loaders={loaders}
        mcVersions={mcVersions}
        onToggleCategory={(c) => toggleFrom(categories, setCategories, c)}
        onToggleLoader={(l) => toggleFrom(loaders, setLoaders, l)}
        onToggleVersion={(v) => toggleFrom(mcVersions, setMcVersions, v)}
        onClear={clearFilters}
      />

      <div>
          <div className="results-toolbar">
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
              {loading && offset === 0 ? tr('explore.searching') : tr('explore.results', { n: totalHits.toLocaleString() })}
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <Select
                value={limit}
                onChange={handleLimitChange}
                style={{ minWidth: 110 }}
                options={PAGE_SIZE_OPTIONS.map((n) => ({ value: n, label: tr('explore.view', { n }) }))}
              />
              <Select
                value={sort}
                onChange={setSort}
                style={{ minWidth: 200 }}
                options={SORT_OPTIONS.map((s) => ({ value: s.id, label: tr('explore.sortBy', { label: s.label }) }))}
              />
            </div>
          </div>

          {/* Mismo selector de página que al pie, repetido acá arriba para no
              tener que bajar hasta el final de 20-100 resultados solo para
              cambiar de página. */}
          <Pagination
            page={Math.floor(offset / limit) + 1}
            totalPages={Math.max(1, Math.ceil(totalHits / limit))}
            disabled={loading}
            onChange={(p) => doSearch((p - 1) * limit)}
            variant="top"
          />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <AnimatePresence mode="popLayout">
              {results.map((hit, i) => {
              const isModpackHit = hit.project_type === 'modpack';
              const pickerOpen = isModpackHit && modpackPicker?.hit.project_id === hit.project_id;
              return (
                <motion.div
                  key={hit.project_id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2, delay: Math.min(i * 0.02, 0.3), ease: [0.16, 1, 0.3, 1] }}
                  className="card result-row"
                  style={{ flexDirection: 'column', alignItems: 'stretch', position: 'relative', overflow: 'hidden' }}
                >
                  <div style={{ display: 'flex', gap: 12 }}>
                    <img
                      src={hit.icon_url || 'https://placehold.co/64x64/18142a/8b5cf6'}
                      alt=""
                      className="result-icon"
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600 }}>
                        <Link
                          to={`/project/${hit.project_id}${targetInstanceId ? `?instance=${targetInstanceId}` : ''}`}
                          // BUG FIX: el botón "Atrás" del detalle de proyecto
                          // volvía siempre a "/explore" a secas, perdiendo la
                          // pestaña (Mods/Modpacks/...) y cualquier otro
                          // filtro que hubiera en la URL en ese momento — se
                          // sentía como si "te mandara a Mods" al volver
                          // desde un modpack. Guardando la URL completa de
                          // esta misma vista en el state de navegación,
                          // ProjectDetailView puede volver exactamente acá.
                          state={{ backHref: `${location.pathname}${location.search}` }}
                          style={{ color: 'inherit', textDecoration: 'none' }}
                        >
                          {hit.title}
                        </Link>{' '}
                        <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{tr('explore.by', { author: hit.author })}</span>
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{hit.description}</div>
                      <div className="result-tags">
                        {(hit.display_categories || hit.categories || []).slice(0, 5).map((c) => (
                          <span key={c} className="badge">
                            {c}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="result-stats">
                      <div>{tr('explore.downloads', { n: hit.downloads?.toLocaleString() })}</div>
                      <div>{tr('explore.follows', { n: hit.follows?.toLocaleString() })}</div>
                      {isModpackHit ? (
                        <motion.button
                          className="btn-primary btn-icon-label"
                          onClick={() => openModpackPicker(hit)}
                          disabled={installingModpackId === hit.project_id}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          <Icon name="package" size={13} />
                          {installingModpackId === hit.project_id
                            ? tr('common.installing')
                            : pickerOpen
                            ? tr('common.cancel')
                            : tr('common.install')}
                        </motion.button>
                      ) : installedProjectIds.has(hit.project_id) ? (
                        <span className="installed-pill">
                          <Icon name="check" size={13} strokeWidth={2.4} />
                          {tr('explore.installed')}
                        </span>
                      ) : (
                        <motion.button
                          className="btn-primary"
                          onClick={() => handleInstall(hit)}
                          disabled={installingId === hit.project_id || !targetInstance}
                          whileHover={{ scale: 1.03 }}
                          whileTap={{ scale: 0.97 }}
                        >
                          {installingId === hit.project_id ? tr('common.installing') : tr('common.install')}
                        </motion.button>
                      )}
                    </div>
                  </div>

                  {/* Progreso de instalación como overlay flotante pegado al
                      borde inferior de la tarjeta (position: absolute) — a
                      propósito NO ocupa espacio en el flujo del documento.
                      Antes esto empujaba la altura de la tarjeta hacia abajo
                      (animando height/marginTop), lo que corría en cascada
                      todas las tarjetas siguientes de la lista cada vez que
                      arrancaba o terminaba una instalación — muy molesto al
                      instalar varios mods seguidos. Con position: absolute,
                      el resto de la lista ni se entera. */}
                  <AnimatePresence>
                    {!isModpackHit && installingId === hit.project_id && (
                      <motion.div
                        className="result-install-overlay"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 6 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <ProgressBar
                          percent={installProgress?.percent ?? null}
                          hint={installProgress?.file}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>

                  <AnimatePresence>
                    {pickerOpen && (
                      <motion.div
                        initial={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0 }}
                        animate={{ opacity: 1, height: 'auto', marginTop: 12, paddingTop: 12 }}
                        exit={{ opacity: 0, height: 0, marginTop: 0, paddingTop: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          overflow: 'hidden',
                          borderTop: '1px solid var(--border-color, rgba(255,255,255,0.08))',
                        }}
                      >
                        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{tr('explore.gameVersion')}</span>
                        {modpackPicker.loading ? (
                          <span className="mini-spinner" />
                        ) : installingModpackId === hit.project_id ? (
                          // Mismo criterio que en la fila de mods: mientras se
                          // instala, la barra de progreso ocupa el lugar del
                          // selector + botón en vez de abrir un popup aparte.
                          <div style={{ flex: 1 }}>
                            <ProgressBar percent={installProgress?.percent ?? null} hint={installProgress?.file} />
                          </div>
                        ) : (
                          <>
                            <Select
                              value={modpackPicker.selected}
                              onChange={(v) => setModpackPicker((s) => ({ ...s, selected: v }))}
                              options={modpackPicker.gameVersions.map((gv) => ({ value: gv, label: `Minecraft ${gv}` }))}
                              style={{ minWidth: 160 }}
                            />
                            <button
                              className="btn-primary btn-icon-label"
                              onClick={confirmModpackInstall}
                              disabled={installingModpackId === hit.project_id}
                            >
                              {tr('explore.createInstance')}
                            </button>
                          </>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
              })}
            </AnimatePresence>

            {!loading && results.length === 0 && (
              <p style={{ color: 'var(--text-muted)' }}>{tr('explore.noResults')}</p>
            )}

            <Pagination
              page={Math.floor(offset / limit) + 1}
              totalPages={Math.max(1, Math.ceil(totalHits / limit))}
              disabled={loading}
              onChange={(p) => {
                doSearch((p - 1) * limit);
                // El selector de página de abajo del todo cambia de página
                // pero el usuario sigue con el scroll donde estaba, abajo de
                // los resultados anteriores. Lo llevamos de vuelta arriba del
                // todo (al contenedor con scroll real, .main-content) para
                // que vea desde el principio los resultados de la página
                // recién seleccionada, en vez de tener que scrollear él mismo.
                document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            />
          </div>
        </div>
    </div>
  );
}
