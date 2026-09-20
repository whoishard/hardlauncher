const zlib = require('zlib');

// Escritor mínimo del formato NBT (Named Binary Tag) de Minecraft, solo
// para lo que hace falta acá: generar un "servers.dat" válido (la lista de
// servidores que el juego muestra en la pantalla de Multijugador). No es un
// escritor NBT genérico — soporta únicamente los tipos de tag que aparecen
// en ese archivo (Compound, List, String, Byte), que alcanza y sobra.
//
// Formato real de servers.dat (ver wiki.vg/NBT y wiki.vg/Servers.dat):
// un TAG_Compound raíz sin nombre, con una lista "servers" de TAG_Compound,
// cada uno con al menos "name" (string) e "ip" (string). Todo el archivo va
// comprimido con gzip, igual que los mundos guardados.

const TAG_END = 0x00;
const TAG_BYTE = 0x01;
const TAG_STRING = 0x08;
const TAG_LIST = 0x09;
const TAG_COMPOUND = 0x0a;

function encodeModifiedUtf8(str) {
  // El NBT real usa "Modified UTF-8" (como Java DataOutputStream#writeUTF),
  // que difiere de UTF-8 estándar solo en casos raros (código nulo,
  // caracteres suplementarios). Nombres de servidores e IPs nunca caen en
  // esos casos, así que UTF-8 normal es suficiente acá.
  return Buffer.from(str, 'utf8');
}

function writeString(chunks, str) {
  const strBuf = encodeModifiedUtf8(str);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16BE(strBuf.length, 0);
  chunks.push(lenBuf, strBuf);
}

function writeTagHeader(chunks, type, name) {
  chunks.push(Buffer.from([type]));
  writeString(chunks, name);
}

/**
 * Genera el contenido (sin comprimir) de un servers.dat a partir de una
 * lista de { name, host, port }.
 */
function buildServersNbt(servers) {
  const chunks = [];

  // TAG_Compound raíz, sin nombre.
  writeTagHeader(chunks, TAG_COMPOUND, '');

  // TAG_List "servers" de TAG_Compound.
  writeTagHeader(chunks, TAG_LIST, 'servers');
  chunks.push(Buffer.from([TAG_COMPOUND])); // tipo de los elementos de la lista
  const countBuf = Buffer.alloc(4);
  countBuf.writeInt32BE(servers.length, 0);
  chunks.push(countBuf);

  for (const server of servers) {
    const ip = server.port && server.port !== 25565 ? `${server.host}:${server.port}` : server.host;

    // Cada elemento de la lista es un TAG_Compound "anónimo": sus propios
    // tags internos sí llevan nombre, pero el compound en sí no (no hay
    // header de tipo/nombre para el elemento, la lista ya dice que todos
    // son TAG_Compound).
    writeTagHeader(chunks, TAG_STRING, 'name');
    writeString(chunks, server.name);

    writeTagHeader(chunks, TAG_STRING, 'ip');
    writeString(chunks, ip);

    // acceptTextures=1: acepta el resource pack del server sin preguntar,
    // para que la primera conexión sea fluida (el jugador puede cambiarlo
    // después desde el juego mismo).
    writeTagHeader(chunks, TAG_BYTE, 'acceptTextures');
    chunks.push(Buffer.from([0x01]));

    chunks.push(Buffer.from([TAG_END])); // fin de este compound
  }

  chunks.push(Buffer.from([TAG_END])); // fin del compound raíz

  return Buffer.concat(chunks);
}

/**
 * Devuelve el Buffer final (gzip) de un servers.dat listo para escribir en
 * disco en la carpeta de una instancia.
 */
function buildServersDat(servers) {
  return zlib.gzipSync(buildServersNbt(servers));
}

// --- Lector/escritor NBT genérico ---------------------------------------
//
// Lo de arriba alcanza para CREAR un servers.dat desde cero (instancia
// nueva, lista fija), pero no para agregar un servidor a uno que el
// jugador ya venga usando: ese archivo lo reescribe el juego real y puede
// traer de todo (el ícono del server en base64 como TAG_Byte_Array, más
// tags que Mojang sume en versiones futuras, etc.), no solo
// name/ip/acceptTextures. Si lo leyéramos "a mano" buscando nada más esas
// tres claves y reescribiéramos el archivo entero desde cero, se perdería
// silenciosamente cualquier otro dato de cada server ya guardado (el
// ícono, por ejemplo) — el jugador vería sus servers de siempre pero sin
// ícono la próxima vez que abra el juego.
//
// Para evitar eso, esto de acá es un lector/escritor NBT genérico (soporta
// los 12 tipos de tag reales, no solo los 4 de arriba) que preserva
// CUALQUIER tag desconocido tal cual vino, en vez de descartarlo. Solo se
// necesita entender lo suficiente de "servers"/"name"/"ip" como para poder
// buscar duplicados y agregar una entrada nueva al final de la lista.
const TAG_SHORT = 0x02;
const TAG_INT = 0x03;
const TAG_LONG = 0x04;
const TAG_FLOAT = 0x05;
const TAG_DOUBLE = 0x06;
const TAG_BYTE_ARRAY = 0x07;
const TAG_INT_ARRAY = 0x0b;
const TAG_LONG_ARRAY = 0x0c;

