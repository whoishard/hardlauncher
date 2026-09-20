const fs = require('fs');
const os = require('os');
const path = require('path');
const instanceStore = require('../store/instanceStore');

// uid → id de loader que usa Hard Launcher, tal como aparecen en los
// "components" de mmc-pack.json (Prism Launcher / MultiMC / PolyMC).
const MMC_LOADER_UIDS = {
  'net.fabricmc.fabric-loader': 'fabric',
  'org.quiltmc.quilt-loader': 'quilt',
  'net.minecraftforge': 'forge',
  'net.neoforged': 'neoforge',
};

// Carpetas de datos del juego que tiene sentido copiar a la instancia nueva.
// "options.txt"/"servers.dat" quedan afuera a propósito: son preferencias
// de ESE launcher/cuenta, no algo que sea seguro asumir para Hard Launcher.
const DATA_FOLDERS = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots'];

// Las versiones actuales de la Modrinth App ya no guardan un profile.json
// por perfil: todo se movió a una base SQLite (app.db) en la raíz de datos
// de la app. Usamos sql.js (SQLite compilado a WebAssembly, sin partes
// nativas) para leerla — así no depende de tener Python/Visual Studio Build
// Tools instalados para compilar nada durante "npm install". Se inicializa
// una sola vez de forma perezosa y se cachea la promesa.
// BUG FIX: acá se perdían TODAS las instancias de la Modrinth App moderna
// sin dejar ningún rastro visible. `sql.js` estaba en package.json pero
// nunca se había instalado de verdad (no figuraba en package-lock.json), así
// que este require fallaba en cualquier instalación hecha desde ese
// lockfile y quedaba solo en un console.error que en la app empaquetada
// (el .exe) no va a ninguna parte visible — el usuario solo veía "no se
// encontró ninguna instancia", sin ninguna pista de por qué. Ahora, aparte
// de arreglar el lockfile, cualquier falla acá queda guardada en
// `lastScanDiagnostics` (ver más abajo) para que la UI la pueda mostrar.
let sqlJsPromise;
function getSqlJs() {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      try {
        const initSqlJs = require('sql.js');
        const wasmPath = require.resolve('sql.js/dist/sql-wasm.wasm');
        return await initSqlJs({ wasmBinary: fs.readFileSync(wasmPath) });
      } catch (err) {
        // No debería pasar en un install normal, pero si por lo que sea el
        // paquete no está disponible, no es fatal: simplemente no vamos a
        // poder leer app.db, y el resto del importador (Prism, CurseForge,
        // y el viejo profile.json de Modrinth) sigue funcionando igual.
        const msg = `No pude cargar el lector de SQLite (sql.js): ${err?.message || err}. Probablemente falta reinstalar dependencias ("npm install") o reconstruir la app.`;
        console.error('[launcherImporter]', msg);
        lastScanDiagnostics.push(msg);
        return null;
      }
    })();
  }
  return sqlJsPromise;
}

// Diagnóstico de la última llamada a scanLauncherPath/detectInstalledLaunchers:
// mensajes en criollo de qué salió mal (o quedó ambiguo) leyendo Modrinth,
// para poder mostrárselos al usuario en la UI en vez de que la única señal
// sea "no encontré nada" sin explicación. Se reinicia al arrancar cada scan.
let lastScanDiagnostics = [];

// El nombre exacto de estas columnas cambió entre versiones de la app (y
// varía si la instalaron por distintos canales), así que en vez de asumir
// uno fijo se detectan las columnas realmente presentes en la tabla y se
// elige la primera que coincida. Se incluyen variantes con/sin guión bajo
// por las dudas de que el nombre real difiera del que pudimos confirmar.
const MODRINTH_DB_COLUMNS = {
  key: ['path', 'id', 'profile_path', 'directory', 'folder'],
  name: ['name', 'title'],
  mcVersion: ['game_version', 'mc_version', 'minecraft_version', 'gameversion'],
  loader: ['mod_loader', 'modloader', 'loader', 'loader_type'],
  loaderVersion: ['mod_loader_version', 'modloader_version', 'loader_version'],
  stage: ['install_stage', 'installstage', 'stage'],
};

function pickColumn(available, candidates) {
  const lower = available.map((c) => c.toLowerCase());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate);
    if (idx !== -1) return available[idx];
  }
  return null;
}

function tableColumns(db, table) {
  try {
    const pragmaResult = db.exec(`PRAGMA table_info("${table}")`);
    if (!pragmaResult.length) return null;
    const nameIdx = pragmaResult[0].columns.indexOf('name');
    return pragmaResult[0].values.map((row) => row[nameIdx]);
  } catch {
    return null;
  }
}

