const net = require('net');

// Implementación del protocolo "Server List Ping" de Minecraft (el mismo
// que usa el propio launcher oficial para mostrar el ícono/MOTD/jugadores
// en la lista de servidores multijugador). Es un protocolo público y
// documentado (wiki.vg/Server_List_Ping) — acá se implementa desde cero
// sobre un socket TCP crudo, sin ninguna librería de terceros.
//
// Handshake (state=1, "Status") + Status Request -> el servidor responde
// con un JSON (versión, jugadores online/máximo, MOTD, ícono en base64).
// Después, un paquete Ping/Pong con un timestamp propio da el ping real
// (RTT), en vez de aproximarlo con el tiempo que tardó el handshake.

const DEFAULT_PORT = 25565;
const DEFAULT_TIMEOUT_MS = 4000;
// Valor de protocolo "de mentira": en el estado de Status el servidor
// devuelve su propio JSON sin importar qué versión mandes acá — solo se usa
// para decidir si mandarte el mensaje de "versión incompatible" en el
// estado de Login, que nunca llegamos a pedir. Cualquier server moderno lo
// acepta igual.
const FAKE_PROTOCOL_VERSION = 767;

function writeVarInt(value) {
  const bytes = [];
  let v = value;
  do {
    let temp = v & 0b01111111;
    v >>>= 7;
    if (v !== 0) temp |= 0b10000000;
    bytes.push(temp);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function writeVarString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  return Buffer.concat([writeVarInt(strBuf.length), strBuf]);
}

function writeUShort(value) {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return buf;
}

function writeLong(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(value), 0);
  return buf;
}

// Todo paquete del protocolo va precedido de su longitud total como VarInt.
function framePacket(payload) {
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

function buildHandshakePacket(host, port) {
  const body = Buffer.concat([
    writeVarInt(0x00), // packet id: Handshake
    writeVarInt(FAKE_PROTOCOL_VERSION),
    writeVarString(host),
    writeUShort(port),
    writeVarInt(1), // next state: 1 = Status
  ]);
  return framePacket(body);
}

function buildStatusRequestPacket() {
  return framePacket(writeVarInt(0x00)); // packet id 0x00, sin cuerpo
}

function buildPingPacket(payload) {
  const body = Buffer.concat([writeVarInt(0x01), writeLong(payload)]);
  return framePacket(body);
}

// Lector incremental de VarInt sobre un buffer acumulado: devuelve
// { value, bytesRead } o null si todavía no llegaron suficientes bytes.
function tryReadVarInt(buf, offset) {
  let value = 0;
  let position = 0;
  let currentOffset = offset;
  while (true) {
    if (currentOffset >= buf.length) return null; // faltan bytes, esperar más datos
    const byte = buf[currentOffset];
    currentOffset += 1;
    value |= (byte & 0b01111111) << position;
    if ((byte & 0b10000000) === 0) break;
    position += 7;
    if (position >= 32) throw new Error('VarInt demasiado largo');
  }
  return { value, bytesRead: currentOffset - offset };
}

// Colores clásicos de Minecraft (formato "legacy", códigos "§x") — el MOTD
// de la inmensa mayoría de los servidores todavía los usa, aunque el
// protocolo moderno también permite un "chat component" JSON con color por
// segmento. Se soportan los dos.
const LEGACY_COLORS = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA',
  '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF',
  c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};
const LEGACY_FORMAT_FLAGS = { k: 'obfuscated', l: 'bold', m: 'strikethrough', n: 'underline', o: 'italic' };

function freshStyle(base) {
  return { color: base?.color ?? null, bold: false, italic: false, underline: false, strikethrough: false, obfuscated: false };
}

// Parte un string plano que puede tener códigos "§x" adentro en una lista
// de segmentos {text, color, bold, italic, underline, strikethrough,
// obfuscated}. `baseStyle` es el estilo heredado del chat component que
// contiene este texto (si vino de uno) antes de aplicar ningún código.
function parseLegacySegments(text, baseStyle) {
  const segments = [];
  let style = { ...freshStyle(baseStyle), ...baseStyle };
  let buffer = '';

  function flush() {
    if (buffer) segments.push({ text: buffer, ...style });
    buffer = '';
  }

  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '§' && i + 1 < text.length) {
      const code = text[i + 1].toLowerCase();
      if (code === 'r') {
        flush();
        style = freshStyle();
      } else if (LEGACY_COLORS[code]) {
        flush();
        // Un color nuevo resetea negrita/cursiva/etc, igual que en el
        // juego real — no se "acumulan" formatos entre colores distintos.
        style = { ...freshStyle(), color: LEGACY_COLORS[code] };
      } else if (LEGACY_FORMAT_FLAGS[code]) {
        flush();
        style = { ...style, [LEGACY_FORMAT_FLAGS[code]]: true };
      }
      i += 1; // saltar el caracter del código, ya consumido
    } else {
      buffer += text[i];
    }
  }
  flush();
  return segments;
}

