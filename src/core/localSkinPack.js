const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

// ---------- Skin local para cuentas no-premium ----------
//
// Las cuentas premium (Microsoft) tienen un perfil real de Mojang: el
// servidor le manda a TODOS los que están en la partida la textura firmada
// de esa cuenta, así que la skin se ve igual para todo el mundo sin que el
// launcher tenga que hacer nada.
//
// Las cuentas offline/no-premium no tienen ningún perfil firmado — para
// cualquier OTRO jugador (o server) que las vea, siempre van a ser el Steve
// de siempre, no hay forma de cambiar eso desde acá (haría falta un mod del
// lado del server, o de todos los que miran). Lo que SÍ se puede hacer sin
// tocar el server ni depender de que nadie más instale nada: generar un
// resource pack que pisa la textura POR DEFECTO de Steve/Alex y dejarlo
// prendido de entrada. Un resource pack es 100% local al cliente que lo
// tiene puesto — nadie más en la partida lo ve ni sabe que existe — así que
// el resultado es exactamente lo que se pidió: el jugador se ve con su
// skin subida, pero solo en SU pantalla, para cualquier otro sigue siendo
// el Steve de siempre.
//
// Efecto secundario esperable (y aceptado a propósito): como esto pisa la
// textura POR DEFECTO y no una textura atada a esta cuenta puntual, mientras
// el pack está puesto cualquier OTRO jugador de la partida que también esté
// mostrando el Steve/Alex por defecto (otro no-premium sin skin propia, o
// alguien cuya skin no cargó) se va a ver con esta misma textura en la
// pantalla de este jugador. Es el mismo compromiso que ya hacen launchers
// tipo TLauncher con esta función — no hay forma de limitarlo a "un solo
// jugador puntual" sin un mod de verdad, y sigue siendo 100% cosmético y
// 100% del lado de quien lo activó.

const PACK_FILE_NAME = 'hardlauncher_local_skin.zip';

// Las dos versiones del modelo de brazos (Steve = clásico/ancho, Alex =
// slim) y las dos rutas que usó el juego para esas texturas a lo largo del
// tiempo (la de antes de 1.19.3-ish, y la de después, cuando Mojang separó
// wide/slim en subcarpetas). Se pisan las 4 a la vez: para la versión que
// esté corriendo el juego, dos de ellas no existen como asset real y el
// resource pack simplemente las ignora sin romper nada — más simple que
// mantener una tabla de "qué ruta le toca a cada versión".
function skinTargetPaths() {
  return [
    'assets/minecraft/textures/entity/steve.png',
    'assets/minecraft/textures/entity/alex.png',
    'assets/minecraft/textures/entity/player/wide/steve.png',
    'assets/minecraft/textures/entity/player/slim/alex.png',
  ];
}

// Tabla de pack_format por versión (wiki.vg/Pack_format): hace falta un
// número "razonablemente cercano" al de la versión que se está lanzando
// para que el juego no marque el pack como "diseñado para otra versión" y
// pida una confirmación extra antes de aplicarlo solo. No hace falta que
// sea exacto para versiones nuevas que salieron después de esta lista: se
// usa el valor más alto conocido como piso (ver resolvePackFormat) — en el
// peor caso, versiones MUY nuevas ven ese cartel de confirmación una vez,
// nunca un pack roto.
const PACK_FORMAT_TABLE = [
  { until: '1.8.9', format: 1 },
  { until: '1.10.2', format: 2 },
  { until: '1.12.2', format: 3 },
  { until: '1.14.4', format: 4 },
  { until: '1.16.1', format: 5 },
  { until: '1.16.5', format: 6 },
  { until: '1.17.1', format: 7 },
  { until: '1.18.2', format: 8 },
  { until: '1.19.2', format: 9 },
  { until: '1.19.3', format: 12 },
  { until: '1.19.4', format: 13 },
  { until: '1.20.1', format: 15 },
  { until: '1.20.2', format: 18 },
  { until: '1.20.4', format: 22 },
  { until: '1.20.6', format: 32 },
  { until: '1.21.1', format: 34 },
  { until: '1.21.3', format: 42 },
  { until: '1.21.4', format: 46 },
  { until: '1.21.5', format: 55 },
  { until: '1.21.6', format: 63 },
];

