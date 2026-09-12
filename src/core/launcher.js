const { spawn, exec } = require('child_process');
const path = require('path');
const os = require('os');

const versionManager = require('./versionManager');
const javaManager = require('./javaManager');
const loaderManager = require('./loaderManager');
const instanceStore = require('../store/instanceStore');
const settingsStore = require('../store/settingsStore');

// instanceId -> { proc, exitPromise }. Se usa para poder cerrar el proceso
// de una instancia desde afuera (ver stopInstance más abajo) — por ejemplo
// cuando el jugador toca "Jugar" en un servidor recomendado y esa MISMA
// instancia ya está corriendo: Minecraft no tiene forma de pedirle a un
// proceso ya abierto que se conecte a otro lado, así que la única manera
// de "entrar" es cerrar el viejo y volver a lanzarlo ya apuntando ahí.
const runningProcesses = new Map();

function isRunning(instanceId) {
  return runningProcesses.has(instanceId);
}

/**
 * Cierra el proceso del juego de una instancia si está corriendo, y espera
 * a que el proceso real del sistema operativo termine de verdad (no solo a
 * que se mande la señal) antes de resolver — la carpeta de la instancia
 * queda bloqueada mientras el proceso viejo sigue vivo, así que lanzar uno
 * nuevo antes de esto terminaría fallando o pisándose con el anterior.
 * Devuelve false sin hacer nada si esa instancia no estaba corriendo.
 */
function stopInstance(instanceId) {
  const entry = runningProcesses.get(instanceId);
  if (!entry) return Promise.resolve(false);
  entry.proc.kill();
  return entry.exitPromise.then(() => true);
}

/**
 * Parsea el textarea de "Environment variables" (una variable por línea,
 * formato KEY=VALUE, igual que Modrinth App) a un objeto plano.
 */
function parseEnvVars(text) {
  const out = {};
  for (const line of (text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

/** Corre un comando de hook (pre-lanzamiento / post-cierre) y espera a que termine. */
function runHookCommand(command, cwd, label, onLog) {
  return new Promise((resolve) => {
    if (!command || !command.trim()) return resolve();
    onLog?.(`[Hard Launcher] Ejecutando hook (${label}): ${command}`);
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (stdout) onLog?.(stdout);
      if (stderr) onLog?.(stderr);
      if (error) onLog?.(`[Hard Launcher] El hook de ${label} terminó con error: ${error.message}`);
      resolve();
    });
  });
}

const CLASSPATH_SEPARATOR = process.platform === 'win32' ? ';' : ':';

/**
 * Reemplaza los placeholders ${...} de los argumentos JVM/game que define
 * el JSON oficial de Mojang (auth_player_name, version_name, game_directory, etc.)
 */
function resolvePlaceholders(argString, values) {
  return argString.replace(/\$\{(\w+)\}/g, (_, key) => (values[key] !== undefined ? values[key] : `\${${key}}`));
}

/**
 * Evalúa si una regla individual del JSON de Mojang aplica al contexto actual.
 * Las reglas pueden condicionar por SO (`os`) y/o por "features" del
 * lanzamiento (`features`, ej. is_demo_user, has_custom_resolution).
 */
function ruleMatches(rule, features) {
  if (rule.os?.name && rule.os.name !== javaManager.platformKey().split('-')[0]) return false;
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if (!!features[key] !== !!expected) return false;
    }
  }
  return true;
}

/** Aplica el algoritmo oficial de Mojang: última regla que matchea gana (default = denegado si hay reglas). */
function rulesAllow(rules, features) {
  let allowed = false;
  for (const rule of rules) {
    if (ruleMatches(rule, features)) allowed = rule.action === 'allow';
  }
  return allowed;
}

/** Extrae y resuelve la lista de argumentos JVM/game del JSON de versión (formato moderno con "rules"). */
function extractArgs(argsField, values, features) {
  if (!argsField) return [];
  const out = [];
  for (const arg of argsField) {
    if (typeof arg === 'string') {
      out.push(resolvePlaceholders(arg, values));
    } else if (arg.rules) {
      if (rulesAllow(arg.rules, features)) {
        const values2 = Array.isArray(arg.value) ? arg.value : [arg.value];
        values2.forEach((v) => out.push(resolvePlaceholders(v, values)));
      }
    }
  }
  return out;
}

/**
 * Construye el comando completo de lanzamiento. Es la pieza central que
 * diferencia Offline Mode (no-premium) de Online Mode (premium):
 * ambos generan los mismos flags --username/--uuid/--accessToken, pero
 * la cuenta offline usa un UUID v3 local y un token no verificado por Mojang,
 * mientras que la premium usa el accessToken real emitido por Xbox/Minecraft Services.
 */
