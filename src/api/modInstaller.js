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
 * resolviendo automáticamente sus dependencias requeridas (recursivo), y las
 * descarga/instala junto con el mod en la misma llamada (no queda para
 * después ni requiere una segunda acción del usuario).
 *
 * `versionContext` ({ mcVersion, loader }), opcional: mcVersion/loader contra
 * los que resolver las dependencias REQUERIDAS de `versionData`. Si no se
 * pasa, se usa el mcVersion/loader que la instancia tiene guardados en el
 * store en este momento (comportamiento de siempre: instalar un mod desde
 * Explorar contra la versión actual de la instancia).
 *
 * BUG FIX (duplicaba mods de versiones distintas del mismo proyecto — ver
 * updateInstanceVersion más abajo, que es quien realmente necesita este
 * parámetro): antes SIEMPRE se resolvían las dependencias contra
 * `instance.mcVersion`/`instance.loader` leídos del store en este instante.
 * Eso es correcto para una instalación normal desde Explorar (la instancia
 * ya está en su versión final), pero durante "Actualizar versión de
 * instancia" es un problema: el store todavía tiene la versión VIEJA
 * mientras se van actualizando los mods uno por uno (updateInstanceVersion
 * recién pisa mcVersion/loader al final, para no dejar la instancia "a
 * mitad de camino" si algo falla antes). Entonces, si un mod que se estaba
 * actualizando a la versión nueva (p. ej. Sodium) dependía de otro que
 * también se estaba actualizando (p. ej. Fabric API), esa dependencia se
 * resolvía contra la versión VIEJA de Fabric API — volviendo a descargar
 * exactamente el .jar viejo que se acababa de reemplazar por el nuevo.
 * Resultado: dos versiones de Fabric API conviviendo en mods/, y Fabric
 * Loader rechazando el arranque por "mods incompatibles" (justo lo que se
 * veía como "Incompatible mods found!"). Ahora updateInstanceVersion pasa
 * el `target` (mcVersion/loader nuevos) como `versionContext`, así que toda
 * dependencia resuelta durante la actualización apunta a la versión nueva.
 */
async function installProjectVersion(
  instanceId,
  versionData,
  onProgress,
  visited = new Set(),
  versionContext = null
) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  if (visited.has(versionData.id)) return; // evita ciclos de dependencias
  visited.add(versionData.id);

  const primaryFile = versionData.files.find((f) => f.primary) || versionData.files[0];
  // priority: true en todos los pedidos de esta función — instalar/actualizar/
  // cambiar versión de un mod es siempre algo que el usuario disparó a mano y
  // está esperando en pantalla, a diferencia del escaneo en segundo plano de
  // enrichContentEntry, así que no debe quedar atascado detrás de ese backlog.
  const project = await modrinthApi.getProject(versionData.project_id, { priority: true });
  const targetDir = path.join(instance.dir, folderForType(project.project_type));
  const destPath = path.join(targetDir, primaryFile.filename);

  onProgress?.({ stage: 'downloading', project: project.title, file: primaryFile.filename });
  await downloadFile(primaryFile.url, destPath, primaryFile.hashes?.sha1, (p) =>
    onProgress?.({ stage: 'progress', project: project.title, ...p })
  );

  // Resolución de dependencias requeridas: se instalan en esta misma
  // llamada (recursivo), junto con el mod, nunca como un paso aparte.
  const depMcVersion = versionContext?.mcVersion ?? instance.mcVersion;
  const depLoader = versionContext?.loader ?? instance.loader;
  for (const dep of versionData.dependencies || []) {
    if (dep.dependency_type !== 'required') continue;
    let depVersion = dep.version_id ? await modrinthApi.getVersion(dep.version_id, { priority: true }) : null;
    if (!depVersion && dep.project_id) {
      const versions = await modrinthApi.getProjectVersions(dep.project_id, {
        mcVersion: depMcVersion,
        loader: depLoader,
        priority: true,
      });
      depVersion = versions[0];
    }
    if (depVersion) {
      onProgress?.({ stage: 'dependency', project: project.title, dependsOn: depVersion.name });
      await installProjectVersion(instanceId, depVersion, onProgress, visited, versionContext);
    }
  }

  // Autor/creador del proyecto, para mostrarlo debajo del nombre en la
  // pestaña Contenido (igual que la app de Modrinth). Es "best effort": si
  // la llamada falla (rate limit, sin conexión momentánea, etc.) no debe
  // frenar la instalación del mod en sí, así que nunca tira.
  let author = null;
  let authorAvatar = null;
  try {
    const members = await modrinthApi.getProjectMembers(project.id, { priority: true });
    const owner = members.find((m) => m.role === 'Owner') || members[0];
    author = owner?.user?.username || null;
    authorAvatar = owner?.user?.avatar_url || null;
  } catch {
    // sin autor resuelto por ahora; refreshContentMeta lo reintenta después
  }

  const contentEntry = {
    fileName: primaryFile.filename,
    type: project.project_type,
    projectId: project.id,
    projectTitle: project.title,
    versionId: versionData.id,
    versionNumber: versionData.version_number || null,
    enabled: true,
    iconUrl: project.icon_url,
    author,
    authorAvatar,
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
    // Se guarda también como modpackIcon (ver instanceStore.createInstance)
    // para poder volver a él después desde "Quitar ícono", aunque el
    // jugador haya puesto uno propio en el medio.
    modpackIcon: opts.icon || null,
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
    const project = await modrinthApi.getProject(versionData.project_id, { priority: true });
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

/**
 * Tipos de contenido que la actualización de versión de instancia (ver
 * checkVersionUpdatePlan/updateInstanceVersion, más abajo) revisa y
 * actualiza. A propósito deja afuera "datapack": los data packs viven
 * por-mundo (dentro de saves/<mundo>/datapacks, ver folderForType) y no
 * están atados a la versión de Minecraft/loader de la instancia de la
 * misma forma que mods/resourcepacks/shaders, así que no tiene sentido
 * tocarlos al cambiar de versión.
 */
const VERSION_UPDATE_TYPES = new Set(['mod', 'resourcepack', 'shader']);

/**
 * Ajustes de instancia → Instalación → "Actualizar versión", paso 1: arma
 * el "plan" de qué pasaría si esta instancia pasara a `target` ({
 * mcVersion, loader }) SIN aplicar ningún cambio todavía — lo usa
 * UpdateInstanceVersionModal.jsx para poder mostrarle al usuario qué se
 * puede actualizar solo y qué no antes de que confirme nada.
 *
 * Cada entrada de `content` (mods/resourcepacks/shaders) cae en uno de
 * tres grupos:
 *  - compatible: tiene projectId (viene de Modrinth) y ese proyecto SÍ
 *    tiene una versión publicada para el mcVersion/loader nuevo — se
 *    actualiza sola (ver updateInstanceVersion).
 *  - incompatible: tiene projectId pero NINGUNA versión suya sirve para
 *    el mcVersion/loader nuevo (o falló la consulta a Modrinth para ese
 *    proyecto puntual) — hace falta que el usuario decida qué hacer.
 *  - unmanaged: no tiene projectId (se agregó a mano con "Subir
 *    archivos", o el .mrpack de origen tenía un archivo que Modrinth no
 *    pudo resolver) — no hay forma de saber si sirve para la versión
 *    nueva, así que se deja completamente afuera del chequeo: ni se marca
 *    como incompatible ni se toca al aplicar el cambio, sigue instalado
 *    tal cual estaba.
 */
async function checkVersionUpdatePlan(instanceId, target) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');

  const relevant = instance.content.filter((c) => VERSION_UPDATE_TYPES.has(c.type));
  const compatible = [];
  const incompatible = [];
  const unmanaged = [];

  for (const entry of relevant) {
    if (!entry.projectId) {
      unmanaged.push(entry);
      continue;
    }
    try {
      const versions = await modrinthApi.getProjectVersions(entry.projectId, {
        mcVersion: target.mcVersion,
        // Los resourcepacks y shaders de Modrinth no dependen del mod
        // loader (uno sirve igual con Fabric o con Forge), así que solo
        // se filtra por loader cuando el contenido es un mod de verdad —
        // filtrar por loader ahí también haría que un resourcepack
        // compatible se reportara como incompatible solo porque Modrinth
        // no le puso ninguna etiqueta de loader.
        loader: entry.type === 'mod' ? target.loader : undefined,
        priority: true,
      });
      if (versions.length > 0) {
        compatible.push({ entry, newVersion: versions[0] });
      } else {
        incompatible.push(entry);
      }
    } catch (err) {
      // No se pudo resolver este proyecto puntual (offline, 404, proyecto
      // eliminado de Modrinth, etc.): se trata igual que "incompatible" —
      // no hay garantía de que sirva para la versión nueva, así que el
      // usuario tiene que decidir en vez de que el launcher asuma que sí.
      incompatible.push(entry);
    }
  }

  return { compatible, incompatible, unmanaged };
}

/**
 * Ajustes de instancia → Instalación → "Actualizar versión", paso 2: aplica
 * el cambio ya confirmado por el usuario.
 *
 *  1. Según `decision` (solo importa si hubo algo en plan.incompatible):
 *     - 'omitAndDelete': borra del todo esas entradas incompatibles
 *       (archivo + registro), igual que el botón "Eliminar" de Contenido.
 *     - cualquier otro valor (p. ej. 'continue'): se dejan instaladas tal
 *       cual estaban, sin tocarlas — el usuario elige asumir el riesgo.
 *  2. Descarga la versión nueva de cada contenido "compatible" y
 *     reemplaza el archivo viejo por el nuevo (si el nombre de archivo
 *     cambió de versión a versión, borra el viejo aparte, para no dejarlo
 *     duplicado ocupando espacio en disco).
 *  3. Recién al final, cuando todo el contenido ya se resolvió, pisa
 *     mcVersion/versionType/loader/loaderVersion de la instancia — así si
 *     algo de los pasos anteriores tira error, la instancia se queda en su
 *     versión vieja (consistente) en vez de quedar "a mitad de camino"
 *     entre dos versiones.
 */
async function updateInstanceVersion(instanceId, target, decision, onProgress) {
  const plan = await checkVersionUpdatePlan(instanceId, target);

  if (decision === 'omitAndDelete') {
    for (const entry of plan.incompatible) {
      onProgress?.({ stage: 'removing', project: entry.projectTitle });
      removeContent(instanceId, entry.fileName);
    }
  }

  // BUG FIX: si un mod del lote (p. ej. Sodium) es también dependencia
  // REQUERIDA de la nueva versión de otro mod del mismo lote (p. ej. Iris
  // y Reese's Sodium Options), NO lo actualizamos acá por su cuenta con
  // el genérico "última versión de Sodium publicada para esta versión
  // exacta de Minecraft" — ese genérico no sabe qué rango de versión
  // necesitan en realidad sus dependientes (Fabric Loader sí lo sabe,
  // porque lo lee del propio .jar de Iris/Reese's, pero Modrinth no
  // expone ese dato acá). Dejamos que Sodium se resuelva e instale
  // EXCLUSIVAMENTE por el camino de "dependencia requerida" de
  // installProjectVersion (que sí apunta al mcVersion/loader de destino,
  // ver el fix anterior). Si además procesáramos la entrada propia de
  // Sodium en este mismo loop, y le tocara el turno DESPUÉS de Iris/
  // Reese's, pisaría (con una versión más vieja e incompatible) la que
  // sus dependientes ya habían instalado correctamente — exactamente el
  // "Incompatible mods found!" (Sodium 0.8.9 vs. 0.9.x requerido) que
  // reportó el usuario.
  const dependencyProjectIds = new Set();
  for (const { newVersion } of plan.compatible) {
    for (const dep of newVersion.dependencies || []) {
      if (dep.dependency_type === 'required' && dep.project_id) {
        dependencyProjectIds.add(dep.project_id);
      }
    }
  }
  // Proyectos que se saltean del loop principal (por ser dependencia de
  // otro del lote) pero que el usuario tenía desactivados a propósito —
  // se reactivan solos al reinstalarse como dependencia (ver
  // installProjectVersion), así que hay que volver a apagarlos al final,
  // una vez que ya se resolvió su versión definitiva.
  const skippedDisabledProjectIds = new Set();

  for (const { entry, newVersion } of plan.compatible) {
    if (entry.projectId && dependencyProjectIds.has(entry.projectId)) {
      if (entry.enabled === false) skippedDisabledProjectIds.add(entry.projectId);
      continue; // se resuelve solo, como dependencia de quien lo necesita (ver más abajo)
    }

    const wasDisabled = entry.enabled === false;
    const oldFileName = entry.fileName;

    // Se pasa `target` como versionContext: cualquier dependencia requerida
    // que haga falta resolver acá (p. ej. Sodium necesitando Fabric API) se
    // busca contra la versión NUEVA de la instancia, no contra la vieja que
    // el store todavía tiene guardada en este punto (recién se pisa al
    // final de esta función). Ver el comentario de installProjectVersion
    // para el bug concreto que esto evita (mods duplicados de dos
    // versiones distintas tras "Actualizar versión").
    const newEntry = await installProjectVersion(
      instanceId,
      newVersion,
      (p) => onProgress?.({ project: entry.projectTitle, ...p }),
      new Set(),
      { mcVersion: target.mcVersion, loader: target.loader }
    );

    // Si el archivo nuevo se llama distinto al viejo (bastante común entre
    // versiones), installProjectVersion agrega una entrada NUEVA en vez de
    // pisar la vieja (filtra por nombre de archivo, ver ese mismo método)
    // — así que la entrada vieja quedaría duplicada en `content` y su
    // .jar/.zip seguiría ocupando espacio en disco. Se limpia acá, ya con
    // el archivo nuevo instalado y confirmado.
    if (newEntry && newEntry.fileName !== oldFileName) {
      const instanceNow = instanceStore.getInstance(instanceId);
      const folder = path.join(instanceNow.dir, folderForType(entry.type));
      [oldFileName, `${oldFileName}.disabled`].forEach((name) => {
        const p = path.join(folder, name);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      });
      const latest = instanceStore.getInstance(instanceId);
      instanceStore.updateInstance(instanceId, {
        content: latest.content.filter((c) => c.fileName !== oldFileName),
      });
    }

    // Un mod que el usuario tenía desactivado a propósito no debería
    // "reactivarse solo" nada más por actualizarse de versión.
    if (wasDisabled && newEntry) {
      toggleContent(instanceId, newEntry.fileName, false);
    }
  }

  // Red de seguridad final: si por alguna razón quedaron dos entradas del
  // MISMO proyecto de Modrinth (p. ej. una dependencia resuelta por un mod
  // y ese mismo proyecto también estando en plan.compatible, con nombres de
  // archivo que terminaron sin coincidir), se deja solo la más reciente
  // (versionId más alto según el orden que ya trae `content`, o si no hay
  // forma de saber cuál es más nueva, la última agregada) y se borra el
  // archivo del resto — para no volver a caer en el mismo "Incompatible
  // mods found!" por dos .jar del mismo mod conviviendo en la carpeta.
  {
    const afterUpdate = instanceStore.getInstance(instanceId);
    const seenByProject = new Map(); // projectId -> última entrada vista (se queda con la última)
    for (const c of afterUpdate.content) {
      if (!c.projectId) continue; // "manual"/unmanaged: no se puede saber si son el mismo proyecto
      seenByProject.set(c.projectId, c);
    }
    const duplicates = afterUpdate.content.filter(
      (c) => c.projectId && seenByProject.get(c.projectId) !== c
    );
    if (duplicates.length) {
      for (const dup of duplicates) {
        onProgress?.({ stage: 'removing', project: dup.projectTitle });
        const folder = path.join(afterUpdate.dir, folderForType(dup.type));
        [dup.fileName, `${dup.fileName}.disabled`].forEach((name) => {
          const p = path.join(folder, name);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        });
      }
      const dupNames = new Set(duplicates.map((d) => d.fileName));
      const cleaned = instanceStore.getInstance(instanceId);
      instanceStore.updateInstance(instanceId, {
        content: cleaned.content.filter((c) => !dupNames.has(c.fileName)),
      });
    }
  }

  if (skippedDisabledProjectIds.size) {
    const finalInstance = instanceStore.getInstance(instanceId);
    for (const c of finalInstance.content) {
      if (c.projectId && skippedDisabledProjectIds.has(c.projectId) && c.enabled !== false) {
        toggleContent(instanceId, c.fileName, false);
      }
    }
  }

  return instanceStore.updateInstance(instanceId, {
    mcVersion: target.mcVersion,
    versionType: target.versionType || 'release',
    loader: target.loader,
    loaderVersion: target.loader !== 'vanilla' ? target.loaderVersion || null : null,
  });
}

/**
 * Completa datos de un ítem de contenido que ya está instalado pero le
 * faltan (mods agregados antes de que existieran estos campos, o
 * reconstruidos por scanInstanceContent a partir de su hash): el autor y el
 * número de versión legible. También se fija si hay una versión más nueva
 * publicada para el mcVersion/loader actual de la instancia.
 *
 * "frozen" (Congelar versión, desde el menú de "..." de la fila) hace que
 * este ítem se salte por completo la revisión de actualizaciones: ni
 * aparece el botón "Actualizar" ni se lo cuenta para "Actualizar todo".
 */
async function enrichContentEntry(entry, mcVersion, loader) {
  let next = entry;
  let updateInfo = null;

  const tasks = [];

  if (entry.projectId && (!entry.author || !entry.authorAvatar)) {
    tasks.push(
      modrinthApi
        .getProjectMembers(entry.projectId)
        .then((members) => {
          const owner = members.find((m) => m.role === 'Owner') || members[0];
          const username = owner?.user?.username;
          const avatarUrl = owner?.user?.avatar_url;
          if (username || avatarUrl) {
            next = { ...next, ...(username ? { author: username } : {}), ...(avatarUrl ? { authorAvatar: avatarUrl } : {}) };
          }
        })
        .catch(() => {})
    );
  }

  if (entry.versionId && !entry.versionNumber) {
    tasks.push(
      modrinthApi
        .getVersion(entry.versionId)
        .then((v) => {
          if (v?.version_number) next = { ...next, versionNumber: v.version_number };
        })
        .catch(() => {})
    );
  }

  if (entry.projectId && !entry.frozen) {
    tasks.push(
      modrinthApi
        .getProjectVersions(entry.projectId, { mcVersion, loader })
        .then((versions) => {
          const latest = versions[0];
          if (latest && latest.id !== entry.versionId) {
            updateInfo = {
              versionId: latest.id,
              versionNumber: latest.version_number,
              versionData: latest,
            };
          }
        })
        .catch(() => {})
    );
  }

  await Promise.all(tasks);
  return { entry: next, updateInfo };
}

/**
 * Recorre todo el contenido de una instancia: completa autor/versión
 * legible faltantes (y los persiste en el store, para no volver a pedirlos)
 * y devuelve qué archivos tienen una actualización disponible.
 * Devuelve { updates: { [fileName]: { versionId, versionNumber, versionData } } }.
 */
async function refreshContentMeta(instanceId) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const loader = instance.loader && instance.loader !== 'vanilla' ? instance.loader : undefined;

  const results = await Promise.all(
    instance.content.map((entry) => enrichContentEntry(entry, instance.mcVersion, loader))
  );

  const updates = {};
  let changed = false;
  const nextContent = results.map(({ entry, updateInfo }, i) => {
    if (updateInfo) updates[entry.fileName] = updateInfo;
    if (entry !== instance.content[i]) changed = true;
    return entry;
  });

  if (changed) {
    instanceStore.updateInstance(instanceId, { content: nextContent });
  }

  return { updates };
}