// Convierte el campo "description" de la respuesta (string plano con
// códigos "§x", o un "chat component" anidado {text, color, bold, ...,
// extra:[...]}) en una lista plana de segmentos con su color/formato ya
// resueltos, lista para pintar en la UI sin volver a parsear nada.
function motdToSegments(description, inherited = null) {
  if (description == null) return [];
  if (typeof description === 'string') return parseLegacySegments(description, inherited);

  const style = {
    color: description.color ? (LEGACY_COLORS[description.color] || description.color) : inherited?.color ?? null,
    bold: description.bold ?? inherited?.bold ?? false,
    italic: description.italic ?? inherited?.italic ?? false,
    underline: description.underline ?? inherited?.underline ?? false,
    strikethrough: description.strikethrough ?? inherited?.strikethrough ?? false,
    obfuscated: description.obfuscated ?? inherited?.obfuscated ?? false,
  };

  let segments = [];
  if (typeof description.text === 'string' && description.text) {
    segments = segments.concat(parseLegacySegments(description.text, style));
  }
  if (Array.isArray(description.extra)) {
    for (const part of description.extra) segments = segments.concat(motdToSegments(part, style));
  }
  return segments;
}

function plainTextFromSegments(segments) {
  return segments.map((s) => s.text).join('');
}

/**
 * Consulta el estado de un servidor de Minecraft Java.
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<{online:boolean, motd?:string, players?:{online:number,max:number}, versionName?:string, favicon?:string|null, ping?:number|null, error?:string}>}
 */
function pingServer(host, port = DEFAULT_PORT, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    let recvBuffer = Buffer.alloc(0);
    // 'status' = todavía esperando el paquete de Status Response.
    // 'ping'   = ya lo tenemos, esperando el Pong para calcular el RTT.
    let stage = 'status';
    let pingStartedAt = null;

    function finish(result) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () => {
      // Si ya teníamos el Status Response pero el Pong nunca llegó (algunos
      // servidores no lo contestan), se devuelve igual la info que sí
      // llegó, con ping en null, en vez de reportarlo como caído del todo.
      finish(socket.__pendingStatus ? { ...socket.__pendingStatus, ping: null } : { online: false, error: 'timeout' });
    });
    socket.once('error', (err) => {
      finish(socket.__pendingStatus ? { ...socket.__pendingStatus, ping: null } : { online: false, error: err.code || err.message });
    });

    socket.connect(port, host, () => {
      socket.write(buildHandshakePacket(host, port));
      socket.write(buildStatusRequestPacket());
    });

    socket.on('data', (chunk) => {
      recvBuffer = Buffer.concat([recvBuffer, chunk]);

      // Un socket TCP puede entregar los datos en pedazos que no respetan
      // los límites de paquete — hay que ir consumiendo del buffer
      // acumulado solo cuando ya llegó el paquete completo, y dejar el
      // resto para el próximo 'data'.
      while (true) {
        const lengthField = tryReadVarInt(recvBuffer, 0);
        if (!lengthField) return; // todavía no llegó ni el largo del paquete
        const packetStart = lengthField.bytesRead;
        const packetEnd = packetStart + lengthField.value;
        if (recvBuffer.length < packetEnd) return; // falta el resto del paquete

        const packetIdField = tryReadVarInt(recvBuffer, packetStart);
        const dataStart = packetStart + packetIdField.bytesRead;
        const packetId = packetIdField.value;

        if (stage === 'status' && packetId === 0x00) {
          try {
            const strLenField = tryReadVarInt(recvBuffer, dataStart);
            const jsonStart = dataStart + strLenField.bytesRead;
            const jsonBuf = recvBuffer.subarray(jsonStart, jsonStart + strLenField.value);
            const status = JSON.parse(jsonBuf.toString('utf8'));
            const motdSegments = motdToSegments(status.description);

            stage = 'ping';
            pingStartedAt = process.hrtime.bigint();
            socket.write(buildPingPacket(Date.now()));

            // Guardamos el status ya parseado para usarlo cuando (si)
            // llegue el Pong; si el server no contesta el ping a tiempo,
            // el timeout de arriba igual resuelve con lo que ya tenemos.
            socket.__pendingStatus = {
              online: true,
              motd: motdSegments,
              motdText: plainTextFromSegments(motdSegments),
              players: {
                online: status.players?.online ?? 0,
                max: status.players?.max ?? 0,
              },
              versionName: status.version?.name || null,
              favicon: status.favicon || null,
            };
          } catch (err) {
            finish({ online: false, error: 'bad_response' });
            return;
          }
        } else if (stage === 'ping' && packetId === 0x01) {
          const rttMs = Number(process.hrtime.bigint() - pingStartedAt) / 1e6;
          finish({ ...socket.__pendingStatus, ping: Math.round(rttMs) });
          return;
        }

        recvBuffer = recvBuffer.subarray(packetEnd);
      }
    });
  });
}

module.exports = { pingServer };
