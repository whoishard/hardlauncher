const axios = require('axios');

const BASE_URL = 'https://api.modrinth.com/v2';
const client = axios.create({
  baseURL: BASE_URL,
  headers: { 'User-Agent': 'HardLauncher/1.0.0 (contacto@hardlauncher.app)' },
});

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

  const { data } = await client.get('/search', {
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

async function getProject(idOrSlug) {
  const { data } = await client.get(`/project/${idOrSlug}`);
  return data;
}

/** Versiones (archivos descargables) de un proyecto, filtrables por MC version y loader. */
async function getProjectVersions(idOrSlug, params = {}) {
  const { data } = await client.get(`/project/${idOrSlug}/version`, {
    params: {
      game_versions: params.mcVersion ? JSON.stringify([params.mcVersion]) : undefined,
      loaders: params.loader ? JSON.stringify([params.loader]) : undefined,
    },
  });
  return data;
}

async function getVersion(versionId) {
  const { data } = await client.get(`/version/${versionId}`);
  return data;
}

/** Resuelve múltiples proyectos a la vez (usado para mostrar nombres de dependencias). */
async function getProjectsBulk(ids) {
  const { data } = await client.get('/projects', { params: { ids: JSON.stringify(ids) } });
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
  const { data } = await client.post('/version_files', { hashes, algorithm: 'sha1' });
  return data;
}

/**
 * Tags usados para armar los filtros de la vista Explorar, igual que la web
 * real de Modrinth: cada categoría trae { icon, name, project_type, header }
 * y "header" agrupa (ej. "Categories", "Performance impact", "Features").
 */
async function getCategories() {
  const { data } = await client.get('/tag/category');
  return data;
}

async function getLoaders() {
  const { data } = await client.get('/tag/loader');
  return data;
}

async function getGameVersions() {
  const { data } = await client.get('/tag/game_version');
  return data;
}

module.exports = {
  search,
  getProject,
  getProjectVersions,
  getVersion,
  getProjectsBulk,
  getVersionsByHashes,
  getCategories,
  getLoaders,
  getGameVersions,
};
