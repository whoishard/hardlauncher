const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Writable } = require('stream');
const { pipeline } = require('stream/promises');

/**
 * Lector de .zip por streaming, sin dependencias.
 *
 * Por qué existe: adm-zip carga el .zip ENTERO en memoria y descomprime
 * cada archivo completo a un Buffer. Con modpacks grandes (mundos, mods
 * incluidos en overrides/, archivos de varios cientos de MB) eso revienta con
 * "RangeError: Array buffer allocation failed". Acá solo se lee el
 * directorio central (chico) y cada archivo se descomprime directo de
 * disco a disco con streams, sin importar su tamaño. Soporta zip64.
 */

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

function readAt(fd, position, length) {
  const buf = Buffer.alloc(length);
  let done = 0;
  while (done < length) {
    const n = fs.readSync(fd, buf, done, length - done, position + done);
    if (n === 0) break;
    done += n;
  }
  if (done < length) throw new Error('El archivo .zip está incompleto o dañado.');
  return buf;
}

const u64 = (buf, offset) => Number(buf.readBigUInt64LE(offset));

function parseEntries(cd, total) {
  const entries = [];
  let pos = 0;
  for (let i = 0; i < total; i++) {
    if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error('El directorio del .zip está dañado.');
    }
    const flags = cd.readUInt16LE(pos + 8);
    const method = cd.readUInt16LE(pos + 10);
    let compressedSize = cd.readUInt32LE(pos + 20);
    let size = cd.readUInt32LE(pos + 24);
    const nameLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const commentLen = cd.readUInt16LE(pos + 32);
    let offset = cd.readUInt32LE(pos + 42);
    const name = cd.toString('utf8', pos + 46, pos + 46 + nameLen).replace(/\\/g, '/');

    // Campo extra zip64 (id 0x0001): trae, en este orden, SOLO los valores
    // que en la cabecera normal valen 0xFFFFFFFF.
    let ex = pos + 46 + nameLen;
    const exEnd = ex + extraLen;
    while (ex + 4 <= exEnd) {
      const id = cd.readUInt16LE(ex);
      const len = cd.readUInt16LE(ex + 2);
      if (id === 0x0001) {
        let p = ex + 4;
        if (size === 0xffffffff) { size = u64(cd, p); p += 8; }
        if (compressedSize === 0xffffffff) { compressedSize = u64(cd, p); p += 8; }
        if (offset === 0xffffffff) { offset = u64(cd, p); }
      }
      ex += 4 + len;
    }

    entries.push({ name, isDirectory: name.endsWith('/'), method, flags, compressedSize, size, offset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Abre un .zip y devuelve { entries, readBuffer, extractTo }. Lanza si no es un zip válido. */
function openZip(zipPath) {
  const fd = fs.openSync(zipPath, 'r');
  let entries;
  try {
    const fileSize = fs.fstatSync(fd).size;
    if (fileSize < 22) throw new Error('not-a-zip');

    // El EOCD está en los últimos 22 bytes + el comentario (máx. 65535).
    const tailLen = Math.min(fileSize, 22 + 65535);
    const tail = readAt(fd, fileSize - tailLen, tailLen);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('not-a-zip');

    let total = tail.readUInt16LE(eocd + 10);
    let cdSize = tail.readUInt32LE(eocd + 12);
    let cdOffset = tail.readUInt32LE(eocd + 16);

    if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
      const locatorPos = fileSize - tailLen + eocd - 20;
      const locator = readAt(fd, locatorPos, 20);
      if (locator.readUInt32LE(0) !== SIG_ZIP64_LOCATOR) throw new Error('not-a-zip');
      const z64 = readAt(fd, u64(locator, 8), 56);
      if (z64.readUInt32LE(0) !== SIG_ZIP64_EOCD) throw new Error('not-a-zip');
      total = u64(z64, 32);
      cdSize = u64(z64, 40);
      cdOffset = u64(z64, 48);
    }

    entries = parseEntries(readAt(fd, cdOffset, cdSize), total);
  } catch (err) {
    if (err.message === 'not-a-zip') throw new Error('No se pudo abrir el archivo: no es un .zip válido.');
    throw err;
  } finally {
    // El fd solo se usa para leer el directorio; los datos se leen con
    // streams propios (uno por archivo) para no mantener handles abiertos.
    fs.closeSync(fd);
  }

  /** Stream de los bytes ya descomprimidos de `entry`. */
  function dataStream(entry) {
    if (entry.flags & 1) throw new Error(`"${entry.name}" está cifrado con contraseña; no se puede importar.`);
    if (entry.method !== 0 && entry.method !== 8) {
      throw new Error(`"${entry.name}" usa un método de compresión no soportado (${entry.method}).`);
    }
    const lfd = fs.openSync(zipPath, 'r');
    let dataStart;
    try {
      const local = readAt(lfd, entry.offset, 30);
      if (local.readUInt32LE(0) !== SIG_LOCAL) throw new Error('El .zip está dañado (cabecera local inválida).');
      dataStart = entry.offset + 30 + local.readUInt16LE(26) + local.readUInt16LE(28);
    } finally {
      fs.closeSync(lfd);
    }
    const raw = fs.createReadStream(zipPath, { start: dataStart, end: dataStart + entry.compressedSize - 1 });
    return { raw, inflate: entry.method === 8 ? zlib.createInflateRaw() : null };
  }

  /** Descomprime `entry` directo a `destPath`, en streaming. */
  async function extractTo(entry, destPath) {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    if (entry.compressedSize === 0) {
      fs.writeFileSync(destPath, '');
      return;
    }
    const { raw, inflate } = dataStream(entry);
    const out = fs.createWriteStream(destPath);
    await (inflate ? pipeline(raw, inflate, out) : pipeline(raw, out));
  }

  /** Lee una entrada CHICA (manifiestos) a memoria. Rechaza las grandes a propósito. */
  async function readBuffer(entry, maxBytes = 32 * 1024 * 1024) {
    if (entry.size > maxBytes) throw new Error(`"${entry.name}" es demasiado grande para leerlo en memoria.`);
    if (entry.compressedSize === 0) return Buffer.alloc(0);
    const { raw, inflate } = dataStream(entry);
    const chunks = [];
    const sink = new Writable({ write(chunk, _enc, cb) { chunks.push(chunk); cb(); } });
    await (inflate ? pipeline(raw, inflate, sink) : pipeline(raw, sink));
    return Buffer.concat(chunks);
  }

  return { entries, extractTo, readBuffer };
}

module.exports = { openZip };
