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

  // BUG FIX: acá se usaba el `instance` capturado al PRINCIPIO de esta
  // llamada (arriba del todo), de antes de resolver las dependencias. Pero
  // cada dependencia resuelta arriba (llamadas recursivas a
  // installProjectVersion) ya escribió su propia entrada en el store contra
  // la versión más reciente del array en ESE momento. Si acá se seguía
  // armando el merge final a partir del `instance.content` viejo (de antes
  // de que esas dependencias se agregaran), este updateInstance pisaba el
  // store entero con esa versión desactualizada — las entradas de las
  // dependencias quedaban "perdidas" del registro, aunque el archivo sí
  // estaba bien descargado en disco.
  //
  // Consecuencia visible: la próxima vez que se pedía la instancia
  // (instances:get), scanInstanceContent() encontraba esos archivos en
  // disco pero no en `content` — exactamente el caso que trata como "nadie
  // sabe de dónde salió este archivo" — y los volvía a agregar, pero como
  // entradas "manuales" (manual: true, sin projectId/ícono), aunque se
  // hubiesen instalado perfectamente desde Explorar. Esto es lo que se
  // reportaba como "algunos mods/resourcepacks/shaders instalados desde el
  // explorador aparecen como instalados manualmente".
  //
  // Ahora se relee el contenido actual de la instancia justo antes de armar
  // el merge, para partir siempre de la versión más reciente del store
  // (incluidas las dependencias que se acaban de agregar) en vez de la
  // capturada al principio de la función.
  const latestInstance = instanceStore.getInstance(instanceId);
  const updatedContent = [
    ...latestInstance.content.filter((c) => c.fileName !== primaryFile.filename),
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
 *
 * `preferredType` es el filtro activo en la pestaña Contenido (mods/
 * resourcepacks/shaders/datapacks) cuando el usuario le dio a "Subir
 * archivos" — electron/main.js ya lo usa para saber en qué subcarpeta abrir
 * el diálogo, así que acá se reutiliza para clasificar el archivo también.
 *
 * BUG FIX: antes esto se ignoraba por completo y el tipo se adivinaba solo
 * por extensión (.jar → mod, cualquier otra cosa → resourcepack). Un
 * shader pack o un datapack subidos como .zip terminaban SIEMPRE
 * clasificados como "resourcepack" — se copiaban a la carpeta
 * resourcepacks/ y quedaban con type: 'resourcepack', así que nunca
 * aparecían en la pestaña "Shaders" ni en "Data Packs" (que filtran por
 * ese campo type): el usuario los agregaba, no pasaba nada visible, y la
 * instancia parecía no haberlos detectado. Ahora, si el usuario tenía un
 * filtro concreto (no "all") seleccionado, se respeta ese tipo; solo se
 * cae a adivinar por extensión cuando el filtro es "all" (o no se pasó
 * ninguno), y ahí sí .jar sigue siendo mod y cualquier otra cosa cae a
 * resourcepack como antes.
 */
function addLocalFile(instanceId, filePath, preferredType) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');

  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const KNOWN_TYPES = new Set(['mod', 'resourcepack', 'shader', 'datapack']);
  const type = KNOWN_TYPES.has(preferredType)
    ? preferredType
    : (ext === '.jar' ? 'mod' : 'resourcepack');
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

/**
 * Recorre las carpetas mods/resourcepacks/shaderpacks/datapacks de una
 * instancia en disco y sincroniza contra eso el array `content` guardado
 * en el store.
 *
 * BUG FIX: `content` es solo un registro que el launcher va llevando cada
 * vez que instala/agrega algo desde la propia app (Explorar, Instalar
 * modpack, "Subir archivos") — nunca se leía de disco. Si un archivo
 * llegaba a esas carpetas de cualquier otra forma (arrastrado a mano desde
 * el explorador de archivos del sistema, copiado desde otro launcher,
 * restaurado de un backup, etc.) el juego lo cargaba sin problema, pero la
 * pestaña "Contenido" seguía sin mostrar nada — el registro nunca se
 * enteraba de que ese archivo existía. Esto es lo que se reportaba como
 * "agrego el .jar y el launcher no lo detecta, queda vacío".
 *
 * Ahora, cada vez que se pide una instancia (instances:get, que es lo que
 * dispara tanto la carga inicial de la pestaña Contenido como el botón
 * "Refrescar") se reconcilia primero:
 *  - Los archivos que ya estaban en `content` (por nombre) conservan todos
 *    sus metadatos (proyecto, ícono, versión de Modrinth), solo
 *    actualizando `enabled` según si en disco tienen sufijo .disabled.
 *  - Los archivos que están en disco pero no en `content` se agregan como
 *    entradas "manuales", con el tipo que corresponde a la carpeta real
 *    donde se encontraron (no una adivinanza por extensión).
 *  - Las entradas de `content` cuyo archivo ya no existe en disco (ni
 *    habilitado ni .disabled) se eliminan, para no dejar "fantasmas".
 */
function scanInstanceContent(instanceId) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) return null;

  const existingByFile = new Map(instance.content.map((c) => [c.fileName, c]));
  const foundFileNames = new Set();
  const reconciled = [];

  for (const [folderName, type] of Object.entries(CONTENT_FOLDER_TYPE)) {
    const folder = path.join(instance.dir, folderName);
    let entries;
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      continue; // la carpeta todavía no existe (nunca se agregó nada de ese tipo)
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const disabled = entry.name.toLowerCase().endsWith('.disabled');
      const rawName = disabled ? entry.name.slice(0, -'.disabled'.length) : entry.name;
      const ext = path.extname(rawName).toLowerCase();
      if (ext !== '.jar' && ext !== '.zip') continue; // ignora .txt, .png sueltos, etc.

      // Si el mismo nombre de archivo ya apareció en otra carpeta de esta
      // misma pasada, se prioriza la primera coincidencia encontrada.
      if (foundFileNames.has(rawName)) continue;
      foundFileNames.add(rawName);

      const existing = existingByFile.get(rawName);
      if (existing) {
        reconciled.push(existing.enabled === !disabled ? existing : { ...existing, enabled: !disabled });
      } else {
        reconciled.push({
          fileName: rawName,
          type,
          projectId: null,
          projectTitle: rawName.replace(/\.(jar|zip)$/i, ''),
          versionId: null,
          enabled: !disabled,
          iconUrl: null,
          manual: true,
        });
      }
    }
  }

  const nothingChanged =
    reconciled.length === instance.content.length &&
    instance.content.every((c) => {
      const match = reconciled.find((r) => r.fileName === c.fileName);
      return match === c;
    });
  if (nothingChanged) return instance;

  return instanceStore.updateInstance(instanceId, { content: reconciled });
}

module.exports = {
  installProjectVersion,
  addLocalFile,
  toggleContent,
  removeContent,
  installModpack,
  installModpackFromVersion,
  folderForType,
  scanInstanceContent,
};
