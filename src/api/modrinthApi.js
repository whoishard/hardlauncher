const axios = require('axios');

const BASE_URL = 'https://api.modrinth.com/v2';
const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'User-Agent': 'HardLauncher/1.0.0 (contacto@hardlauncher.app)' },
  // Sin esto, una conexión que se cuelga (no un 429, un cuelgue de red real)
  // se queda ocupando para siempre uno de los MAX_CONCURRENT lugares de la
  // cola de abajo, y todo lo que venga después —incluida cualquier acción
  // del usuario, tipo abrir "Cambiar versión"— se queda esperando su turno
  // sin que nada avance nunca. Con timeout, ese pedido eventualmente falla
  // (y se reintenta si corresponde) y libera el lugar.
  timeout: 15000,
});

// --- Límite de concurrencia + reintento ante 429, caché y deduplicación ---
// enrichContentEntry (más abajo, usado por refreshContentMeta) dispara hasta
// 3 llamadas por mod instalado (autor, versión actual, versiones
// disponibles) y las lanza TODAS en simultáneo para TODOS los mods de la
// instancia via Promise.all. En una instancia con varias docenas de mods
// eso son cientos de pedidos de golpe, muy por encima de lo que Modrinth
// deja pasar — lo que primero tiraba 429 crudo, y después (ya con cola +
// reintento) hacía que cualquier pedido nuevo —como abrir el modal de
// "Cambiar versión"— quedara esperando su turno detrás de un backlog enorme
// que además se sigue reintentando con backoff: se veía como "se queda
// cargando para siempre" en vez de un error. Tres cosas para que esto no
// vuelva a pasar:
//  1) Cola con tope de MAX_CONCURRENT pedidos en simultáneo (con reintento
//     ante 429, respetando Retry-After si Modrinth lo manda).
//  2) Caché con TTL + deduplicación: si dos llamadas piden EXACTAMENTE lo
//     mismo mientras la primera todavía está en vuelo, la segunda espera esa
//     misma respuesta en vez de disparar un pedido aparte (achica mucho el
//     volumen real cuando varios mods comparten una dependencia, o cuando
//     el usuario refresca dos veces seguidas).
//  3) Prioridad: las acciones que el usuario dispara a mano y está
//     esperando en pantalla (abrir "Cambiar versión", actualizar un mod
//     puntual) se insertan al FRENTE de la cola en vez de al final, para no
//     quedar atascadas detrás del escaneo en segundo plano de todos los
//     mods de la instancia.
const MAX_CONCURRENT = 4;
const MAX_RETRIES = 5;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos
let active = 0;
const queue = [];
const cache = new Map(); // key -> { data, at }
const pending = new Map(); // key -> Promise en vuelo (para deduplicar)

function runNext() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  active++;
  const { fn, resolve, reject } = queue.shift();
  fn()
    .then(resolve, reject)
    .finally(() => {
      active--;
      runNext();
    });
}

function enqueue(fn, { priority = false } = {}) {
  return new Promise((resolve, reject) => {
    const task = { fn, resolve, reject };
    if (priority) queue.unshift(task);
    else queue.push(task);
    runNext();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** GET a la API de Modrinth, con cola de concurrencia y reintento ante 429. */
async function apiGet(url, config, opts) {
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.get(url, config);
      } catch (e) {
        const status = e.response?.status;
        if (status !== 429 || attempt >= MAX_RETRIES) throw e;
        const retryAfter = Number(e.response?.headers?.['retry-after']);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
        await sleep(waitMs);
      }
    }
  }, opts);
}

/** POST a la API de Modrinth, mismo tratamiento que apiGet (version_files). */
async function apiPost(url, body, config, opts) {
  return enqueue(async () => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await client.post(url, body, config);
      } catch (e) {
        const status = e.response?.status;
        if (status !== 429 || attempt >= MAX_RETRIES) throw e;
        const retryAfter = Number(e.response?.headers?.['retry-after']);
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
        await sleep(waitMs);
      }
    }
  }, opts);
}

/**
 * Envuelve un fetcher con caché (TTL de CACHE_TTL_MS) + deduplicación de
 * pedidos en vuelo. `key` tiene que identificar unívocamente la consulta
 * (incluyendo los parámetros que cambian el resultado).
 */
function withCache(key, fetcher) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.data);
  if (pending.has(key)) return pending.get(key);
  const p = fetcher()
    .then((data) => {
      cache.set(key, { data, at: Date.now() });
      pending.delete(key);
      return data;
    })
    .catch((e) => {
      pending.delete(key);
      throw e;
    });
  pending.set(key, p);
  return p;
}