/**
 * BUG FIX (definitivo): confirmado con el volcado completo del esquema de
 * un app.db real, la Modrinth App actual separa los datos de instancia en
 * DOS tablas relacionadas por id, no en una sola:
 *   - "instances": tiene la carpeta real ("path") y el nombre visible
 *     ("name") y el estado de instalación ("install_stage"), pero NO la
 *     versión de Minecraft ni el loader.
 *   - "instance_content_sets": tiene la versión de Minecraft
 *     ("game_version"), el loader ("loader"/"loader_version") y su propio
 *     estado ("status"), pero está indexada por "instance_id" (que
 *     corresponde al "id" de "instances"), no por carpeta.
 * Todos los intentos anteriores fallaban siempre de la misma forma porque
 * se leía nada más que "instance_content_sets" (que sí tiene game_version,
 * por eso pasaba nuestro filtro) y esa tabla nunca tuvo ni tuvo que tener
 * el nombre de carpeta — no es un bug de esa tabla, es que hacía falta
 * cruzarla con "instances" por id para tener carpeta + versión juntos.
 * Esta función hace exactamente eso. Si "instances" no existe en esta app.db
 * (versión más vieja de la app, sin esta separación), devuelve null y el
 * llamador sigue con la detección genérica de siempre.
 */
function loadFromInstancesSchema(db) {
  const instCols = tableColumns(db, 'instances');
  if (!instCols || !instCols.includes('path')) return null;

  const instResult = db.exec('SELECT * FROM "instances"');
  if (!instResult.length) return new Map();
  const { columns: iCols, values: iRows } = instResult[0];
  const iAt = (row, c) => (iCols.includes(c) ? row[iCols.indexOf(c)] : undefined);

  // El "content set" con la versión/loader de cada instancia, indexado por
  // instance_id. Si una instancia tiene más de un content set (no debería
  // ser común), nos quedamos con el modificado más recientemente.
  const csByInstance = new Map();
  const csCols = tableColumns(db, 'instance_content_sets');
  if (csCols && csCols.includes('instance_id')) {
    const csResult = db.exec('SELECT * FROM "instance_content_sets"');
    if (csResult.length) {
      const { columns: cCols, values: cRows } = csResult[0];
      const cAt = (row, c) => (cCols.includes(c) ? row[cCols.indexOf(c)] : undefined);
      for (const row of cRows) {
        const instanceId = cAt(row, 'instance_id');
        if (instanceId == null) continue;
        const modified = Number(cAt(row, 'modified')) || 0;
        const prev = csByInstance.get(String(instanceId));
        if (!prev || modified >= prev.modified) {
          csByInstance.set(String(instanceId), {
            modified,
            gameVersion: cAt(row, 'game_version'),
            loader: cAt(row, 'loader'),
            loaderVersion: cAt(row, 'loader_version'),
            status: cAt(row, 'status'),
          });
        }
      }
    }
  }

  const map = new Map();
  const rawRowDumps = [];
  for (const row of iRows) {
    const stage = iAt(row, 'install_stage');
    if (stage && !['installed', 'installing', 'complete', 'ready'].includes(String(stage).toLowerCase())) {
      // Se excluyen estados que claramente indican "no instalado todavía"
      // (p.ej. algo tipo "not_installed"/"pending"); ante cualquier otro
      // valor no reconocido preferimos igual mostrar la instancia antes que
      // perderla por un estado que no esperábamos.
      if (['not_installed', 'pending', 'downloading', 'error', 'failed'].includes(String(stage).toLowerCase())) continue;
    }
    const id = iAt(row, 'id');
    const cs = csByInstance.get(String(id));
    const mcVersion = cs?.gameVersion;
    if (!mcVersion) continue;
    const loaderRaw = (cs?.loader || 'vanilla').toString().toLowerCase();
    const loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(loaderRaw) ? loaderRaw : 'vanilla';
    const rawPath = iAt(row, 'path');
    const name = iAt(row, 'name') || String(rawPath);
    const profileData = { name, mcVersion, loader, loaderVersion: cs?.loaderVersion || null };

    // El valor de "path" puede venir como nombre de carpeta solo o como
    // ruta completa según la versión — se indexa por ambas formas, y
    // también por el nombre visible, para no depender de adivinar cuál es.
    const baseName = path.basename(String(rawPath));
    map.set(String(rawPath), profileData);
    if (!map.has(baseName)) map.set(baseName, profileData);
    if (name && !map.has(String(name))) map.set(String(name), profileData);
    rawRowDumps.push({ id, path: rawPath, name, install_stage: stage, ...cs });
  }

  map.profileCount = rawRowDumps.length;
  map.rawKeys = rawRowDumps.map((r) => String(r.path));
  map.keyColumn = 'instances.path + instance_content_sets.game_version/loader';
  map.keySource = 'esquema instances + instance_content_sets';
  map.rawRowDumps = rawRowDumps;
  return map;
}

/**
 * Entre los nombres de columna de `table`, busca cuál contiene realmente el
 * nombre de carpeta usado en disco, comparando sus valores contra
 * `subfolderNames` (lo que hay de verdad en la carpeta "profiles"). Devuelve
 * `{ column, score }` (score = cantidad de filas que matchearon) o null si
 * ninguna columna coincide con nada. Compara tanto el valor completo como su
 * último segmento de path (por si la columna guarda una ruta completa en vez
 * de solo el nombre).
 *
 * BUG FIX: esto reemplaza a la heurística vieja de "adivinar por nombre de
 * columna" (pickColumn con una lista fija de candidatos) para el campo
 * clave. Esa heurística se rompió cuando la Modrinth App agregó "contenido
 * compartido/deduplicado" entre perfiles: en esa versión, la columna que
 * antes tenía el nombre de carpeta ("path") pasó a guardar en algunos casos
 * un identificador interno con forma "content-set:<uuid>", sin que cambiara
 * el nombre de la columna — por eso pickColumn seguía "encontrándola" pero
 * el valor ya no servía. Comparar contra las carpetas reales en disco es a
 * prueba de futuros cambios de esquema, venga con el nombre de columna que
 * venga.
 */