/** Lee un valor (más allá de nombre/tipo, que ya se leyeron aparte) del tipo dado. Devuelve [valor, offsetNuevo]. */
function readPayload(buf, offset, type) {
  switch (type) {
    case TAG_BYTE:
      return [buf.readInt8(offset), offset + 1];
    case TAG_SHORT:
      return [buf.readInt16BE(offset), offset + 2];
    case TAG_INT:
      return [buf.readInt32BE(offset), offset + 4];
    case TAG_LONG:
      return [buf.readBigInt64BE(offset), offset + 8];
    case TAG_FLOAT:
      return [buf.readFloatBE(offset), offset + 4];
    case TAG_DOUBLE:
      return [buf.readDoubleBE(offset), offset + 8];
    case TAG_BYTE_ARRAY: {
      const len = buf.readInt32BE(offset);
      const start = offset + 4;
      return [buf.subarray(start, start + len), start + len];
    }
    case TAG_STRING: {
      const len = buf.readUInt16BE(offset);
      const start = offset + 2;
      return [buf.toString('utf8', start, start + len), start + len];
    }
    case TAG_LIST: {
      const elementType = buf.readUInt8(offset);
      let off = offset + 1;
      const count = buf.readInt32BE(off);
      off += 4;
      const items = [];
      for (let i = 0; i < count; i++) {
        const [value, next] = readPayload(buf, off, elementType);
        items.push(value);
        off = next;
      }
      return [{ __nbtList: true, elementType, items }, off];
    }
    case TAG_COMPOUND: {
      const tags = [];
      let off = offset;
      while (true) {
        const tagType = buf.readUInt8(off);
        off += 1;
        if (tagType === TAG_END) break;
        const [name, afterName] = readPayload(buf, off, TAG_STRING);
        const [value, afterValue] = readPayload(buf, afterName, tagType);
        tags.push({ type: tagType, name, value });
        off = afterValue;
      }
      return [{ __nbtCompound: true, tags }, off];
    }
    case TAG_INT_ARRAY: {
      const len = buf.readInt32BE(offset);
      let off = offset + 4;
      const items = [];
      for (let i = 0; i < len; i++) {
        items.push(buf.readInt32BE(off));
        off += 4;
      }
      return [items, off];
    }
    case TAG_LONG_ARRAY: {
      const len = buf.readInt32BE(offset);
      let off = offset + 4;
      const items = [];
      for (let i = 0; i < len; i++) {
        items.push(buf.readBigInt64BE(off));
        off += 8;
      }
      return [items, off];
    }
    default:
      throw new Error(`Tipo de tag NBT desconocido: 0x${type.toString(16)}`);
  }
}

/** Parsea un servers.dat ya descomprimido (buffer NBT crudo) a { name, tags: rootCompound.tags }. */
function parseServersNbt(buf) {
  const rootType = buf.readUInt8(0);
  const [rootName, afterName] = readPayload(buf, 1, TAG_STRING);
  const [rootValue] = readPayload(buf, afterName, rootType);
  return rootValue; // { __nbtCompound: true, tags: [...] }
}

function writePayload(chunks, type, value) {
  switch (type) {
    case TAG_BYTE: {
      const b = Buffer.alloc(1);
      b.writeInt8(value, 0);
      chunks.push(b);
      break;
    }
    case TAG_SHORT: {
      const b = Buffer.alloc(2);
      b.writeInt16BE(value, 0);
      chunks.push(b);
      break;
    }
    case TAG_INT: {
      const b = Buffer.alloc(4);
      b.writeInt32BE(value, 0);
      chunks.push(b);
      break;
    }
    case TAG_LONG: {
      const b = Buffer.alloc(8);
      b.writeBigInt64BE(BigInt(value), 0);
      chunks.push(b);
      break;
    }
    case TAG_FLOAT: {
      const b = Buffer.alloc(4);
      b.writeFloatBE(value, 0);
      chunks.push(b);
      break;
    }
    case TAG_DOUBLE: {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(value, 0);
      chunks.push(b);
      break;
    }
    case TAG_BYTE_ARRAY: {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(value.length, 0);
      chunks.push(lenBuf, Buffer.from(value));
      break;
    }
    case TAG_STRING:
      writeString(chunks, value);
      break;
    case TAG_LIST: {
      chunks.push(Buffer.from([value.elementType]));
      const countBuf = Buffer.alloc(4);
      countBuf.writeInt32BE(value.items.length, 0);
      chunks.push(countBuf);
      for (const item of value.items) writePayload(chunks, value.elementType, item);
      break;
    }
    case TAG_COMPOUND: {
      for (const tag of value.tags) {
        writeTagHeader(chunks, tag.type, tag.name);
        writePayload(chunks, tag.type, tag.value);
      }
      chunks.push(Buffer.from([TAG_END]));
      break;
    }
    case TAG_INT_ARRAY: {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(value.length, 0);
      chunks.push(lenBuf);
      for (const v of value) {
        const b = Buffer.alloc(4);
        b.writeInt32BE(v, 0);
        chunks.push(b);
      }
      break;
    }
    case TAG_LONG_ARRAY: {
      const lenBuf = Buffer.alloc(4);
      lenBuf.writeInt32BE(value.length, 0);
      chunks.push(lenBuf);
      for (const v of value) {
        const b = Buffer.alloc(8);
        b.writeBigInt64BE(BigInt(v), 0);
        chunks.push(b);
      }
      break;
    }
    default:
      throw new Error(`Tipo de tag NBT desconocido al escribir: 0x${type.toString(16)}`);
  }
}