async function buildLaunchCommand(instance, account, installResult, javaBin, directConnect) {
  const { versionDetails, classpath, nativesDir, assetsDir, assetIndexId, gameRoot } = installResult;
  const defaults = settingsStore.getSettings();

  // Pestaña "Ventana": si la instancia no tiene ajustes de ventana propios,
  // se hereda la resolución por defecto del launcher (Ajustes → Valores por
  // defecto) y nunca se fuerza pantalla completa.
  const resolutionWidth = instance.customWindow ? instance.resolutionWidth : defaults.defaultResolutionWidth;
  const resolutionHeight = instance.customWindow ? instance.resolutionHeight : defaults.defaultResolutionHeight;
  const fullscreen = instance.customWindow ? !!instance.fullscreen : !!defaults.defaultFullscreen;

  // Pestaña "Java y memoria" → "Custom memory allocation": sin ella, se usa
  // la memoria por defecto global en vez de lo que haya quedado guardado en
  // la instancia de una edición anterior.
  const memoryMin = instance.customMemory ? instance.memoryMin : defaults.defaultMemoryMin;
  const memoryMax = instance.customMemory ? instance.memoryMax : defaults.defaultMemoryMax;

  const finalClasspath = [...classpath];
  let mainClass = versionDetails.mainClass;

  // Fusiona con el perfil del loader si la instancia no es vanilla.
  if (instance.loader === 'fabric' || instance.loader === 'quilt') {
    let loaderVersion = instance.loaderVersion;

    // Compatibilidad hacia atrás: instancias creadas antes de que el modal
    // pidiera explícitamente la versión del loader quedaron con este campo
    // en null, lo que hacía que la API respondiera 400. Si falta, se toma
    // automáticamente la más reciente disponible para esta versión de MC.
    if (!loaderVersion) {
      const available = await loaderManager.listLoaderVersions(instance.loader, instance.mcVersion);
      if (!available.length) {
        throw new Error(
          `No hay versiones de ${instance.loader} disponibles para Minecraft ${instance.mcVersion}.`
        );
      }
      loaderVersion = available[0].version;
      instanceStore.updateInstance(instance.id, { loaderVersion });
    }

    const loaderData = await loaderManager.installFabricLike(instance.loader, instance.mcVersion, loaderVersion);
    finalClasspath.push(...loaderData.extraLibraries);
    mainClass = loaderData.mainClass;
  }
  // Forge/NeoForge devuelven un versionId propio ya resuelto en instanceStore
  // en el momento de la instalación (ver loaderManager.installForgeLike).

  const values = {
    auth_player_name: account.username,
    version_name: instance.mcVersion,
    game_directory: instance.dir,
    assets_root: assetsDir,
    assets_index_name: assetIndexId,
    auth_uuid: account.uuid,
    auth_access_token: account.accessToken,
    // Modo offline no usa "msa"/xbox; ambos tipos comparten el mismo flag user_type.
    user_type: account.type === 'premium' ? 'msa' : 'legacy',
    version_type: instance.versionType,
    natives_directory: nativesDir,
    launcher_name: 'Hard Launcher',
    launcher_version: '1.0.0',
    classpath: finalClasspath.join(CLASSPATH_SEPARATOR),
    auth_xuid: account.xuid || '0',
    clientid: account.clientId || '00000000-0000-0000-0000-000000000000',
    resolution_width: resolutionWidth,
    resolution_height: resolutionHeight,
  };

  // "Unirse de una" desde la lista de servidores recomendados: si viene un
  // directConnect ({host, port}), se pide el flag "Quick Play Multiplayer"
  // (el mismo que usa el launcher oficial desde 1.20 para el botón "Jugar"
  // de un server en la pantalla de inicio de Minecraft) para que el juego
  // entre directo al servidor sin pasar por el menú principal.
  if (directConnect) {
    // OJO: a diferencia de TODOS los demás placeholders de acá (que son
    // snake_case: auth_player_name, version_name, etc.), los 4 placeholders
    // de "Quick Play" que Mojang define en el JSON de versión (1.20+) son
    // camelCase: ${quickPlayPath}, ${quickPlaySingleplayer},
    // ${quickPlayMultiplayer}, ${quickPlayRealms}. Con la clave en
    // snake_case (bug anterior: "quick_play_multiplayer") resolvePlaceholders
    // nunca la encontraba, así que el flag "--quickPlayMultiplayer" se
    // agregaba igual (es un string fijo en el JSON, no un placeholder) pero
    // con el valor sin resolver ("${quickPlayMultiplayer}" literal) — el
    // juego arrancaba pero jamás se unía al servidor, y encima el chequeo de
    // abajo (fullArgs.includes('--quickPlayMultiplayer')) daba true igual,
    // así que tampoco caía al respaldo --server/--port.
    values.quickPlayMultiplayer = directConnect.port && directConnect.port !== 25565
      ? `${directConnect.host}:${directConnect.port}`
      : directConnect.host;
  }

  // Controla qué argumentos condicionales ("rules" con "features") se activan.
  // is_demo_user SIEMPRE debe quedar en false aquí: tanto las cuentas
  // No-Premium como las Premium de Hard Launcher son cuentas "completas"
  // desde el punto de vista del cliente — la demo de Mojang es un modo
  // aparte para quien no tiene ninguna cuenta en absoluto. Este era el bug:
  // antes NINGUNA regla de "features" se evaluaba y --demo se agregaba siempre.
  const features = {
    is_demo_user: false,
    has_custom_resolution: true,
    has_quick_plays_support: !!directConnect,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: !!directConnect,
    is_quick_play_realms: false,
  };

  const jvmArgsFromVersion = extractArgs(versionDetails.arguments?.jvm, values, features);
  const gameArgsFromVersion = extractArgs(versionDetails.arguments?.game, values, features);

  // Compatibilidad con JSONs antiguos (<1.13) que no usan "arguments" sino "minecraftArguments".
  const legacyGameArgs = versionDetails.minecraftArguments
    ? resolvePlaceholders(versionDetails.minecraftArguments, values).split(' ')
    : [];

  // Pestaña "Java y memoria" → "Custom Java arguments": si no está activada,
  // no se aplican argumentos JVM guardados de una edición previa.
  const customJvmArgs = instance.customJvmArgs ? (instance.jvmArgs || '').split(' ').filter(Boolean) : [];

  const fullArgs = [
    `-Xms${memoryMin}M`,
    `-Xmx${memoryMax}M`,
    `-Djava.library.path=${nativesDir}`,
    ...customJvmArgs,
    ...(jvmArgsFromVersion.length ? jvmArgsFromVersion : ['-cp', values.classpath]),
    mainClass,
    ...(gameArgsFromVersion.length ? gameArgsFromVersion : legacyGameArgs),
  ];

  // Si el JSON moderno no incluyó "-cp" explícito, se agrega manualmente.
  if (!fullArgs.includes('-cp')) {
    fullArgs.splice(fullArgs.indexOf(mainClass), 0, '-cp', values.classpath);
  }

  // Respaldo para versiones viejas: el JSON de versiones anteriores a 1.20
  // no tiene reglas de "quick play" (esas features no existían todavía), así
  // que el bloque de arriba no agrega ningún flag aunque se haya pedido
  // directConnect. Esas versiones sí entienden los flags clásicos
  // "--server"/"--port" (conexión directa de toda la vida, previa a Quick
  // Play), así que se agregan a mano solo si el quick play de arriba no
  // terminó poniendo nada.
  if (directConnect && !fullArgs.includes('--quickPlayMultiplayer')) {
    fullArgs.push('--server', directConnect.host, '--port', String(directConnect.port || 25565));
  }

  return { javaBin, args: fullArgs, cwd: instance.dir, fullscreen };
}