function findFolderNameColumn(db, table, columns, subfolderNames) {
  if (!subfolderNames || !subfolderNames.length) return null;
  const folderSet = new Set(subfolderNames.map((f) => f.toLowerCase()));
  let bestCol = null;
  let bestScore = 0;
  for (const colName of columns) {
    let valuesResult;
    try {
      valuesResult = db.exec(`SELECT "${colName}" FROM "${table}"`);
    } catch {
      continue;
    }
    if (!valuesResult.length) continue;
    let score = 0;
    for (const row of valuesResult[0].values) {
      const v = row[0];
      if (v == null) continue;
      const str = String(v).toLowerCase();
      const base = path.basename(str);
      if (folderSet.has(str) || folderSet.has(base)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = colName;
    }
  }
  return bestCol ? { column: bestCol, score: bestScore } : null;
}

/**
 * Entre las columnas de `table` (excluyendo las ya usadas como `exclude`),
 * busca una que parezca contener versiones de Minecraft con formato
 * "1.20.1", "26.2", etc. — se usa como último recurso cuando el nombre de
 * columna no está en MODRINTH_DB_COLUMNS.mcVersion, para no descartar una
 * tabla que sí tiene los datos reales solo porque le puso otro nombre a esa
 * columna.
 */
function findVersionLikeColumn(db, table, columns, exclude) {
  const versionPattern = /^\d{1,4}(\.\d{1,4}){1,3}([-.]?\w+)?$/;
  let bestCol = null;
  let bestScore = 0;
  for (const colName of columns) {
    if (exclude.has(colName)) continue;
    let valuesResult;
    try {
      valuesResult = db.exec(`SELECT "${colName}" FROM "${table}"`);
    } catch {
      continue;
    }
    if (!valuesResult.length) continue;
    let score = 0;
    for (const row of valuesResult[0].values) {
      const v = row[0];
      if (v == null) continue;
      if (versionPattern.test(String(v).trim())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCol = colName;
    }
  }
  return bestCol;
}

/**
 * Encuentra, dentro de una app.db ya abierta, la tabla que contiene los
 * perfiles/instancias reales.
 *
 * BUG FIX: antes esta función confiaba en que, si existía una tabla llamada
 * literalmente "profiles", esa era la correcta — apenas tuviera alguna
 * columna con pinta de "versión de Minecraft" ya se quedaba con ella sin
 * mirar nada más. Eso dejó de ser cierto con el sistema de "content sets"
 * (contenido compartido/deduplicado entre perfiles): en las versiones
 * nuevas de la app, la tabla que se sigue llamando "profiles" pasó a
 * guardar el ESTADO DE INSTALACIÓN de cada content-set (columnas como
 * "status", "source_kind", "protocol_version" — no un perfil de verdad), y
 * los datos de la instancia real (con su carpeta) se movieron a otra tabla,
 * referenciada desde ahí por "instance_id". Como esa tabla "profiles" nueva
 * también tiene una columna "game_version", la seguíamos aceptando de
 * entrada y nunca llegábamos a mirar la tabla correcta.
 *
 * BUG FIX 2: la primera versión de este arreglo seguía exigiendo detectar
 * una columna de "versión de Minecraft" por NOMBRE conocido antes de
 * siquiera comparar esa tabla contra las carpetas reales del disco — así
 * que si la tabla verdadera usaba un nombre de columna no contemplado para
 * la versión, la seguíamos salteando sin mirarla, y el síntoma (mismo
 * mensaje de siempre) no cambiaba. Ahora la comparación contra el disco
 * corre en TODAS las tablas sin esa condición previa; recién si una tabla
 * gana por tener columnas que matchean carpetas reales, se intenta ubicarle
 * la columna de versión (primero por nombre conocido, si no por patrón
 * "1.20.1"/"26.2", ver findVersionLikeColumn).
 *
 * Solo si NINGUNA tabla de la base tiene ninguna columna que coincida con
 * ninguna carpeta real, se cae de vuelta a la vieja heurística por nombre
 * de columna (priorizando la tabla llamada "profiles"), que sigue
 * sirviendo en versiones viejas de la app donde ese nombre de tabla y de
 * columna ("path") sí correspondían al perfil real.
 */
function findProfilesTable(db, subfolderNames) {
  const tablesResult = db.exec("SELECT name FROM sqlite_master WHERE type = 'table'");
  const tableNames = tablesResult.length ? tablesResult[0].values.map((row) => row[0]) : [];
  const ordered = tableNames.includes('profiles') ? ['profiles', ...tableNames.filter((n) => n !== 'profiles')] : tableNames;

  let bestMatch = null; // { table, columns, keyColumn, score }
  let firstByName = null; // primer candidato válido por nombre de columna (fallback si nada matchea contra disco)
  const schemaDump = []; // para diagnóstico si no se encuentra nada

  for (const table of ordered) {
    const pragmaResult = db.exec(`PRAGMA table_info("${table}")`);
    if (!pragmaResult.length) continue;
    const nameIdx = pragmaResult[0].columns.indexOf('name');
    const columns = pragmaResult[0].values.map((row) => row[nameIdx]);
    schemaDump.push({ table, columns });

    const colByName = {
      key: pickColumn(columns, MODRINTH_DB_COLUMNS.key),
      name: pickColumn(columns, MODRINTH_DB_COLUMNS.name),
      mcVersion: pickColumn(columns, MODRINTH_DB_COLUMNS.mcVersion),
      loader: pickColumn(columns, MODRINTH_DB_COLUMNS.loader),
      loaderVersion: pickColumn(columns, MODRINTH_DB_COLUMNS.loaderVersion),
      stage: pickColumn(columns, MODRINTH_DB_COLUMNS.stage),
    };

    if (!firstByName && colByName.key && colByName.mcVersion) {
      firstByName = { table, col: { ...colByName, keySource: 'nombre de columna' }, columns };
    }

    // Esto corre siempre, tenga o no la tabla una columna de versión
    // reconocida por nombre — es la única forma de no perdernos la tabla
    // correcta cuando le pusieron un nombre de columna que no esperábamos.
    const empirical = findFolderNameColumn(db, table, columns, subfolderNames);
    if (empirical && (!bestMatch || empirical.score > bestMatch.score)) {
      bestMatch = { table, columns, colByName, keyColumn: empirical.column, score: empirical.score };
    }
  }

  if (bestMatch) {
    const { table, columns, colByName, keyColumn } = bestMatch;
    let mcVersion = colByName.mcVersion;
    if (!mcVersion) {
      mcVersion = findVersionLikeColumn(db, table, columns, new Set([keyColumn, colByName.loaderVersion].filter(Boolean)));
    }
    const col = { ...colByName, key: keyColumn, mcVersion, keySource: 'disco' };
    if (col.mcVersion) return { table, col, columns, allTables: tableNames, viaDisco: true };
    // Encontramos la carpeta pero no pudimos ubicar ninguna columna de
    // versión ni por nombre ni por patrón: no alcanza para armar una
    // instancia (necesitamos sí o sí la versión de Minecraft), así que se
    // sigue con el resto de las alternativas en vez de devolver algo
    // incompleto.
  }

  // BUG FIX (diagnóstico): si se llega hasta acá es porque NINGUNA tabla de
  // la base tuvo ninguna columna cuyo contenido matcheara ninguna carpeta
  // real del disco — es decir, la elección que sigue (por nombre de tabla o
  // columna, si hay alguna) es una apuesta a ciegas, no una confirmación. En
  // ese caso se adjunta igual el esquema completo de TODAS las tablas (no
  // solo la elegida) para poder diagnosticar con datos reales en vez de
  // seguir iterando por descarte.
  if (firstByName) {
    return { table: firstByName.table, col: firstByName.col, columns: firstByName.columns, allTables: tableNames, viaDisco: false, schemaDump };
  }
  return { table: null, allTables: tableNames, schemaDump };
}

/**
 * Busca app.db cerca de `dir` (puede ser la carpeta "profiles", la carpeta
 * de un perfil puntual, o la raíz de datos de la app — se prueban los tres
 * niveles) y devuelve un Map de "nombre de carpeta" → datos del perfil
 * (nombre, versión de Minecraft, loader). Devuelve null si no se encontró
 * app.db, si no se pudo leer, o si sql.js no está disponible — en
 * cualquiera de esos casos el llamador sigue con la detección basada en
 * profile.json como antes.
 */
async function loadModrinthDbProfiles(dir, subfolderNames) {
  const candidates = [dir, path.join(dir, '..'), path.join(dir, '..', '..')].map((p) => path.join(p, 'app.db'));
  const dbPath = candidates.find((p) => fs.existsSync(p));
  if (!dbPath) return null;

  const SQL = await getSqlJs();
  if (!SQL) return null; // el motivo ya quedó en lastScanDiagnostics, ver getSqlJs()

  let db;
  try {
    db = new SQL.Database(fs.readFileSync(dbPath));

    // Se prueba primero el esquema conocido (tablas "instances" +
    // "instance_content_sets"), confirmado con datos reales — ver
    // loadFromInstancesSchema. Solo si esta app.db no lo tiene (versión
    // más vieja de la app) se cae a la detección genérica de siempre.
    const viaInstances = loadFromInstancesSchema(db);
    if (viaInstances && viaInstances.profileCount > 0) return viaInstances;

    const found = findProfilesTable(db, subfolderNames);
    if (!found.table) {
      const schemaText = found.schemaDump?.length
        ? found.schemaDump.map((t) => `${t.table}(${t.columns.join(', ')})`).join(' | ')
        : found.allTables.join(', ') || '(ninguna)';
      const msg = `Encontré ${dbPath} pero ninguna de sus tablas tiene el formato de perfiles esperado. Esquema completo: ${schemaText}`;
      console.error('[launcherImporter]', msg);
      lastScanDiagnostics.push(msg);
      return null;
    }
    const { table, col } = found;
    const schemaText = found.schemaDump?.length
      ? found.schemaDump.map((t) => `${t.table}(${t.columns.join(', ')})`).join(' | ')
      : null;

    const selectResult = db.exec(`SELECT * FROM "${table}"`);
    if (!selectResult.length) return new Map();
    const { columns: selCols, values: selRows } = selectResult[0];
    const at = (row, c) => (c ? row[selCols.indexOf(c)] : undefined);

    // BUG FIX (diagnóstico): en vez de seguir adivinando a ciegas qué
    // columna guarda el nombre de carpeta, si después no se puede
    // emparejar ninguna carpeta real igual mostramos el contenido crudo de
    // cada fila (todas las columnas, recortando valores largos/binarios
    // como el ícono) para poder ver a simple vista dónde está guardado el
    // dato real y arreglarlo con información concreta en vez de conjeturas.
    const rawRowDumps = selRows.map((row) => {
      const obj = {};
      for (let i = 0; i < selCols.length; i++) {
        const v = row[i];
        if (v == null) {
          obj[selCols[i]] = null;
        } else if (v instanceof Uint8Array) {
          obj[selCols[i]] = `<binario, ${v.length} bytes>`;
        } else {
          const s = String(v);
          obj[selCols[i]] = s.length > 150 ? `${s.slice(0, 150)}…` : s;
        }
      }
      return obj;
    });

    const map = new Map();
    // Claves "reales" (lo que vino de col.key) encontradas, sin contar los
    // alias por nombre que agregamos más abajo — se usan solo para los
    // mensajes de diagnóstico, para no inflar el conteo de perfiles.
    const rawKeys = [];
    for (const row of selRows) {
      // Perfiles que todavía se están descargando/instalando pueden tener
      // mods a medio copiar: no conviene ofrecerlos para importar. La
      // comparación es case-insensitive por si el valor real viene con otra
      // capitalización ("Installed", "INSTALLED", etc.).
      const stageVal = at(row, col.stage);
      if (col.stage && stageVal && String(stageVal).toLowerCase() !== 'installed') continue;
      const mcVersion = at(row, col.mcVersion);
      if (!mcVersion) continue;
      const loaderRaw = (at(row, col.loader) || 'vanilla').toString().toLowerCase();
      const loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(loaderRaw) ? loaderRaw : 'vanilla';
      const key = at(row, col.key);
      const name = at(row, col.name) || String(key);
      const profileData = { name, mcVersion, loader, loaderVersion: at(row, col.loaderVersion) || null };

      rawKeys.push(String(key));
      map.set(String(key), profileData);

      // BUG FIX: desde que la app agregó "content sets" (contenido
      // compartido/deduplicado entre perfiles, v0.21.0), en algunos perfiles
      // la columna que elegimos como "clave" ya no guarda el nombre real de
      // la carpeta sino un identificador interno con forma
      // "content-set:<uuid>" — la carpeta en disco se sigue llamando como el
      // nombre visible del perfil ("Fabric 26.2", etc.). Esto hacía que
      // NINGUNA carpeta real coincidiera con la única clave que sabíamos
      // buscar, y el perfil se perdía sin avisar por qué. Para cubrir ambos
      // casos, indexamos el mismo perfil también por su nombre (sin pisar
      // una clave real que ya haya matcheado antes).
      if (name && !map.has(String(name))) map.set(String(name), profileData);
    }
    if (rawKeys.length === 0 && selRows.length > 0) {
      const msg = `${dbPath}: la tabla "${table}" tiene ${selRows.length} fila(s), pero ninguna pasó los filtros (versión de Minecraft y/o estado "installed"). Columnas detectadas: key=${col.key || '?'} (elegida por ${col.keySource || '?'}), mcVersion=${col.mcVersion || '?'}, stage=${col.stage || '(ninguna)'}.`;
      console.error('[launcherImporter]', msg);
      lastScanDiagnostics.push(msg);
    }
    // Se exponen aparte del Map (que ahora puede tener más entradas que
    // perfiles reales, por los alias de nombre) para que los diagnósticos de
    // scanLauncherPath sigan contando y listando perfiles, no entradas.
    map.profileCount = rawKeys.length;
    map.rawKeys = rawKeys;
    map.keyColumn = col.key;
    map.keySource = col.keySource;
    map.rawRowDumps = rawRowDumps;
    map.schemaText = schemaText;
    return map;
  } catch (err) {
    const msg = `No pude leer ${dbPath}: ${err?.message || err}`;
    console.error('[launcherImporter]', msg);
    lastScanDiagnostics.push(msg);
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      /* noop */
    }
  }
}

/**
 * Intenta reconocer `dir` como la carpeta de una instancia ya existente de
 * otro launcher y extraer lo mínimo necesario para recrearla acá: nombre,
 * versión de Minecraft, loader, y dónde están sus datos (mods/mundos/etc).
 * Devuelve null si `dir` no coincide con ningún formato soportado.
 */
function detectInstance(dir, modrinthDbProfiles) {
  // --- Prism Launcher / MultiMC / PolyMC: comparten el mismo formato ---
  const mmcPackPath = path.join(dir, 'mmc-pack.json');
  if (fs.existsSync(mmcPackPath)) {
    let pack;
    try {
      pack = JSON.parse(fs.readFileSync(mmcPackPath, 'utf-8'));
    } catch {
      return null;
    }
    const components = pack.components || [];
    const mcComponent = components.find((c) => c.uid === 'net.minecraft');
    if (!mcComponent?.version) return null;

    const loaderComponent = components.find((c) => MMC_LOADER_UIDS[c.uid]);

    let name = path.basename(dir);
    const cfgPath = path.join(dir, 'instance.cfg');
    if (fs.existsSync(cfgPath)) {
      const match = fs.readFileSync(cfgPath, 'utf-8').match(/^name=(.+)$/m);
      if (match) name = match[1].trim();
    }

    const gameDir = ['.minecraft', 'minecraft']
      .map((d) => path.join(dir, d))
      .find((p) => fs.existsSync(p)) || dir;

    return {
      name,
      mcVersion: mcComponent.version,
      loader: loaderComponent ? MMC_LOADER_UIDS[loaderComponent.uid] : 'vanilla',
      loaderVersion: loaderComponent?.version || null,
      gameDir,
      format: 'Prism Launcher / MultiMC',
    };
  }

  // --- CurseForge App ---
  const cfManifestPath = path.join(dir, 'minecraftinstance.json');
  if (fs.existsSync(cfManifestPath)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(cfManifestPath, 'utf-8'));
    } catch {
      return null;
    }
    const mcVersion = data.baseModLoader?.minecraftVersion || data.gameVersion;
    if (!mcVersion) return null;

    const loaderName = (data.baseModLoader?.name || '').toLowerCase();
    let loader = 'vanilla';
    if (loaderName.includes('fabric')) loader = 'fabric';
    else if (loaderName.includes('quilt')) loader = 'quilt';
    else if (loaderName.includes('neoforge')) loader = 'neoforge';
    else if (loaderName.includes('forge')) loader = 'forge';

    return {
      name: data.name || path.basename(dir),
      mcVersion,
      loader,
      // CurseForge guarda la cadena completa del loader ("forge-47.2.0"),
      // Hard Launcher espera solo el número de versión.
      loaderVersion: (data.baseModLoader?.forgeVersion || data.baseModLoader?.name || '').replace(/^.*-/, '') || null,
      gameDir: dir, // CurseForge no usa una subcarpeta ".minecraft": todo vive en la raíz de la instancia.
      format: 'CurseForge',
    };
  }

  // --- Modrinth App (Theseus) ---
  // Las versiones más viejas de la app (y algunos perfiles instalados desde
  // un .mrpack) todavía dejan un "profile.json" con los metadatos dentro de
  // la propia carpeta del perfil. Las versiones más nuevas movieron esos
  // metadatos a una base SQLite (app.db) — ver loadModrinthDbProfiles más
  // abajo, que el llamador ya cargó y nos pasa en `modrinthDbProfiles`.
  const mrProfilePath = path.join(dir, 'profile.json');
  if (fs.existsSync(mrProfilePath)) {
    let data;
    try {
      data = JSON.parse(fs.readFileSync(mrProfilePath, 'utf-8'));
    } catch {
      return null;
    }
    // El nombre de los campos cambió entre versiones de la app (algunas los
    // tienen sueltos, otras anidados en "metadata"), así que se prueban los
    // dos lugares.
    const meta = data.metadata || data;
    const mcVersion = meta.game_version || data.game_version;
    if (!mcVersion) return null;

    const loaderRaw = (meta.loader || data.loader || 'vanilla').toString().toLowerCase();
    const loader = ['fabric', 'quilt', 'forge', 'neoforge'].includes(loaderRaw) ? loaderRaw : 'vanilla';
    const loaderVersionRaw = meta.loader_version || data.loader_version;
    const loaderVersion =
      typeof loaderVersionRaw === 'string' ? loaderVersionRaw : loaderVersionRaw?.id || loaderVersionRaw?.version || null;

    return {
      name: meta.name || data.name || path.basename(dir),
      mcVersion,
      loader,
      loaderVersion,
      gameDir: dir, // Modrinth tampoco usa una subcarpeta ".minecraft".
      format: 'Modrinth App',
    };
  }

  // Perfil de una versión moderna de la app: no hay profile.json en esta
  // carpeta, pero puede que ya lo hayamos leído desde app.db.
  if (modrinthDbProfiles) {
    const dbEntry = modrinthDbProfiles.get(path.basename(dir));
    if (dbEntry) {
      return {
        name: dbEntry.name,
        mcVersion: dbEntry.mcVersion,
        loader: dbEntry.loader,
        loaderVersion: dbEntry.loaderVersion,
        gameDir: dir,
        format: 'Modrinth App',
      };
    }
  }

  return null;
}

