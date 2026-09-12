const fs = require('fs');
const path = require('path');
const os = require('os');
const AdmZip = require('adm-zip');
const { downloadFile, downloadQueue } = require('../core/versionManager');
const instanceStore = require('../store/instanceStore');
const modrinthApi = require('./modrinthApi');

/** Determina la subcarpeta destino según el tipo de proyecto de Modrinth. */
function folderForType(projectType) {
  switch (projectType) {
    case 'resourcepack':
      return 'resourcepacks';
    case 'shader':
      return 'shaderpacks';
    // Un data pack real de Minecraft vive dentro de saves/<mundo>/datapacks
    // (son por-mundo, no globales a la instancia como mods/resourcepacks).
    // Este launcher no tiene UI para elegir mundo destino al instalar, así
    // que por ahora se guardan en una carpeta propia "datapacks" en la raíz
    // de la instancia — al menos no se mezclan con "mods" (que es lo que
    // pasaba antes, al no tener case propio y caer en el default) — y el
    // usuario puede moverlos a mano al mundo que corresponda.
    case 'datapack':
      return 'datapacks';
    case 'mod':
    default:
      return 'mods';
  }
}

/**
 * Instala una versión concreta de un proyecto de Modrinth en la instancia,
 * resolviendo automáticamente sus dependencias requeridas (recursivo).
 */
async function installProjectVersion(instanceId, versionData, onProgress, visited = new Set()) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  if (visited.has(versionData.id)) return; // evita ciclos de dependencias
  visited.add(versionData.id);

  const primaryFile = versionData.files.find((f) => f.primary) || versionData.files[0];
  const project = await modrinthApi.getProject(versionData.project_id);
  const targetDir = path.join(instance.dir, folderForType(project.project_type));
  const destPath = path.join(targetDir, primaryFile.filename);

  onProgress?.({ stage: 'downloading', project: project.title, file: primaryFile.filename });
  await downloadFile(primaryFile.url, destPath, primaryFile.hashes?.sha1, (p) =>
    onProgress?.({ stage: 'progress', project: project.title, ...p })
  );

  // Resolución de dependencias requeridas.
  for (const dep of versionData.dependencies || []) {
    if (dep.dependency_type !== 'required') continue;
    let depVersion = dep.version_id ? await modrinthApi.getVersion(dep.version_id) : null;
    if (!depVersion && dep.project_id) {
      const versions = await modrinthApi.getProjectVersions(dep.project_id, {
        mcVersion: instance.mcVersion,
        loader: instance.loader,
      });
      depVersion = versions[0];
    }
    if (depVersion) {
      onProgress?.({ stage: 'dependency', project: project.title, dependsOn: depVersion.name });
      await installProjectVersion(instanceId, depVersion, onProgress, visited);
    }
  }

  const contentEntry = {
    fileName: primaryFile.filename,
    type: project.project_type,
    projectId: project.id,
    projectTitle: project.title,
    versionId: versionData.id,
    enabled: true,
    iconUrl: project.icon_url,
  };

  const updatedContent = [
    ...instance.content.filter((c) => c.fileName !== primaryFile.filename),
    contentEntry,
  ];
  instanceStore.updateInstance(instanceId, { content: updatedContent });

  return contentEntry;
}

/**
 * Copia uno o más archivos .jar/.zip elegidos manualmente por el usuario
 * (botón "Subir archivos", igual que en la app de Modrinth) a la carpeta
 * correcta de la instancia y los registra como contenido "manual" (sin
 * projectId, porque no vienen de Modrinth y no tenemos forma de resolver
 * su nombre/ícono reales).
 */
function addLocalFile(instanceId, filePath) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');

  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  // .jar siempre es un mod. Un .zip casi siempre es un resource pack (los
  // shader packs también son .zip, pero son mucho menos comunes al subir
  // archivos sueltos); si el resultado no es el esperado, el usuario puede
  // eliminarlo y arrastrarlo a mano en la carpeta correspondiente.
  const type = ext === '.jar' ? 'mod' : 'resourcepack';
  const targetDir = path.join(instance.dir, folderForType(type));
  fs.mkdirSync(targetDir, { recursive: true });
  const destPath = path.join(targetDir, fileName);
  fs.copyFileSync(filePath, destPath);

  const contentEntry = {
    fileName,
    type,
    projectId: null,
    projectTitle: fileName.replace(/\.(jar|zip)$/i, ''),
    versionId: null,
    enabled: true,
    iconUrl: null,
    manual: true,
  };

  const updatedContent = [...instance.content.filter((c) => c.fileName !== fileName), contentEntry];
  instanceStore.updateInstance(instanceId, { content: updatedContent });
  return contentEntry;
}