/**
 * Pestaña "Ventana" → "Fullscreen": Minecraft no tiene un flag de
 * lanzamiento para esto (a partir de 1.13 la ventana la maneja LWJGL/GLFW),
 * así que se aplica escribiendo la clave "fullscreen" en options.txt antes
 * de lanzar — el mismo mecanismo que usa Modrinth App (lo indica su propio
 * hint: "using options.txt"). Solo se toca el archivo cuando la instancia
 * pide fullscreen explícitamente, para no pisar la preferencia manual del
 * jugador cuando el ajuste está desactivado.
 */
function applyFullscreenOption(instanceDir, fullscreen) {
  if (!fullscreen) return;
  const fs = require('fs');
  const optionsPath = path.join(instanceDir, 'options.txt');
  let lines = [];
  if (fs.existsSync(optionsPath)) {
    lines = fs.readFileSync(optionsPath, 'utf-8').split('\n').filter(Boolean);
  }
  const idx = lines.findIndex((l) => l.startsWith('fullscreen:'));
  if (idx === -1) lines.push('fullscreen:true');
  else lines[idx] = 'fullscreen:true';
  fs.writeFileSync(optionsPath, lines.join('\n') + '\n');
}

async function launch(instance, account, hooks = {}, directConnect = null) {
  const { onProgress, onLog, onExit } = hooks;

  onLog?.(`[Hard Launcher] Preparando instancia "${instance.name}" (${instance.mcVersion} / ${instance.loader})...`);

  // Pestaña "Ajustes" → "Launch hooks": comando de pre-lanzamiento, se
  // espera a que termine antes de seguir preparando/lanzando el juego.
  if (instance.customHooks && instance.preLaunchHook) {
    await runHookCommand(instance.preLaunchHook, instance.dir, 'pre-lanzamiento', onLog);
  }

  const installResult = await versionManager.ensureVersionInstalled(instance.mcVersion, onProgress);
  const instanceJavaPath = instance.customJava ? instance.javaPath : null;
  const javaBin = await javaManager.ensureJavaForVersion(installResult.versionDetails, onProgress, instanceJavaPath);

  onLog?.(`[Hard Launcher] Usando Java: ${javaBin}`);
  onLog?.(
    `[Hard Launcher] Cuenta activa: ${account.username} (${account.type === 'premium' ? 'Premium/Microsoft' : 'No-Premium/Offline'})`
  );

  if (directConnect) {
    onLog?.(`[Hard Launcher] Uniéndose directo a ${directConnect.host}:${directConnect.port || 25565}...`);
  }

  const { args, cwd, fullscreen } = await buildLaunchCommand(instance, account, installResult, javaBin, directConnect);

  applyFullscreenOption(cwd, fullscreen);

  const env = { ...process.env };
  if (instance.customEnvVars) Object.assign(env, parseEnvVars(instance.envVars));

  // Pestaña "Launch hooks" → "Wrapper": comando que envuelve el proceso del
  // juego (ej. "gamemoderun", "mangohud", un script propio), igual que en
  // Modrinth. Si está definido, se lanza a través de una shell con el
  // comando de Java ya armado como sufijo.
  const wrapper = instance.customHooks ? (instance.wrapperHook || '').trim() : '';
  const proc = wrapper
    ? spawn(`${wrapper} "${javaBin}" ${args.map((a) => `"${a}"`).join(' ')}`, { cwd, env, shell: true })
    : spawn(javaBin, args, { cwd, env });
  const sessionStart = Date.now();

  let resolveExit;
  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });
  runningProcesses.set(instance.id, { proc, exitPromise });

  proc.stdout.on('data', (data) => onLog?.(data.toString()));
  proc.stderr.on('data', (data) => onLog?.(data.toString()));
  proc.on('exit', (code) => {
    runningProcesses.delete(instance.id);
    resolveExit();
    onLog?.(`[Hard Launcher] El proceso del juego terminó con código ${code}.`);
    // Se acumula el tiempo de esta sesión sobre el total ya guardado (no sobre
    // el valor cerrado por closure) para no pisar cambios hechos mientras el
    // juego estaba abierto (ej. edición de ajustes de la instancia).
    const current = instanceStore.getInstance(instance.id);
    const sessionMs = Date.now() - sessionStart;
    instanceStore.updateInstance(instance.id, {
      lastPlayed: Date.now(),
      totalPlaytime: (current?.totalPlaytime || 0) + sessionMs,
    });

    // Pestaña "Launch hooks" → "Post-exit": corre después de que el juego
    // cierra, sin bloquear el evento onExit (que ya libera la UI).
    if (instance.customHooks && instance.postExitHook) {
      runHookCommand(instance.postExitHook, instance.dir, 'post-cierre', onLog);
    }

    onExit?.(code);
  });

  return { pid: proc.pid };
}