/**
 * Busca instancias importables bajo `rootPath`: puede ser la carpeta de UNA
 * instancia (se detecta directo) o la carpeta "instances"/"profiles" de otro
 * launcher que contiene varias (se revisa cada subcarpeta de primer nivel).
 */
async function scanLauncherPath(rootPath) {
  if (!fs.existsSync(rootPath)) throw new Error('Esa ruta no existe.');
  if (!fs.statSync(rootPath).isDirectory()) throw new Error('La ruta debe ser una carpeta.');

  lastScanDiagnostics = [];

  const subfolderNames = fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  // Si `rootPath` es la carpeta "profiles" de la Modrinth App (o la carpeta
  // de un perfil puntual, o la raíz de datos de la app), esto encuentra su
  // app.db y precarga los perfiles de ahí; si no aplica, devuelve null y no
  // cambia nada del resto de la detección. Le pasamos las subcarpetas reales
  // para que, si hace falta, pueda elegir la columna "clave" comparando
  // contra ellas (ver findFolderNameColumn) en vez de adivinar por nombre de
  // columna.
  const modrinthDbProfiles = await loadModrinthDbProfiles(rootPath, subfolderNames);

  const direct = detectInstance(rootPath, modrinthDbProfiles);
  if (direct) return Object.assign([{ dir: rootPath, ...direct }], { debug: [...lastScanDiagnostics] });

  const found = [];
  for (const name of subfolderNames) {
    const sub = path.join(rootPath, name);
    const parsed = detectInstance(sub, modrinthDbProfiles);
    if (parsed) found.push({ dir: sub, ...parsed });
  }

  // app.db se pudo leer y tiene filas, pero ninguna carpeta real de acá
  // matcheó ninguna: puede que la columna "clave" no sea en realidad el
  // nombre de carpeta (por ejemplo, si guarda la ruta completa en vez de
  // solo el nombre, o un id interno en vez del path). Se deja constancia
  // comparando ambos conjuntos para poder diagnosticarlo sin acceso directo
  // a la PC del usuario.
  const modrinthProfileCount = modrinthDbProfiles?.profileCount ?? modrinthDbProfiles?.size ?? 0;
  if (found.length === 0 && modrinthProfileCount > 0) {
    const rawKeys = modrinthDbProfiles.rawKeys || Array.from(modrinthDbProfiles.keys());
    const keyInfo = modrinthDbProfiles.keyColumn
      ? ` (columna usada como clave: "${modrinthDbProfiles.keyColumn}", elegida por ${modrinthDbProfiles.keySource || '?'})`
      : '';
    lastScanDiagnostics.push(
      `app.db tiene ${modrinthProfileCount} perfil(es) (claves: ${rawKeys.join(', ')})${keyInfo} pero ninguna coincide con las carpetas reales de "${rootPath}" (${subfolderNames.join(', ') || '(vacía)'}).`
    );
    if (modrinthDbProfiles.rawRowDumps?.length) {
      lastScanDiagnostics.push(
        `Contenido crudo de la tabla de perfiles (para diagnosticar qué columna guarda de verdad el nombre de carpeta): ${JSON.stringify(modrinthDbProfiles.rawRowDumps)}`
      );
    }
    // Si la columna clave se eligió "por nombre" (no porque de verdad
    // coincidiera con ninguna carpeta), la tabla elegida es una apuesta —
    // puede que la tabla correcta sea OTRA. Mostramos el esquema completo
    // de TODA la base (todas las tablas, todas las columnas) para poder
    // confirmarlo o corregirlo con datos reales.
    if (modrinthDbProfiles.keySource !== 'disco' && modrinthDbProfiles.schemaText) {
      lastScanDiagnostics.push(`Esquema completo de app.db (todas las tablas): ${modrinthDbProfiles.schemaText}`);
    }
  }

  // `debug` viaja como propiedad extra del array (no un índice numérico),
  // así que no afecta a nada que itere `found` normalmente — solo lo lee
  // quien lo busca explícitamente (ver detectInstalledLaunchers y la UI).
  return Object.assign(found, { debug: [...lastScanDiagnostics] });
}