/** Activa/desactiva un mod renombrando el archivo con sufijo .disabled (estándar de Fabric/Forge/Quilt). */
function toggleContent(instanceId, fileName, enabled) {
  const instance = instanceStore.getInstance(instanceId);
  const entry = instance.content.find((c) => c.fileName === fileName);
  if (!entry) throw new Error('Contenido no encontrado en la instancia.');

  const folder = path.join(instance.dir, folderForType(entry.type));
  const currentPath = path.join(folder, enabled ? `${fileName}.disabled` : fileName);
  const newPath = path.join(folder, enabled ? fileName : `${fileName}.disabled`);
  if (fs.existsSync(currentPath)) fs.renameSync(currentPath, newPath);

  const updatedContent = instance.content.map((c) => (c.fileName === fileName ? { ...c, enabled } : c));
  instanceStore.updateInstance(instanceId, { content: updatedContent });
  return true;
}

function removeContent(instanceId, fileName) {
  const instance = instanceStore.getInstance(instanceId);
  const entry = instance.content.find((c) => c.fileName === fileName);
  if (!entry) return false;

  const folder = path.join(instance.dir, folderForType(entry.type));
  [fileName, `${fileName}.disabled`].forEach((name) => {
    const p = path.join(folder, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  const updatedContent = instance.content.filter((c) => c.fileName !== fileName);
  instanceStore.updateInstance(instanceId, { content: updatedContent });
  return true;
}

/** Subcarpetas de una instancia cuyo contenido cuenta como "content" instalado
 * (mods/resourcepacks/shaders). Todo lo demás que traiga un .mrpack en
 * index.files (configs sueltas fuera de esas carpetas, si las hubiera) se
 * descarga igual pero no se lista en la pestaña Contenido. */
const CONTENT_FOLDER_TYPE = { mods: 'mod', resourcepacks: 'resourcepack', shaderpacks: 'shader', datapacks: 'datapack' };

/**
 * Resuelve nombre/ícono real de cada archivo de un modpack vía Modrinth
 * (búsqueda inversa por hash + lookup de proyectos en lote), para que la
 * instancia recién creada muestre su contenido igual que si cada mod se
 * hubiese instalado uno por uno desde Explorar, en vez de quedar vacía.
 * Si Modrinth no puede resolver un archivo (paquete privado, borrado, o
 * simplemente falla la red), se cae a una entrada "manual" con el nombre
 * de archivo, para no perder el registro de que ese contenido existe.
 */
async function buildModpackContent(files) {
  const trackable = files
    .map((file) => {
      const [folder, ...rest] = file.path.split('/');
      const type = CONTENT_FOLDER_TYPE[folder];
      if (!type || rest.length === 0) return null;
      return { file, type, fileName: rest[rest.length - 1] };
    })
    .filter(Boolean);

  const hashes = trackable.map((t) => t.file.hashes?.sha1).filter(Boolean);
  let versionsByHash = {};
  let projectsById = {};
  try {
    versionsByHash = await modrinthApi.getVersionsByHashes(hashes);
    const projectIds = Array.from(new Set(Object.values(versionsByHash).map((v) => v.project_id)));
    if (projectIds.length) {
      const projects = await modrinthApi.getProjectsBulk(projectIds);
      projectsById = Object.fromEntries(projects.map((p) => [p.id, p]));
    }
  } catch {
    // Sin conexión o falla puntual de la API: se sigue con entradas manuales.
  }

  return trackable.map(({ file, type, fileName }) => {
    const versionInfo = file.hashes?.sha1 ? versionsByHash[file.hashes.sha1] : null;
    const project = versionInfo ? projectsById[versionInfo.project_id] : null;
    if (project) {
      return {
        fileName,
        type,
        projectId: project.id,
        projectTitle: project.title,
        versionId: versionInfo.id,
        enabled: true,
        iconUrl: project.icon_url,
      };
    }
    return {
      fileName,
      type,
      projectId: null,
      projectTitle: fileName.replace(/\.(jar|zip)$/i, ''),
      versionId: null,
      enabled: true,
      iconUrl: null,
      manual: true,
    };
  });
}

/**
 * Instala un modpack .mrpack: crea la instancia de inmediato (visible en el
 * launcher en tiempo real, con el ícono del modpack si se conoce) según el
 * manifiesto (modrinth.index.json), descarga en paralelo cada archivo
 * listado, copia los "overrides" (configs incluidas en el paquete) y por
 * último resuelve el contenido instalado (mods/resourcepacks/shaders) para
 * que quede reflejado en la instancia igual que una instalación manual.
 *
 * `opts.icon`: URL del ícono a asignarle a la instancia (normalmente
 * project.icon_url de Modrinth cuando se instala desde una búsqueda; para
 * un .mrpack importado a mano no hay forma de conocerlo de antemano).
 */
async function installModpack(mrpackPath, instanceName, onProgress, opts = {}) {
  const zip = new AdmZip(mrpackPath);
  const indexEntry = zip.getEntry('modrinth.index.json');
  if (!indexEntry) throw new Error('El archivo .mrpack no contiene un modrinth.index.json válido.');

  const index = JSON.parse(zip.readAsText(indexEntry));
  const mcVersion = index.dependencies.minecraft;
  const loader = Object.keys(index.dependencies).find((k) => k !== 'minecraft') || 'vanilla';
  const loaderVersion = index.dependencies[loader];

  // La instancia se crea ANTES de descargar nada: así aparece de inmediato
  // en la lista de instancias (Inicio, Instancias, Sidebar) apenas arranca
  // la instalación, con su ícono y su nombre ya puestos, en vez de recién
  // aparecer cuando el modpack entero terminó de descargarse.
  const instance = instanceStore.createInstance({
    name: instanceName || index.name,
    icon: opts.icon || null,
    mcVersion,
    loader: loader === 'fabric-loader' ? 'fabric' : loader,
    loaderVersion,
  });
  onProgress?.({ stage: 'instance-created', instance, project: instance.name });

  await downloadQueue(
    index.files,
    (file) => {
      const dest = path.join(instance.dir, file.path);
      const url = file.downloads[0];
      return downloadFile(url, dest, file.hashes?.sha1, (p) =>
        onProgress?.({ stage: 'progress', project: instance.name, ...p })
      );
    },
    8,
    ({ completed, total }) => onProgress?.({ stage: 'downloading', project: instance.name, completed, total })
  );

  // Overrides: archivos de configuración incluidos directamente en el .mrpack.
  const overridesPrefix = 'overrides/';
  zip.getEntries().forEach((entry) => {
    if (entry.entryName.startsWith(overridesPrefix) && !entry.isDirectory) {
      const relative = entry.entryName.substring(overridesPrefix.length);
      const dest = path.join(instance.dir, relative);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, entry.getData());
    }
  });

  onProgress?.({ stage: 'resolving', project: instance.name });
  const content = await buildModpackContent(index.files);
  return instanceStore.updateInstance(instance.id, { content });
}

/**
 * Pantalla "Install modpack" → buscar un modpack de Modrinth por nombre e
 * instalarlo directo (sin pasar por un .mrpack local): descarga el archivo
 * .mrpack de la versión elegida a una carpeta temporal y reutiliza
 * installModpack() con ese archivo, igual que si el usuario lo hubiese
 * importado a mano. Como acá sí conocemos el proyecto de Modrinth, se
 * resuelve su ícono para que la instancia nueva no quede con el ícono
 * genérico por defecto.
 */
async function installModpackFromVersion(versionData, instanceName, onProgress) {
  const primaryFile = versionData.files.find((f) => f.primary) || versionData.files[0];
  if (!primaryFile || !primaryFile.filename.toLowerCase().endsWith('.mrpack')) {
    throw new Error('Esa versión no incluye un archivo .mrpack instalable.');
  }

  let icon = null;
  let projectTitle = instanceName;
  try {
    const project = await modrinthApi.getProject(versionData.project_id);
    icon = project.icon_url || null;
    projectTitle = instanceName || project.title;
  } catch {
    // Si falla el lookup del proyecto (offline, proyecto eliminado, etc.)
    // igual se instala el modpack, solo que sin ícono personalizado.
  }

  const tmpPath = path.join(os.tmpdir(), `hardlauncher-modpack-${Date.now()}-${primaryFile.filename}`);
  onProgress?.({ stage: 'downloading', project: projectTitle, file: primaryFile.filename });
  await downloadFile(primaryFile.url, tmpPath, primaryFile.hashes?.sha1, (p) =>
    onProgress?.({ stage: 'progress', project: projectTitle, ...p })
  );

  try {
    return await installModpack(tmpPath, projectTitle, onProgress, { icon });
  } finally {
    fs.unlink(tmpPath, () => {}); // best-effort, no bloquea el resultado si falla
  }
}

module.exports = { installProjectVersion, addLocalFile, toggleContent, removeContent, installModpack, installModpackFromVersion };
