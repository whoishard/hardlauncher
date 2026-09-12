import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import Select from '../components/Select.jsx';
import InstanceTargetPicker from '../components/InstanceTargetPicker.jsx';
import FilterDropdown from '../components/FilterDropdown.jsx';
import Icon from '../components/Icon.jsx';
import { modalOverlayMotion, modalCardMotion } from '../components/CreateInstanceModal.jsx';
import { useT, t } from '../i18n.js';

function getLinkFields(t) {
  return [
    { key: 'source_url', label: t('project.link.source_url'), icon: 'code' },
    { key: 'issues_url', label: t('project.link.issues_url'), icon: 'wrench' },
    { key: 'wiki_url', label: t('project.link.wiki_url'), icon: 'inbox' },
    { key: 'discord_url', label: t('project.link.discord_url'), icon: 'user' },
  ];
}

// Abre un enlace externo en el navegador del sistema en vez de navegar
// adentro de la propia ventana del launcher (que no tiene ni barra de
// direcciones ni forma de volver). Con fallback a window.open por si esta
// build corre fuera de Electron (p. ej. en el navegador durante desarrollo).
//
// BUG FIX: antes esto no esperaba la promesa de
// `system:openExternal` (que a su vez no esperaba shell.openExternal, ver
// electron/main.js) — si abrir el navegador fallaba por cualquier motivo
// (sin navegador/handler por default configurado en el SO, URL con algo
// raro, etc.) el click simplemente "no hacía nada" y no había forma de
// enterarse ni de llegar igual al enlace. Ahora se espera el resultado real
// y, si falló, se copia la URL al portapapeles y se avisa con un toast en
// vez de fallar en silencio.
async function openExternalLink(url, pushToast) {
  if (!url) return;
  if (window.hardLauncher?.system?.openExternal) {
    try {
      const opened = await window.hardLauncher.system.openExternal(url);
      if (!opened) throw new Error('El sistema no pudo abrir el enlace');
    } catch (err) {
      navigator.clipboard?.writeText(url);
      pushToast?.(t('project.linkOpenFailed', { url }), 'error');
    }
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

// BUG FIX (imágenes rotas en descripciones/changelogs): la descripción
// "cruda" de un proyecto de Modrinth casi nunca aloja sus propias imágenes
// (banners, separadores, botones de Discord, etc.) — la mayoría de los
// modpacks grandes las traen embebidas apuntando directo a
// raw.githubusercontent.com, gitlab.com/.../raw/... o similares. Muchos de
// esos hosts devuelven 403/bloquean la carga cuando el pedido llega con un
// Referer de otro origen (hotlink protection) — exactamente lo que hace un
// <img src="..."> cargado desde nuestra propia ventana. La propia Modrinth
// tiene el mismo problema en su sitio y lo resuelve reescribiendo esas URLs
// para que pasen por un proxy de imágenes (wsrv.nl) en vez de pedirlas
// directo; sin ese paso, cualquier launcher de terceros que renderice el
// campo "body" tal cual como venía, se encuentra con el ícono de "imagen
// rota" en el banner y en cada separador del documento. Se replica acá el
// mismo approach: cualquier <img> que no venga del propio CDN de Modrinth
// (que sí permite hotlinking) se reescribe para pasar por ese proxy.
const IMAGE_PROXY = 'https://wsrv.nl/?n=-1&url=';
const MODRINTH_CDN_HOSTS = ['cdn.modrinth.com', 'cdn-raw.modrinth.com'];

function proxyExternalImage(rawUrl) {
  if (!rawUrl || rawUrl.startsWith('data:')) return rawUrl;
  try {
    const parsed = new URL(rawUrl, 'https://modrinth.com');
    if (MODRINTH_CDN_HOSTS.includes(parsed.hostname)) return rawUrl;
    return IMAGE_PROXY + encodeURIComponent(parsed.href);
  } catch {
    return rawUrl;
  }
}

// Hosts de video conocidos a los que se les permite quedar como <iframe> en
// una descripción/changelog. DOMPurify por default saca <iframe> por
// completo (no está en su lista de tags permitidos) — bien para
// <script>/<style>, pero para embeds de YouTube/Vimeo (muy comunes en
// descripciones de modpacks) eso se comía el video entero. Se permite acá
// de forma explícita, pero restringido a estos dominios y sandboxeado, para
// no abrir una superficie de XSS con contenido arbitrario de terceros.
const ALLOWED_IFRAME_HOSTS = ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com'];

/** Markdown de Modrinth (con HTML crudo permitido) -> HTML sanitizado, con
 * las imágenes externas ruteadas por el proxy de arriba y los iframes de
 * video permitidos (y el resto de <iframe> descartado). */
function renderProjectMarkdown(rawMarkdown) {
  const rawHtml = marked.parse(rawMarkdown || '', { gfm: true, breaks: false });
  const clean = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen', 'loading', 'referrerpolicy', 'sandbox'],
  });
  // Se re-parsea el HTML ya sanitizado (nunca el crudo) solo para reescribir
  // atributos puntuales — no se reintroduce nada que DOMPurify no haya
  // dejado pasar antes.
  const container = document.createElement('div');
  container.innerHTML = clean;
  container.querySelectorAll('img[src]').forEach((img) => {
    img.src = proxyExternalImage(img.getAttribute('src'));
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
  });
  container.querySelectorAll('iframe').forEach((frame) => {
    let host = '';
    try {
      host = new URL(frame.getAttribute('src') || '', 'https://invalid.invalid').hostname;
    } catch {
      /* URL inválida -> host vacío -> se descarta abajo */
    }
    if (!ALLOWED_IFRAME_HOSTS.includes(host)) {
      frame.remove();
      return;
    }
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation');
    // BUG FIX (videos de YouTube/Vimeo embebidos no reproducen — "Error 153:
    // Video player configuration error"): esto estaba en 'no-referrer', que
    // suprime por completo el header Referer/Origin del pedido al iframe.
    // El reproductor de YouTube usa ese header para validar el embed, y sin
    // él rechaza la reproducción con el error 153 (documentado por Google y
    // reproducible en cualquier sitio/app que mande 'no-referrer' a un embed
    // de YouTube). 'strict-origin-when-cross-origin' es lo que la propia
    // YouTube recomienda: manda el origin (no la URL completa, así que no se
    // filtra qué proyecto/página específica se estaba mirando) pero alcanza
    // para que el reproductor valide el pedido correctamente.
    frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    frame.setAttribute('loading', 'lazy');
  });
  return container.innerHTML;
}