// Ubicaciones por defecto de cada launcher soportado, por sistema operativo.
// Son las carpetas donde cada uno instala sus datos si el usuario no cambió
// nada durante su propia instalación — por eso esto es "mejor esfuerzo": si
// alguien movió esa carpeta a otro lado, no va a aparecer acá y va a tener
// que agregarla a mano con "Buscar en otra carpeta" (mismo mecanismo, solo
// que apuntado por el usuario en vez de por nosotros).
function launcherDefinitions() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const platformPaths = {
    prism: {
      win32: [path.join(appData, 'PrismLauncher', 'instances')],
      darwin: [path.join(home, 'Library', 'Application Support', 'PrismLauncher', 'instances')],
      linux: [
        path.join(home, '.local', 'share', 'PrismLauncher', 'instances'),
        // Instalación via Flatpak.
        path.join(home, '.var', 'app', 'org.prismlauncher.PrismLauncher', 'data', 'PrismLauncher', 'instances'),
      ],
    },
    // Separado de PolyMC (antes iban juntos bajo un mismo "multimc" con
    // ambas rutas mezcladas): ahora que tenemos un logo distinto para cada
    // uno, hace falta que sean entradas propias para poder mostrar el logo
    // correcto en cada caso.
    multimc: {
      win32: [path.join(appData, 'MultiMC', 'instances')],
      darwin: [path.join(home, 'Library', 'Application Support', 'multimc', 'instances')],
      linux: [path.join(home, '.local', 'share', 'multimc', 'instances')],
    },
    polymc: {
      win32: [path.join(appData, 'PolyMC', 'instances')],
      darwin: [path.join(home, 'Library', 'Application Support', 'PolyMC', 'instances')],
      linux: [path.join(home, '.local', 'share', 'polymc', 'instances')],
    },
    curseforge: {
      // Ruta por defecto que ofrece el instalador de la CurseForge App.
      win32: [path.join(home, 'curseforge', 'minecraft', 'Instances')],
      darwin: [path.join(home, 'Documents', 'curseforge', 'minecraft', 'Instances')],
      linux: [],
    },
    modrinth: {
      win32: [path.join(appData, 'ModrinthApp', 'profiles'), path.join(appData, 'com.modrinth.theseus', 'profiles')],
      darwin: [
        path.join(home, 'Library', 'Application Support', 'ModrinthApp', 'profiles'),
        path.join(home, 'Library', 'Application Support', 'com.modrinth.theseus', 'profiles'),
      ],
      linux: [
        path.join(home, '.local', 'share', 'ModrinthApp', 'profiles'),
        // Nombre de carpeta usado por versiones más viejas de la app.
        path.join(home, '.config', 'com.modrinth.theseus', 'profiles'),
        // Instalación via Flatpak.
        path.join(home, '.var', 'app', 'com.modrinth.ModrinthApp', 'data', 'ModrinthApp', 'profiles'),
      ],
    },
  };

  return [
    { id: 'prism', name: 'Prism Launcher', icon: 'layers', candidates: platformPaths.prism[process.platform] || [] },
    { id: 'multimc', name: 'MultiMC', icon: 'layers', candidates: platformPaths.multimc[process.platform] || [] },
    { id: 'polymc', name: 'PolyMC', icon: 'layers', candidates: platformPaths.polymc[process.platform] || [] },
    { id: 'curseforge', name: 'CurseForge', icon: 'flame', candidates: platformPaths.curseforge[process.platform] || [] },
    { id: 'modrinth', name: 'Modrinth App', icon: 'compass', candidates: platformPaths.modrinth[process.platform] || [] },
  ];
}