/**
 * Actualiza un solo ítem de contenido a la última versión publicada para el
 * mcVersion/loader actual de la instancia. Reutiliza installProjectVersion
 * (mismo camino que instalar desde Explorar) y, si el archivo cambió de
 * nombre entre versiones, limpia el archivo viejo — mismo criterio que
 * updateInstanceVersion más abajo.
 */
async function updateContentItem(instanceId, fileName, onProgress) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const entry = instance.content.find((c) => c.fileName === fileName);
  if (!entry || !entry.projectId) {
    throw new Error('Este contenido no se puede actualizar automáticamente.');
  }

  const loader = instance.loader && instance.loader !== 'vanilla' ? instance.loader : undefined;
  const versions = await modrinthApi.getProjectVersions(entry.projectId, {
    mcVersion: instance.mcVersion,
    loader,
    priority: true,
  });
  const newVersion = versions[0];
  if (!newVersion || newVersion.id === entry.versionId) {
    throw new Error('No hay una actualización disponible.');
  }

  const wasDisabled = entry.enabled === false;
  const wasFrozen = !!entry.frozen;
  const oldFileName = entry.fileName;

  const newEntry = await installProjectVersion(instanceId, newVersion, onProgress, new Set(), {
    mcVersion: instance.mcVersion,
    loader: instance.loader,
  });

  if (newEntry && newEntry.fileName !== oldFileName) {
    const instanceNow = instanceStore.getInstance(instanceId);
    const folder = path.join(instanceNow.dir, folderForType(entry.type));
    [oldFileName, `${oldFileName}.disabled`].forEach((name) => {
      const p = path.join(folder, name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    const latest = instanceStore.getInstance(instanceId);
    instanceStore.updateInstance(instanceId, {
      content: latest.content.filter((c) => c.fileName !== oldFileName),
    });
  }

  if (newEntry && wasDisabled) toggleContent(instanceId, newEntry.fileName, false);
  if (newEntry && wasFrozen) {
    const latest = instanceStore.getInstance(instanceId);
    instanceStore.updateInstance(instanceId, {
      content: latest.content.map((c) => (c.fileName === newEntry.fileName ? { ...c, frozen: true } : c)),
    });
  }

  return newEntry;
}

/**
 * Cambia manualmente la versión instalada de un ítem de contenido a una
 * versión puntual elegida por el usuario en el modal de "Cambiar versión"
 * (para bajar de versión, probar una beta, etc. — a diferencia de
 * updateContentItem, acá no se asume "la más nueva compatible" sino la que
 * el usuario haya tocado en la lista). Mismo mecanismo de reemplazo de
 * archivo que updateContentItem: si el nombre de archivo cambió, borra el
 * viejo (y su ".disabled" si estaba desactivado) y preserva enabled/frozen.
 */
async function changeContentVersion(instanceId, fileName, targetVersionId, onProgress) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const entry = instance.content.find((c) => c.fileName === fileName);
  if (!entry || !entry.projectId) {
    throw new Error('Este contenido no admite cambio de versión manual.');
  }

  const newVersion = await modrinthApi.getVersion(targetVersionId, { priority: true });
  if (!newVersion) throw new Error('No se encontró la versión elegida.');

  const wasDisabled = entry.enabled === false;
  const wasFrozen = !!entry.frozen;
  const oldFileName = entry.fileName;

  const newEntry = await installProjectVersion(instanceId, newVersion, onProgress, new Set(), {
    mcVersion: instance.mcVersion,
    loader: instance.loader,
  });

  if (newEntry && newEntry.fileName !== oldFileName) {
    const instanceNow = instanceStore.getInstance(instanceId);
    const folder = path.join(instanceNow.dir, folderForType(entry.type));
    [oldFileName, `${oldFileName}.disabled`].forEach((name) => {
      const p = path.join(folder, name);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    });
    const latest = instanceStore.getInstance(instanceId);
    instanceStore.updateInstance(instanceId, {
      content: latest.content.filter((c) => c.fileName !== oldFileName),
    });
  }

  if (newEntry && wasDisabled) toggleContent(instanceId, newEntry.fileName, false);
  if (newEntry && wasFrozen) {
    const latest = instanceStore.getInstance(instanceId);
    instanceStore.updateInstance(instanceId, {
      content: latest.content.map((c) => (c.fileName === newEntry.fileName ? { ...c, frozen: true } : c)),
    });
  }

  return newEntry;
}

/** Actualiza todo el contenido de la instancia que tenga una actualización pendiente. */
async function updateAllContent(instanceId, onProgress) {
  const { updates } = await refreshContentMeta(instanceId);
  const results = [];
  for (const fileName of Object.keys(updates)) {
    const instance = instanceStore.getInstance(instanceId);
    const entry = instance?.content.find((c) => c.fileName === fileName);
    try {
      const newEntry = await updateContentItem(instanceId, fileName, (p) =>
        onProgress?.({ project: entry?.projectTitle, ...p })
      );
      results.push({ fileName, ok: true, newEntry });
    } catch (e) {
      results.push({ fileName, ok: false, error: e.message });
    }
  }
  return results;
}

/** Congela/descongela un ítem de contenido (ver enrichContentEntry). */
function toggleContentFreeze(instanceId, fileName, frozen) {
  const instance = instanceStore.getInstance(instanceId);
  if (!instance) throw new Error('Instancia no encontrada.');
  const updatedContent = instance.content.map((c) => (c.fileName === fileName ? { ...c, frozen } : c));
  return instanceStore.updateInstance(instanceId, { content: updatedContent });
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
  checkVersionUpdatePlan,
  updateInstanceVersion,
  refreshContentMeta,
  updateContentItem,
  changeContentVersion,
  updateAllContent,
  toggleContentFreeze,
};