function modrinthProjectUrl(project) {
  return `https://modrinth.com/${project.project_type}/${project.slug || project.id}`;
}

function modrinthVersionUrl(project, version) {
  return `${modrinthProjectUrl(project)}/version/${version.id}`;
}

function getEnvLabel(t) {
  return { required: t('env.required'), optional: t('env.optional'), unsupported: t('env.unsupported') };
}

function getTypeLabel(t) {
  return {
    mod: t('type.mod.one'),
    resourcepack: t('type.resourcepack.one'),
    shader: t('type.shader.one'),
    modpack: t('type.modpack.one'),
    datapack: t('type.datapack.one'),
  };
}

// Canales de una versión (release/beta/alpha), igual a los que usa Modrinth
// para filtrar y para el "punto" de color a la izquierda de cada fila.
const CHANNELS = [
  { key: 'release', label: 'Release' },
  { key: 'beta', label: 'Beta' },
  { key: 'alpha', label: 'Alpha' },
];
const CHANNEL_LABEL = { release: 'Release', beta: 'Beta', alpha: 'Alpha' };

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

// Fecha relativa compacta ("hace 5d", "hace 3sem", "el mes pasado"...) en
// vez de la fecha larga (dd/mm/aaaa) que antes ocupaba demasiado ancho en
// la columna "Publicada" de la tabla de versiones.
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

// "1.07M" / "193.2K" / "842", igual al formato compacto de descargas de
// Modrinth, en vez del número completo sin separadores.
function formatCount(n) {
  const num = n || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(num);
}

/** Tira de capturas del proyecto (Modrinth "gallery"): antes era un simple
 * overflow-x sin ninguna pista visual de que se podía desplazar y sin forma
 * de ver una imagen en grande. Ahora tiene flechas (que solo aparecen si
 * hay más contenido para ese lado) y un visor con navegación, igual que las
 * capturas de una instancia. */