/**
 * Ajustes de instancia → Instalación → "Repair instance": vuelve a
 * verificar/descargar los archivos base de Minecraft (y del loader, si
 * aplica) y el runtime de Java. Como versionManager.downloadFile ya
 * compara el sha1 antes de bajar de nuevo cada archivo, esto de paso
 * corrige cualquier librería/asset corrupto sin tener que borrar nada a mano.
 */
async function repairInstance(instance, onProgress, onLog) {
  onLog?.(`[Hard Launcher] Reparando instancia "${instance.name}"...`);
  const installResult = await versionManager.ensureVersionInstalled(instance.mcVersion, onProgress);

  if (instance.loader === 'fabric' || instance.loader === 'quilt') {
    let loaderVersion = instance.loaderVersion;
    if (!loaderVersion) {
      const available = await loaderManager.listLoaderVersions(instance.loader, instance.mcVersion);
      loaderVersion = available[0]?.version;
      if (loaderVersion) instanceStore.updateInstance(instance.id, { loaderVersion });
    }
    if (loaderVersion) {
      await loaderManager.installFabricLike(instance.loader, instance.mcVersion, loaderVersion, onProgress);
    }
  }

  const instanceJavaPath = instance.customJava ? instance.javaPath : null;
  await javaManager.ensureJavaForVersion(installResult.versionDetails, onProgress, instanceJavaPath);
  onLog?.('[Hard Launcher] Reparación completa.');
}

module.exports = { launch, buildLaunchCommand, repairInstance, stopInstance, isRunning };