function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function resolvePackFormat(mcVersion) {
  const clean = String(mcVersion || '').match(/^\d+\.\d+(\.\d+)?/)?.[0];
  if (!clean) return PACK_FORMAT_TABLE[PACK_FORMAT_TABLE.length - 1].format;
  for (const entry of PACK_FORMAT_TABLE) {
    if (compareVersions(clean, entry.until) <= 0) return entry.format;
  }
  // Versión más nueva que toda la tabla: se usa el piso más alto conocido
  // (ver comentario de la tabla) en vez de romper con un valor inventado.
  return PACK_FORMAT_TABLE[PACK_FORMAT_TABLE.length - 1].format;
}

function dataUrlToBuffer(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const commaIdx = dataUrl.indexOf(',');
  if (commaIdx === -1) return null;
  try {
    return Buffer.from(dataUrl.slice(commaIdx + 1), 'base64');
  } catch {
    return null;
  }
}

function removeIfExists(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* si no se puede borrar (permisos, en uso) no es grave: el próximo
       ensurePack lo vuelve a pisar igual */
  }
}

// Agrega/saca la entrada "file/<PACK_FILE_NAME>" de la lista resourcePacks
// de options.txt, el mismo mecanismo que ya usa applyFullscreenOption en
// core/launcher.js para la opción de pantalla completa. Se agrega al FINAL
// de la lista (mayor prioridad — los últimos pisan a los primeros) para que
// gane por sobre cualquier otro resource pack que ya tuviera puesto el
// jugador, incluidos los que vengan con un modpack.
function setResourcePackEnabled(instanceDir, enabled) {
  const optionsPath = path.join(instanceDir, 'options.txt');
  let lines = [];
  if (fs.existsSync(optionsPath)) {
    lines = fs.readFileSync(optionsPath, 'utf-8').split('\n').filter(Boolean);
  } else if (!enabled) {
    return; // nada que sacar si el archivo ni existe todavía
  }

  const entry = `file/${PACK_FILE_NAME}`;
  const idx = lines.findIndex((l) => l.startsWith('resourcePacks:'));
  let list = [];
  if (idx !== -1) {
    try {
      list = JSON.parse(lines[idx].slice('resourcePacks:'.length));
    } catch {
      list = [];
    }
  }
  list = list.filter((p) => p !== entry);
  if (enabled) list.push(entry);

  const newLine = `resourcePacks:${JSON.stringify(list)}`;
  if (idx === -1) {
    if (enabled) lines.push(newLine);
  } else {
    lines[idx] = newLine;
  }
  fs.writeFileSync(optionsPath, lines.join('\n') + '\n');
}

/**
 * Se llama en cada lanzamiento, antes de arrancar el proceso de Java (ver
 * core/launcher.js). Genera/actualiza (o saca, según corresponda) el
 * resource pack local con la skin subida a mano — cuentas premium no
 * tocan nada acá (ya se ven bien solas, ver el comentario grande de
 * arriba), y una cuenta no-premium sin ninguna skin subida (skinUrl vacía,
 * o una URL externa tipo Ely.by en vez de un archivo local: no hay bytes
 * de imagen para empaquetar sin salir a la red primero, así que se deja
 * sin tocar) tampoco genera nada — y si ANTES tenía una y se sacó, esto
 * limpia el pack viejo para no dejar una referencia rota en options.txt.
 */
function applyLocalSkin(instance, account) {
  const resourcepacksDir = path.join(instance.dir, 'resourcepacks');
  const packPath = path.join(resourcepacksDir, PACK_FILE_NAME);

  const buffer = account && account.type !== 'premium' ? dataUrlToBuffer(account.skinUrl) : null;

  if (!buffer) {
    removeIfExists(packPath);
    setResourcePackEnabled(instance.dir, false);
    return;
  }

  fs.mkdirSync(resourcepacksDir, { recursive: true });

  const zip = new AdmZip();
  const meta = {
    pack: {
      pack_format: resolvePackFormat(instance.mcVersion),
      description: 'Hard Launcher - tu skin (solo la ves vos)',
    },
  };
  zip.addFile('pack.mcmeta', Buffer.from(JSON.stringify(meta)));
  for (const texturePath of skinTargetPaths()) {
    zip.addFile(texturePath, buffer);
  }
  zip.writeZip(packPath);

  setResourcePackEnabled(instance.dir, true);
}

module.exports = { applyLocalSkin };