/** Vuelve a armar el buffer NBT crudo (sin gzip) de un compound raíz devuelto por parseServersNbt. */
function writeServersNbt(rootCompound) {
  const chunks = [];
  writeTagHeader(chunks, TAG_COMPOUND, '');
  writePayload(chunks, TAG_COMPOUND, rootCompound);
  return Buffer.concat(chunks);
}

/**
 * Agrega un servidor { name, host, port } a un servers.dat ya existente
 * (buffer gzip, o null si la instancia todavía no tiene ninguno), sin
 * tocar ninguno de los que ya estaban ahí. Si un server con la misma
 * dirección (mismo "ip") ya está en la lista, no se agrega de nuevo — el
 * botón "agregar a todas las instancias" es idempotente, se puede apretar
 * más de una vez sin duplicar filas en la lista de Multijugador.
 * Devuelve el buffer gzip final para escribir a disco.
 */
function addServerToDat(existingGzipBuffer, server) {
  const ip = server.port && server.port !== 25565 ? `${server.host}:${server.port}` : server.host;

  let root;
  if (existingGzipBuffer) {
    try {
      root = parseServersNbt(zlib.gunzipSync(existingGzipBuffer));
    } catch (err) {
      // servers.dat corrupto o con un formato inesperado: en vez de tirar
      // el error para arriba y que la instancia se quede sin el server
      // nuevo, se arranca de cero (mismo resultado que una instancia sin
      // servers.dat todavía) — perder una lista corrupta es mejor que no
      // poder agregar nada.
      root = null;
    }
  }
  if (!root) {
    root = { __nbtCompound: true, tags: [{ type: TAG_LIST, name: 'servers', value: { __nbtList: true, elementType: TAG_COMPOUND, items: [] } }] };
  }

  let serversTag = root.tags.find((t) => t.name === 'servers' && t.type === TAG_LIST);
  if (!serversTag) {
    serversTag = { type: TAG_LIST, name: 'servers', value: { __nbtList: true, elementType: TAG_COMPOUND, items: [] } };
    root.tags.push(serversTag);
  }

  const alreadyThere = serversTag.value.items.some((entry) => {
    const ipTag = entry.tags.find((t) => t.name === 'ip');
    return ipTag && ipTag.value === ip;
  });
  if (alreadyThere) return { buffer: zlib.gzipSync(writeServersNbt(root)), added: false };

  // Lista vacía (recién creada arriba) sin elementType real todavía: se
  // fuerza a TAG_COMPOUND, que es el único tipo de elemento válido acá.
  serversTag.value.elementType = TAG_COMPOUND;
  serversTag.value.items.push({
    __nbtCompound: true,
    tags: [
      { type: TAG_STRING, name: 'name', value: server.name },
      { type: TAG_STRING, name: 'ip', value: ip },
      { type: TAG_BYTE, name: 'acceptTextures', value: 1 },
    ],
  });

  return { buffer: zlib.gzipSync(writeServersNbt(root)), added: true };
}

/**
 * Versiones genéricas de parseServersNbt/writeServersNbt (mismo código,
 * nombre más claro): sirven para cualquier archivo NBT con compound raíz
 * sin nombre, no solo servers.dat — level.dat de un mundo, por ejemplo
 * (ver src/core/worldNbt.js). Se exportan aparte para no reescribir todo el
 * lector/escritor genérico de arriba una segunda vez.
 */
function parseNbt(buf) {
  return parseServersNbt(buf);
}

function writeNbt(rootCompound) {
  return writeServersNbt(rootCompound);
}

module.exports = {
  buildServersDat,
  addServerToDat,
  parseNbt,
  writeNbt,
  TAG_END,
  TAG_BYTE,
  TAG_SHORT,
  TAG_INT,
  TAG_LONG,
  TAG_FLOAT,
  TAG_DOUBLE,
  TAG_BYTE_ARRAY,
  TAG_STRING,
  TAG_LIST,
  TAG_COMPOUND,
  TAG_INT_ARRAY,
  TAG_LONG_ARRAY,
};