/**
 * Búsqueda general en Modrinth.
 * params: { query, projectType, categories: string[], mcVersions: string[],
 *           loaders: string[], index, offset, limit }
 * Los facets de Modrinth son AND entre grupos y OR dentro de cada grupo:
 * ej. [["categories:fabric","categories:forge"],["versions:1.21.1"]]
 * = (fabric O forge) Y version 1.21.1.
 */
async function search(params = {}) {
  const facets = [];
  if (params.projectType) facets.push([`project_type:${params.projectType}`]);
  if (params.mcVersions?.length) facets.push(params.mcVersions.map((v) => `versions:${v}`));
  if (params.loaders?.length) facets.push(params.loaders.map((l) => `categories:${l}`));
  if (params.categories?.length) facets.push(params.categories.map((c) => `categories:${c}`));

  const { data } = await apiGet('/search', {
    params: {
      query: params.query || '',
      facets: facets.length ? JSON.stringify(facets) : undefined,
      index: params.index || 'relevance',
      offset: params.offset || 0,
      limit: params.limit || 20,
    },
  });
  return data; // { hits, offset, limit, total_hits }
}

async function getProject(idOrSlug, opts) {
  return withCache(`project:${idOrSlug}`, async () => {
    const { data } = await apiGet(`/project/${idOrSlug}`, undefined, opts);
    return data;
  });
}

/**
 * Versiones (archivos descargables) de un proyecto, filtrables por MC
 * version y loader. `params.priority: true` hace que el pedido salte al
 * frente de la cola (usar para acciones interactivas: el usuario está
 * esperando esto en pantalla, a diferencia del escaneo en segundo plano de
 * enrichContentEntry).
 */
async function getProjectVersions(idOrSlug, params = {}) {
  const cacheKey = `versions:${idOrSlug}:${params.mcVersion || ''}:${params.loader || ''}`;
  return withCache(cacheKey, async () => {
    const { data } = await apiGet(
      `/project/${idOrSlug}/version`,
      {
        params: {
          game_versions: params.mcVersion ? JSON.stringify([params.mcVersion]) : undefined,
          loaders: params.loader ? JSON.stringify([params.loader]) : undefined,
        },
      },
      { priority: !!params.priority }
    );
    return data;
  });
}

async function getVersion(versionId, opts) {
  return withCache(`version:${versionId}`, async () => {
    const { data } = await apiGet(`/version/${versionId}`, undefined, opts);
    return data;
  });
}

/**
 * Miembros del equipo de un proyecto (para poder mostrar el autor/creador
 * debajo del nombre en la pestaña Contenido, igual que la app de Modrinth).
 * El proyecto en sí no trae el nombre del creador, solo el ID de su equipo
 * ("team"), así que hace falta esta llamada aparte para resolverlo a un
 * nombre de usuario mostrable.
 */
async function getProjectMembers(idOrSlug, opts) {
  return withCache(`members:${idOrSlug}`, async () => {
    const { data } = await apiGet(`/project/${idOrSlug}/members`, undefined, opts);
    return data;
  });
}

/** Resuelve múltiples proyectos a la vez (usado para mostrar nombres de dependencias). */
async function getProjectsBulk(ids) {
  const { data } = await apiGet('/projects', { params: { ids: JSON.stringify(ids) } });
  return data;
}

/**
 * Resuelve un lote de archivos por su hash sha1 → { hash: VersionObject }.
 * Se usa para reconstruir el "content" de un modpack (.mrpack): el índice
 * de un modpack solo trae url + hash de cada archivo, no a qué proyecto de
 * Modrinth pertenece, así que hace falta esta búsqueda inversa para poder
 * mostrar nombre/ícono real de cada mod en la pestaña Contenido en vez de
 * un simple nombre de archivo sin metadata.
 */
async function getVersionsByHashes(hashes) {
  if (!hashes.length) return {};
  const { data } = await apiPost('/version_files', { hashes, algorithm: 'sha1' });
  return data;
}

/**
 * Tags usados para armar los filtros de la vista Explorar, igual que la web
 * real de Modrinth: cada categoría trae { icon, name, project_type, header }
 * y "header" agrupa (ej. "Categories", "Performance impact", "Features").
 */
async function getCategories() {
  const { data } = await apiGet('/tag/category');
  return data;
}

async function getLoaders() {
  const { data } = await apiGet('/tag/loader');
  return data;
}

async function getGameVersions() {
  const { data } = await apiGet('/tag/game_version');
  return data;
}

module.exports = {
  search,
  getProject,
  getProjectVersions,
  getVersion,
  getProjectMembers,
  getProjectsBulk,
  getVersionsByHashes,
  getCategories,
  getLoaders,
  getGameVersions,
};