function ProjectGallery({ images }) {
  const t = useT();
  const scrollRef = useRef(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(null);

  function updateScrollState() {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  // BUG FIX (las flechas de la galería nunca aparecían aunque hubiera más
  // capturas para el costado, incluso con 17 imágenes y la tira claramente
  // cortada a la derecha): updateScrollState() se llamaba una sola vez, justo
  // al montar, comparando contra el scrollWidth del contenedor EN ESE
  // INSTANTE. Como cada <img> todavía no había terminado de cargar (el ancho
  // real de cada thumb es "auto", solo se fija cuando la imagen carga),
  // scrollWidth todavía casi no difería de clientWidth y canScrollRight daba
  // false — y nada volvía a llamar a updateScrollState() después, ni cuando
  // las imágenes efectivamente cargaban y la tira pasaba a desbordar. Un
  // ResizeObserver sobre el contenedor lo resuelve de raíz: se dispara cada
  // vez que su contenido cambia de tamaño por CUALQUIER motivo (imágenes que
  // van cargando, cambio de cantidad de imágenes, resize de ventana), sin
  // depender de enganchar el evento 'load' de cada <img> a mano.
  useEffect(() => {
    updateScrollState();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', updateScrollState);
    const observer = new ResizeObserver(updateScrollState);
    observer.observe(el);
    Array.from(el.children).forEach((child) => observer.observe(child));
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length]);

  // BUG FIX (galería "no se puede desplazar"): la tira es un overflow-x, pero
  // la mayoría de los mouses/trackpads mandan el gesto de scroll normal
  // (vertical, sin Shift) por defecto — eso no mueve un contenedor que solo
  // desborda horizontalmente, así que sin arrastrar de punta a punta con el
  // trackpad o usar las flechas no había forma obvia de ver el resto. Acá se
  // traduce ese scroll vertical a desplazamiento horizontal (el patrón
  // estándar en tiras de imágenes tipo carrusel), dejando el scroll
  // horizontal nativo (trackpad/Shift+rueda) intacto para cuando ya viene en
  // ese eje.
  function handleWheel(e) {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    const el = scrollRef.current;
    if (!el) return;
    e.preventDefault();
    el.scrollBy({ left: e.deltaY, behavior: 'auto' });
  }

  useEffect(() => {
    if (lightboxIndex === null) return;
    function onKeyDown(e) {
      if (e.key === 'Escape') setLightboxIndex(null);
      if (e.key === 'ArrowRight') setLightboxIndex((i) => Math.min(i + 1, images.length - 1));
      if (e.key === 'ArrowLeft') setLightboxIndex((i) => Math.max(i - 1, 0));
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, images.length]);

  if (!images.length) return null;

  const current = lightboxIndex !== null ? images[lightboxIndex] : null;

  return (
    <div className="project-gallery-wrap">
      {canScrollLeft && (
        <button
          type="button"
          className="project-gallery-arrow prev"
          onClick={() => scrollRef.current?.scrollBy({ left: -340, behavior: 'smooth' })}
          title={t('common.previous')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      <div className="project-gallery" ref={scrollRef} onWheel={handleWheel}>
        {images.map((img, i) => (
          <motion.button
            key={img.url}
            type="button"
            className="project-gallery-thumb"
            onClick={() => setLightboxIndex(i)}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2, delay: Math.min(i * 0.03, 0.3), ease: [0.16, 1, 0.3, 1] }}
            whileHover={{ scale: 1.03 }}
          >
            <img src={img.url} alt={img.title || ''} />
            <div className="screenshot-thumb-overlay">
              <Icon name="search" size={18} />
            </div>
          </motion.button>
        ))}
      </div>

      {canScrollRight && (
        <button
          type="button"
          className="project-gallery-arrow next"
          onClick={() => scrollRef.current?.scrollBy({ left: 340, behavior: 'smooth' })}
          title={t('common.next')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      <AnimatePresence>
        {current && (
          <motion.div className="modal-overlay" onClick={() => setLightboxIndex(null)} {...modalOverlayMotion}>
            <motion.div className="screenshot-lightbox" onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
            <div className="screenshot-lightbox-header">
              <div>
                <div className="screenshot-lightbox-name">{current.title || t('common.screenshot')}</div>
                {current.description && <div className="screenshot-lightbox-date">{current.description}</div>}
              </div>
              <button type="button" className="modal-close-btn" onClick={() => setLightboxIndex(null)} title={t('common.close')}>
                <Icon name="close" size={15} />
              </button>
            </div>

            <div className="screenshot-lightbox-body">
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
              <img
                src={current.url}
                alt={current.title || ''}
                className="screenshot-lightbox-image"
                draggable={false}
              />
              {lightboxIndex < images.length - 1 && (
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
                {lightboxIndex + 1} / {images.length}
              </span>
            </div>
          </motion.div>
        </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function ProjectDetailView() {
  const t = useT();
  const LINK_FIELDS = getLinkFields(t);
  const ENV_LABEL = getEnvLabel(t);
  const TYPE_LABEL = getTypeLabel(t);
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { instances, refreshInstances, pushToast } = useAppStore();
  const [project, setProject] = useState(null);
  const [versions, setVersions] = useState([]);
  const [tab, setTab] = useState('description');
  const [expandedChangelog, setExpandedChangelog] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const tabsRef = useRef(null);
  const paramInstanceId = searchParams.get('instance');
  // BUG FIX: "?instance=" en la URL se usaba para DOS cosas distintas a la
  // vez — (1) qué instancia viene preseleccionada como destino de
  // instalación, cosa que también pasa Explorar cuando ya hay una instancia
  // elegida ahí, y (2) "vine desde adentro de esa instancia", que es lo que
  // decide a dónde te manda el botón Atrás. Como (1) está presente casi
  // siempre (Explorar por default ya trae una instancia seleccionada), el
  // botón Atrás terminaba mandando a esa instancia incluso viniendo de
  // Explorar, sin relación real con ella. Ahora (2) se decide con un state
  // de navegación explícito que solo pone InstanceDetailView al abrir un
  // mod/resource pack/shader ya instalado desde su pestaña Contenido — el
  // único lugar de donde "volver a la instancia" es realmente lo esperado.
  const cameFromInstance = Boolean(
    location.state?.cameFromInstance && paramInstanceId && instances.some((i) => i.id === paramInstanceId)
  );
  const [targetInstanceId, setTargetInstanceId] = useState(
    (paramInstanceId && instances.some((i) => i.id === paramInstanceId) ? paramInstanceId : instances[0]?.id) || ''
  );
  const [installingVersionId, setInstallingVersionId] = useState(null);

  // Filtros de la pestaña "Versiones" (igual a los de la página de un
  // proyecto en Modrinth): por versión de juego y por canal, más "Loaders"
  // si el proyecto soporta más de uno.
  const [versionMcFilter, setVersionMcFilter] = useState([]);
  const [versionChannelFilter, setVersionChannelFilter] = useState([]);
  const [versionLoaderFilter, setVersionLoaderFilter] = useState([]);

  // Un modpack no se "instala dentro" de una instancia existente: siempre
  // genera una instancia nueva propia (con su ícono y todo su contenido),
  // así que no aplica el flujo de "instancia destino" que usan mods,
  // resource packs y shaders. En su lugar se elige qué versión del juego
  // del modpack instalar.
  const isModpack = project?.project_type === 'modpack';
  const [modpackGameVersion, setModpackGameVersion] = useState('');
  const [installingModpack, setInstallingModpack] = useState(false);

  const targetInstance = instances.find((i) => i.id === targetInstanceId);
  const installedEntry = !isModpack && (targetInstance?.content || []).find((c) => c.projectId === id);

  // Versiones del modpack que traen un .mrpack instalable, y las versiones
  // de juego disponibles entre ellas (para el selector "Instalar modpack").
  const modpackVersions = isModpack
    ? versions.filter((v) => (v.files || []).some((f) => f.filename.toLowerCase().endsWith('.mrpack')))
    : [];
  const modpackGameVersions = Array.from(new Set(modpackVersions.flatMap((v) => v.game_versions || [])));

  useEffect(() => {
    if (!isModpack) return;
    if (modpackGameVersion && modpackGameVersions.includes(modpackGameVersion)) return;
    setModpackGameVersion(modpackGameVersions[0] || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isModpack, modpackGameVersions.join(',')]);

  useEffect(() => {
    function onClickOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    setProject(null);
    window.hardLauncher.modrinth.project(id).then(setProject);
    window.hardLauncher.modrinth.versions(id, {}).then(setVersions);
  }, [id]);

  const descriptionHtml = useMemo(() => renderProjectMarkdown(project?.body), [project?.body]);
  const mainPanelRef = useRef(null);

  // Aun pasando por el proxy de imágenes, algún link puntual dentro de una
  // descripción/changelog puede seguir muerto (asset borrado, dominio caído,
  // etc.) — en vez de mostrar el ícono de "imagen rota" de siempre, esas
  // puntuales se ocultan solas. 'error' en <img> no burbujea, así que hace
  // falta delegación con capture en el contenedor en vez de un solo
  // listener en el body.
  useEffect(() => {
    const el = mainPanelRef.current;
    if (!el) return;
    function onImgError(e) {
      if (e.target.tagName === 'IMG') e.target.style.display = 'none';
    }
    el.addEventListener('error', onImgError, true);
    return () => el.removeEventListener('error', onImgError, true);
  }, [tab, descriptionHtml, expandedChangelog]);

  if (!project) return <div>{t('project.loading')}</div>;

  const availableLinks = LINK_FIELDS.filter((f) => project[f.key]);

  async function handleInstallVersion(version) {
    if (!targetInstance) {
      pushToast(t('project.needTarget'), 'error');
      return;
    }
    setInstallingVersionId(version.id);
    try {
      await window.hardLauncher.modrinth.installMod(targetInstance.id, version);
      await refreshInstances();
      pushToast(t('project.installedIn', { title: project.title, version: version.name, name: targetInstance.name }), 'success');
    } catch (e) {
      pushToast(t('project.installError', { error: e.message }), 'error');
    } finally {
      setInstallingVersionId(null);
    }
  }

  // Instala una versión concreta del modpack: crea una instancia NUEVA (con
  // el ícono del modpack, y todos sus mods/resourcepacks/shaders ya
  // instalados), en vez de agregarla como "contenido" de una instancia
  // existente. Se usa tanto desde el botón "Instalar modpack" del
  // encabezado como desde cada fila de la pestaña Versiones.
  async function handleInstallModpackVersion(version) {
    setInstallingVersionId(version.id);
    setInstallingModpack(true);
    try {
      const instance = await window.hardLauncher.modrinth.installModpackFromVersion(version, project.title);
      await refreshInstances();
      pushToast(t('project.modpackInstalled', { title: project.title }), 'success');
      navigate(`/instances/${instance.id}`);
    } catch (e) {
      pushToast(t('project.modpackError', { error: e.message }), 'error');
    } finally {
      setInstallingVersionId(null);
      setInstallingModpack(false);
    }
  }

  // Botón "Instalar modpack" del encabezado: instala la versión más nueva
  // del modpack para la versión de juego elegida en el selector.
  async function handleInstallModpackForGameVersion() {
    const match = modpackVersions.find((v) => (v.game_versions || []).includes(modpackGameVersion));
    if (!match) {
      pushToast(t('project.modpackNoMc'), 'error');
      return;
    }
    await handleInstallModpackVersion(match);
  }

  // Instalación rápida desde el encabezado: a diferencia del botón por fila
  // en la pestaña "Versiones" (que instala exactamente esa versión), acá no
  // hay una versión elegida todavía — se pide a Modrinth la más nueva ya
  // filtrada por versión de Minecraft y loader de la instancia destino, en
  // vez de asumir que versions[0] (que es la lista SIN filtrar) es
  // compatible.
  async function handleQuickInstall() {
    if (!targetInstance) {
      pushToast(t('project.needTarget'), 'error');
      return;
    }
    setInstallingVersionId('__quick__');
    try {
      const usesLoaderFilter = project.project_type === 'mod' || project.project_type === 'modpack';
      const compatible = await window.hardLauncher.modrinth.versions(id, {
        mcVersion: targetInstance.mcVersion,
        loader: usesLoaderFilter && targetInstance.loader !== 'vanilla' ? targetInstance.loader : undefined,
      });
      if (!compatible.length) {
        pushToast(t('project.noCompat'), 'error');
        return;
      }
      await window.hardLauncher.modrinth.installMod(targetInstance.id, compatible[0]);
      await refreshInstances();
      pushToast(t('project.installedIn', { title: project.title, version: compatible[0].name, name: targetInstance.name }), 'success');
    } catch (e) {
      pushToast(t('project.installError', { error: e.message }), 'error');
    } finally {
      setInstallingVersionId(null);
    }
  }

  async function handleUninstall() {
    if (!targetInstance || !installedEntry) return;
    setMenuOpen(false);
    try {
      await window.hardLauncher.modrinth.removeContent(targetInstance.id, installedEntry.fileName);
      await refreshInstances();
      pushToast(t('project.removed', { title: project.title, name: targetInstance.name }), 'info');
    } catch (e) {
      pushToast(t('project.removeFailed', { error: e.message }), 'error');
    }
  }

  function handleCopyId() {
    setMenuOpen(false);
    navigator.clipboard?.writeText(id);
    pushToast(t('project.idCopied'), 'info');
  }

  // BUG FIX (al volver a "Descripción" desde otra pestaña con más scroll —
  // típicamente "Galería", con hasta 17 capturas — se veía "roto": una
  // descripción bastante más corta se renderizaba igual de completa que
  // siempre, pero el scroll de la página (el contenedor .main-content que
  // envuelve TODA la vista, no las pestañas en sí) se quedaba en la posición
  // en la que estaba en la pestaña anterior. Como esa posición podía caer
  // más abajo que el final de la descripción, lo que se veía era el final
  // de la tarjeta -a veces solo un separador o una imagen de pie de página-
  // seguido de un montón de espacio vacío, como si el contenido faltante se
  // hubiera perdido, cuando en realidad estaba completo pero fuera de
  // vista más arriba. Antes esto solo se resolvía para el botón puntual
  // "Cambiar versión" (ver handleSwitchVersion); ahora CUALQUIER cambio de
  // pestaña (clickeando las pills de arriba, no solo ese botón) hace scroll
  // hasta las pestañas, igual que ya hacía ese caso puntual.
  function handleTabChange(newTab) {
    setTab(newTab);
    tabsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function handleSwitchVersion() {
    handleTabChange('versions');
  }

  const loaderLabel = targetInstance && targetInstance.loader !== 'vanilla' ? capitalize(targetInstance.loader) : null;
  const backTo = cameFromInstance ? `/instances/${paramInstanceId}` : location.state?.backHref || '/explore';
  const gallery = project.gallery || [];

  // Se arma la lista de versiones/loaders disponibles a partir de las
  // versiones ya cargadas (en vez de otro llamado a la API) para poblar
  // los dropdowns de filtro de la tabla, preservando el orden en el que
  // aparecen (que ya viene de más nueva a más vieja).
  const allVersionGameVersions = Array.from(new Set(versions.flatMap((v) => v.game_versions || [])));
  const allVersionLoaders = Array.from(new Set(versions.flatMap((v) => v.loaders || [])));
  const filteredVersions = versions.filter(
    (v) =>
      (versionMcFilter.length === 0 || (v.game_versions || []).some((gv) => versionMcFilter.includes(gv))) &&
      (versionChannelFilter.length === 0 || versionChannelFilter.includes(v.version_type)) &&
      (versionLoaderFilter.length === 0 || (v.loaders || []).some((l) => versionLoaderFilter.includes(l)))
  );
  const hasActiveVersionFilters =
    versionMcFilter.length > 0 || versionChannelFilter.length > 0 || versionLoaderFilter.length > 0;

  function toggleVersionMc(v) {
    setVersionMcFilter((s) => (s.includes(v) ? s.filter((x) => x !== v) : [...s, v]));
  }
  function toggleVersionChannel(c) {
    setVersionChannelFilter((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));
  }
  function toggleVersionLoader(l) {
    setVersionLoaderFilter((s) => (s.includes(l) ? s.filter((x) => x !== l) : [...s, l]));
  }
  function clearVersionFilters() {
    setVersionMcFilter([]);
    setVersionChannelFilter([]);
    setVersionLoaderFilter([]);
  }

  return (
    <motion.div
      className="project-detail-view"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="project-detail-topbar">
        <button type="button" className="project-detail-back-btn" onClick={() => navigate(backTo)} title={t('project.back')}>
          <Icon name="arrowLeft" size={18} />
        </button>
        <div>
          <h1 className="project-detail-topbar-title">
            {cameFromInstance && targetInstance ? targetInstance.name : t('explore.title')}
          </h1>
          <div className="project-detail-topbar-sub">
            {cameFromInstance && targetInstance ? (
              <>
                <span>{t('project.installingContent')}</span>
                <span className="dot">•</span>
                <span className="topbar-sub-item">
                  <Icon name="gamepad" size={13} />
                  Minecraft {targetInstance.mcVersion}
                </span>
                {loaderLabel && (
                  <>
                    <span className="dot">•</span>
                    <span className="topbar-sub-item">
                      <Icon name="layers" size={13} />
                      {loaderLabel}
                    </span>
                  </>
                )}
              </>
            ) : (
              <span>{t('project.exploring', { type: (TYPE_LABEL[project.project_type] || 'contenido').toLowerCase() })}</span>
            )}
          </div>
        </div>
      </div>

      <div className="project-detail-card card">
        <img
          src={project.icon_url || 'https://placehold.co/96x96/26272e/8b5cf6'}
          alt=""
          className="project-detail-icon"
        />
        <div className="project-detail-info">
          <h2 className="project-detail-title">{project.title}</h2>
          <p className="project-detail-description">{project.description}</p>
          <div className="project-detail-stats">
            <span className="topbar-sub-item">
              <Icon name="download" size={14} />
              {(project.downloads || 0).toLocaleString()} descargas
            </span>
            <span className="dot">•</span>
            <span className="topbar-sub-item">
              <Icon name="heart" size={14} />
              {(project.followers || 0).toLocaleString()} seguidores
            </span>
          </div>
          <div className="result-tags">
            {(project.categories || []).map((c) => (
              <span key={c} className="badge">{c}</span>
            ))}
          </div>
        </div>
        <div className="project-detail-actions">
          {isModpack ? (
            <>
              {modpackGameVersions.length > 0 && (
                <Select
                  value={modpackGameVersion}
                  onChange={setModpackGameVersion}
                  options={modpackGameVersions.map((gv) => ({ value: gv, label: `Minecraft ${gv}` }))}
                  style={{ minWidth: 160 }}
                />
              )}
              <motion.button
                className="btn-primary btn-icon-label"
                onClick={handleInstallModpackForGameVersion}
                disabled={installingModpack || !modpackGameVersion}
                whileHover={!installingModpack ? { scale: 1.03 } : undefined}
                whileTap={!installingModpack ? { scale: 0.97 } : undefined}
              >
                <Icon name="package" size={14} />
                {installingModpack ? t('common.installing') : t('project.installModpack')}
              </motion.button>
            </>
          ) : (
            <InstanceTargetPicker instances={instances} value={targetInstanceId} onChange={setTargetInstanceId} />
          )}
          {!isModpack &&
            (installedEntry ? (
              <div className="project-detail-installed-actions">
                <button type="button" className="btn-secondary btn-icon-label" onClick={handleSwitchVersion}>
                  <Icon name="refresh" size={14} />
                  Cambiar versión
                </button>
                <div className="instance-card-menu-wrap inline project-detail-menu-wrap" ref={menuRef}>
                  <button
                    type="button"
                    className="instance-card-menu-btn"
                    title={t('common.moreOptions')}
                    onClick={() => setMenuOpen((o) => !o)}
                  >
                    <Icon name="dots" size={15} />
                  </button>
                  {menuOpen && (
                    <div className="instance-card-menu">
                      <button type="button" className="instance-card-menu-item" onClick={handleCopyId}>
                        <Icon name="link" size={14} />
                        Copiar ID del proyecto
                      </button>
                      <button
                        type="button"
                        className="instance-card-menu-item"
                        onClick={() => {
                          setMenuOpen(false);
                          openExternalLink(modrinthProjectUrl(project), pushToast);
                        }}
                      >
                        <Icon name="globe" size={14} />
                        Ver en Modrinth
                      </button>
                      <button type="button" className="instance-card-menu-item danger" onClick={handleUninstall}>
                        <Icon name="trash" size={14} />
                        Eliminar de la instancia
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <motion.button
                className="btn-primary"
                onClick={handleQuickInstall}
                disabled={!targetInstance || installingVersionId === '__quick__'}
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
              >
                {installingVersionId === '__quick__' ? t('common.installing') : t('common.install')}
              </motion.button>
            ))}
        </div>
      </div>

      <div className="pill-tabs project-detail-tabs" ref={tabsRef}>
        <button className={'pill-tab' + (tab === 'description' ? ' active' : '')} onClick={() => handleTabChange('description')}>
          Descripción
        </button>
        <button className={'pill-tab' + (tab === 'versions' ? ' active' : '')} onClick={() => handleTabChange('versions')}>
          Versiones ({versions.length})
        </button>
        <button className={'pill-tab' + (tab === 'gallery' ? ' active' : '')} onClick={() => handleTabChange('gallery')}>
          Galería{gallery.length ? ` (${gallery.length})` : ''}
        </button>
      </div>

      <div className="project-detail-layout">
        {/* BUG FIX (la descripción "se rompe" al volver de Versiones/Galería —
            reportado varias veces, sigue pasando incluso después de arreglar
            el scroll): el patrón anterior usaba <AnimatePresence mode="wait">
            con key={tab}, que hace que React DESMONTE por completo el panel
            saliente y MONTE UNO NUEVO DE CERO cada vez que se cambia de
            pestaña — no solo anima una transición, reconstruye todo el árbol
            DOM del panel entrante desde cero. Confirmé con pruebas repetidas
            que el string de HTML de la descripción en sí no cambia entre
            montajes, así que el contenido nunca se "pierde" en el sentido
            estricto — pero CADA remount vuelve a crear TODAS las <img> (y el
            <iframe> de YouTube) del body desde cero, disparando pedidos de
            red nuevos para cada una y dejando el layout final a merced de
            cómo (y en qué orden) resuelven esos pedidos esa vez en particular
            — con contenido real, sobre red real, eso es exactamente la clase
            de condición de carrera que puede rendir distinto cada vez, a
            diferencia de una prueba con red simulada donde todo falla o cae
            instantáneo y de forma idéntica siempre. En vez de perseguir el
            timing exacto, se ataca la causa de raíz: los tres paneles ahora
            se montan UNA SOLA VEZ (nunca se desmontan al cambiar de pestaña)
            y se ocultan/muestran con CSS (display:none vía la clase
            'tab-panel-hidden'). Así, volver a "Descripción" siempre muestra
            exactamente el mismo DOM ya pintado que se dejó la vez anterior,
            sin volver a pedir ninguna imagen ni recalcular ningún layout. */}
        <div className="project-detail-main" ref={mainPanelRef}>
          <div className={'card markdown-body' + (tab === 'description' ? '' : ' tab-panel-hidden')}>
            {descriptionHtml.trim() ? (
              <div dangerouslySetInnerHTML={{ __html: descriptionHtml }} />
            ) : (
              // Si el proyecto no tiene body (o vino vacío por algún
              // problema puntual de la API), mostrar la tarjeta en blanco
              // sin ninguna explicación se leía igual que "se rompió la
              // descripción". Con contenido real esto prácticamente nunca
              // se ve.
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                Este proyecto no tiene una descripción disponible.{' '}
                <a
                  href={modrinthProjectUrl(project)}
                  onClick={(e) => {
                    e.preventDefault();
                    openExternalLink(modrinthProjectUrl(project), pushToast);
                  }}
                >
                  Verla en Modrinth
                </a>
                .
              </p>
            )}
          </div>

          <div className={'card project-detail-gallery-card' + (tab === 'gallery' ? '' : ' tab-panel-hidden')}>
            {gallery.length ? (
              <ProjectGallery images={gallery} />
            ) : (
              <p style={{ color: 'var(--text-muted)', margin: 0 }}>{t('project.noGallery')}</p>
            )}
          </div>

          <div className={'versions-panel' + (tab === 'versions' ? '' : ' tab-panel-hidden')}>
            <div className="filter-bar versions-filter-bar">
              <FilterDropdown label="Versiones de juego" count={versionMcFilter.length} width={220}>
                <div className="filter-dropdown-scroll">
                  {allVersionGameVersions.map((gv) => (
                    <label key={gv} className="facet-row custom-checkbox-row">
                      <input type="checkbox" checked={versionMcFilter.includes(gv)} onChange={() => toggleVersionMc(gv)} />
                      <span className="custom-checkbox-box" />
                      {gv}
                    </label>
                  ))}
                </div>
              </FilterDropdown>

              <FilterDropdown label="Canales" count={versionChannelFilter.length} width={170}>
                {CHANNELS.map((c) => (
                  <label key={c.key} className="facet-row custom-checkbox-row">
                    <input
                      type="checkbox"
                      checked={versionChannelFilter.includes(c.key)}
                      onChange={() => toggleVersionChannel(c.key)}
                    />
                    <span className="custom-checkbox-box" />
                    {c.label}
                  </label>
                ))}
              </FilterDropdown>

              {allVersionLoaders.length > 1 && (
                <FilterDropdown label="Loaders" count={versionLoaderFilter.length} width={170}>
                  {allVersionLoaders.map((l) => (
                    <label key={l} className="facet-row custom-checkbox-row">
                      <input
                        type="checkbox"
                        checked={versionLoaderFilter.includes(l)}
                        onChange={() => toggleVersionLoader(l)}
                      />
                      <span className="custom-checkbox-box" />
                      {capitalize(l)}
                    </label>
                  ))}
                </FilterDropdown>
              )}

              {hasActiveVersionFilters && (
                <button type="button" className="clear-filters-btn versions-clear-btn" onClick={clearVersionFilters}>
                  <Icon name="close" size={11} strokeWidth={2.2} />
                  Limpiar filtros
                </button>
              )}

              {versionMcFilter.map((gv) => (
                <button key={'mc-' + gv} type="button" className="active-filter-chip" onClick={() => toggleVersionMc(gv)}>
                  {gv}
                  <Icon name="close" size={10} strokeWidth={2.4} />
                </button>
              ))}
              {versionChannelFilter.map((c) => (
                <button
                  key={'ch-' + c}
                  type="button"
                  className="active-filter-chip"
                  onClick={() => toggleVersionChannel(c)}
                >
                  {CHANNEL_LABEL[c] || c}
                  <Icon name="close" size={10} strokeWidth={2.4} />
                </button>
              ))}
              {versionLoaderFilter.map((l) => (
                <button
                  key={'ld-' + l}
                  type="button"
                  className="active-filter-chip"
                  onClick={() => toggleVersionLoader(l)}
                >
                  {capitalize(l)}
                  <Icon name="close" size={10} strokeWidth={2.4} />
                </button>
              ))}
            </div>

            {filteredVersions.length === 0 ? (
              <div className="card" style={{ color: 'var(--text-muted)' }}>
                Ninguna versión coincide con los filtros elegidos.
              </div>
            ) : (
              <div className="card versions-table-card">
                <div className="versions-table">
                  <div className="versions-table-row versions-table-head">
                    <span className="versions-col-type" />
                    <span>{t('project.colVersion')}</span>
                    <span>{t('project.colGame')}</span>
                    <span>{t('project.colPlatform')}</span>
                    <span>{t('project.colPublished')}</span>
                    <span>{t('project.colDownloads')}</span>
                    <span className="versions-col-actions" />
                  </div>

                  {filteredVersions.map((v) => {
                    const isInstalledVersion = !isModpack && installedEntry?.versionId === v.id;
                    const hasMrpack = (v.files || []).some((f) => f.filename.toLowerCase().endsWith('.mrpack'));
                    const isExpanded = expandedChangelog === v.id;
                    return (
                      <React.Fragment key={v.id}>
                        <div
                          className={
                            'versions-table-row' +
                            (v.changelog ? ' clickable' : '') +
                            (isExpanded ? ' expanded' : '') +
                            (isInstalledVersion ? ' installed' : '')
                          }
                          onClick={() => v.changelog && setExpandedChangelog(isExpanded ? null : v.id)}
                        >
                          <span
                            className={'version-type-dot type-' + (v.version_type || 'release')}
                            title={CHANNEL_LABEL[v.version_type] || v.version_type}
                          >
                            {(v.version_type || '?').charAt(0).toUpperCase()}
                          </span>

                          <div className="versions-table-name">
                            <span className="version-name-text">{v.name}</span>
                          </div>

                          <div className="versions-table-badges">
                            {(v.game_versions || []).slice(0, 3).map((gv) => (
                              <span key={gv} className="badge badge-sm">{gv}</span>
                            ))}
                            {(v.game_versions || []).length > 3 && (
                              <span className="badge badge-sm">+{v.game_versions.length - 3}</span>
                            )}
                          </div>

                          <div className="versions-table-badges">
                            {(v.loaders || []).map((l) => (
                              <span key={l} className="badge badge-sm badge-loader">{capitalize(l)}</span>
                            ))}
                          </div>

                          <span className="version-date">{formatRelativeDate(v.date_published)}</span>
                          <span className="version-downloads">{formatCount(v.downloads)}</span>

                          <div className="versions-table-actions" onClick={(e) => e.stopPropagation()}>
                            {isInstalledVersion ? (
                              <span className="version-action-btn installed" title={t('project.versionInstalled')}>
                                <Icon name="check" size={16} strokeWidth={2.6} />
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="version-action-btn install"
                                title={isModpack ? t('project.createFromVersion') : t('project.installVersion')}
                                onClick={() => (isModpack ? handleInstallModpackVersion(v) : handleInstallVersion(v))}
                                disabled={installingVersionId === v.id || (isModpack ? !hasMrpack : !targetInstance)}
                              >
                                {installingVersionId === v.id ? (
                                  <span className="mini-spinner" />
                                ) : (
                                  <Icon name="download" size={17} strokeWidth={2.3} />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              className="version-action-btn"
                              title={t('project.viewModrinth')}
                              onClick={() => openExternalLink(modrinthVersionUrl(project, v), pushToast)}
                            >
                              <Icon name="externalLink" size={14} strokeWidth={2.1} />
                            </button>
                          </div>
                        </div>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              className="versions-table-changelog markdown-body"
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                              style={{ overflow: 'hidden' }}
                              dangerouslySetInnerHTML={{ __html: renderProjectMarkdown(v.changelog) }}
                            />
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="project-sidebar">
          <div className="card">
            <div className="project-sidebar-title">{t('project.details')}</div>
            <div className="project-sidebar-row">
              <span>{t('project.downloads')}</span>
              <strong>{project.downloads?.toLocaleString()}</strong>
            </div>
            <div className="project-sidebar-row">
              <span>{t('project.followers')}</span>
              <strong>{project.followers?.toLocaleString()}</strong>
            </div>
            {project.license?.name && (
              <div className="project-sidebar-row project-sidebar-row-stack">
                <span>{t('project.license')}</span>
                <strong>{project.license.name}</strong>
              </div>
            )}
            {project.client_side && (
              <div className="project-sidebar-row">
                <span>{t('project.client')}</span>
                <strong>{ENV_LABEL[project.client_side] || project.client_side}</strong>
              </div>
            )}
            {project.server_side && (
              <div className="project-sidebar-row">
                <span>{t('project.server')}</span>
                <strong>{ENV_LABEL[project.server_side] || project.server_side}</strong>
              </div>
            )}
            {project.updated && (
              <div className="project-sidebar-row">
                <span>{t('project.updated')}</span>
                <strong>{new Date(project.updated).toLocaleDateString()}</strong>
              </div>
            )}
            {project.published && (
              <div className="project-sidebar-row">
                <span>{t('project.published')}</span>
                <strong>{new Date(project.published).toLocaleDateString()}</strong>
              </div>
            )}
          </div>

          <div className="card">
            <div className="project-sidebar-title">{t('project.links')}</div>
            <a
              href={modrinthProjectUrl(project)}
              onClick={(e) => {
                e.preventDefault();
                openExternalLink(modrinthProjectUrl(project), pushToast);
              }}
              className="project-sidebar-link"
            >
              <Icon name="globe" size={14} />
              Ver en Modrinth
              <Icon name="externalLink" size={12} className="project-sidebar-link-go" />
            </a>
            {availableLinks.map((l) => (
              <a
                key={l.key}
                href={project[l.key]}
                onClick={(e) => {
                  e.preventDefault();
                  openExternalLink(project[l.key], pushToast);
                }}
                className="project-sidebar-link"
              >
                <Icon name={l.icon} size={14} />
                {l.label}
                <Icon name="externalLink" size={12} className="project-sidebar-link-go" />
              </a>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