function existsAsDir(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Recorre las ubicaciones por defecto de cada launcher soportado y devuelve
 * uno por cada que efectivamente esté instalado en esta PC, junto con las
 * instancias que se le pudieron detectar adentro (puede ser un array vacío
 * si el launcher está pero todavía no tiene instancias, o si su formato no
 * se pudo leer). Launchers que no se encontraron en ningún lado no aparecen
 * en el resultado.
 */
async function detectInstalledLaunchers() {
  const results = [];
  for (const def of launcherDefinitions()) {
    const foundPath = def.candidates.find(existsAsDir);
    if (!foundPath) continue;

    let scanned = [];
    let debug = [];
    try {
      scanned = await scanLauncherPath(foundPath);
      debug = scanned.debug || [];
    } catch (err) {
      const msg = `Error escaneando ${foundPath}: ${err?.message || err}`;
      console.error(`[launcherImporter] (${def.id})`, msg);
      scanned = [];
      debug = [msg];
    }

    results.push({
      id: def.id,
      name: def.name,
      icon: def.icon,
      path: foundPath,
      // Solo se llena cuando algo salió raro (una carga de app.db fallida,
      // una tabla sin filas reconocibles, etc.) — sirve para que la UI le
      // muestre al usuario POR QUÉ no encontró nada, en vez de un genérico
      // "no se encontró ninguna instancia" sin ninguna pista. Ver
      // lastScanDiagnostics más arriba.
      debug,
      instances: scanned.map(({ dir, name, mcVersion, loader, loaderVersion, format }) => ({
        dir,
        name,
        mcVersion,
        loader,
        loaderVersion,
        format,
      })),
    });
  }
  return results;
}

function copyGameData(sourceDir, destDir) {
  for (const folder of DATA_FOLDERS) {
    const src = path.join(sourceDir, folder);
    if (fs.existsSync(src)) {
      fs.cpSync(src, path.join(destDir, folder), { recursive: true, force: true });
    }
  }
}

/**
 * Importa puntualmente las instancias de `instanceDirs` (rutas ya
 * detectadas previamente, por `detectInstalledLaunchers` o `scanLauncherPath`
 * — una por cada checkbox tildado en el paso "Importar instancia"): crea una
 * instancia nueva de Hard Launcher por cada una (mismo nombre/versión/
 * loader) y copia sus mods/config/mundos/capturas/resource packs/shaders.
 * Las rutas que ya no se puedan reconocer (se borró/movió la carpeta entre
 * que se la mostró al usuario y que confirmó la importación) se saltean en
 * silencio en vez de cortar el resto de la importación.
 */
async function importSelectedInstances(instanceDirs, onProgress) {
  const imported = [];
  // Memoizado por carpeta padre para no reabrir la misma app.db una vez por
  // cada perfil seleccionado dentro del mismo launcher.
  const dbCache = new Map();
  for (const dir of instanceDirs) {
    const parentDir = path.dirname(dir);
    if (!dbCache.has(parentDir)) {
      let siblingNames = [];
      try {
        siblingNames = fs
          .readdirSync(parentDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name);
      } catch {
        /* parentDir puede no existir más; loadModrinthDbProfiles maneja el resto */
      }
      dbCache.set(parentDir, await loadModrinthDbProfiles(parentDir, siblingNames));
    }
    const detected = detectInstance(dir, dbCache.get(parentDir));
    if (!detected) continue;
    onProgress?.({ stage: 'importing', name: detected.name, format: detected.format });
    const instance = instanceStore.createInstance({
      name: detected.name,
      mcVersion: detected.mcVersion,
      loader: detected.loader,
      loaderVersion: detected.loaderVersion,
    });
    copyGameData(detected.gameDir, instance.dir);
    imported.push(instance);
  }
  return imported;
}

module.exports = { scanLauncherPath, detectInstalledLaunchers, importSelectedInstances };
