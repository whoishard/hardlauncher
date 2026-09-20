// Resaltado de sintaxis liviano para el editor de texto integrado
// (ver TextFileEditor.jsx). No es un parser real por lenguaje — es un
// tokenizador por regex de una sola pasada que cubre los formatos que de
// verdad aparecen adentro de una instancia (json/json5, yaml, toml,
// properties/ini/cfg, xml/mcmeta, logs, texto plano). La idea es que el
// editor "hable el mismo idioma visual" que ya usa la Consola para las
// líneas del juego (ver detectLevel en ConsoleView.jsx): mismo rojo para
// error, mismo amarillo para warning, mismo acento para las líneas propias
// del launcher — así un log abierto desde Archivos se lee igual que la
// consola en vivo, y un config (json/toml/properties) se lee con sus
// claves, strings, números y comentarios diferenciados de un vistazo.

const LOG_EXTENSIONS = new Set(['log']);

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Mismo criterio que ConsoleView.detectLevel, pero acá se aplica línea por
// línea sobre el contenido ya guardado de un archivo (no sobre la salida en
// vivo del proceso del juego).
function detectLineLevel(line) {
  const l = line.toLowerCase();
  if (l.includes('[hard launcher]')) return 'launcher';
  if (l.includes('/error') || l.includes('[error]') || l.includes('exception') || l.includes('severe') || l.includes('fatal'))
    return 'error';
  if (l.includes('/warn') || l.includes('[warn]') || l.includes('warning')) return 'warn';
  return null;
}

// Un único regex con grupos nombrados en vez de varios reemplazos
// encadenados: así cada carácter del archivo cae en como mucho un token, sin
// que un reemplazo posterior pise el HTML que ya generó uno anterior (el
// problema clásico de resaltar con .replace() en cadena sobre strings que
// pueden contener las mismas comillas o símbolos que ya se resaltaron).
const TOKEN_RE = new RegExp(
  [
    /(?<comment>\/\/[^\n]*|#[^\n]*|;[^\n]*)/,
    /(?<xmlcomment><!--[\s\S]*?-->)/,
    /(?<string>"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*')/,
    /(?<tag><\/?[A-Za-z][\w:.-]*(?:\s+[\w:.-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*\s*\/?>)/,
    /(?<section>^[ \t]*\[[^\]\n]+\]\s*$)/,
    /(?<number>-?\b\d+(?:\.\d+)?\b)/,
    /(?<bool>\b(?:true|false|null|yes|no)\b)/,
    /(?<key>[A-Za-z_][\w .-]*(?=\s*[:=]))/,
    /(?<punct>[{}[\],:])/,
  ]
    .map((r) => r.source)
    .join('|'),
  'gm'
);

const CLASS_BY_GROUP = {
  comment: 'hl-comment',
  xmlcomment: 'hl-comment',
  string: 'hl-string',
  tag: 'hl-tag',
  section: 'hl-section',
  number: 'hl-number',
  bool: 'hl-bool',
  key: 'hl-key',
  punct: 'hl-punct',
};

/** Tokeniza una porción de texto (una línea o el archivo entero) y devuelve HTML ya escapado. */
function highlightTokens(text) {
  let out = '';
  let last = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(text))) {
    if (m.index > last) out += escapeHtml(text.slice(last, m.index));
    const groupName = Object.keys(m.groups).find((g) => m.groups[g] !== undefined);
    out += `<span class="${CLASS_BY_GROUP[groupName]}">${escapeHtml(m[0])}</span>`;
    last = m.index + m[0].length;
    if (m[0].length === 0) TOKEN_RE.lastIndex += 1; // por si algún grupo llegara a matchear vacío
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/**
 * Devuelve el HTML final para el <pre> de resaltado que vive detrás del
 * textarea real (ver TextFileEditor.jsx). Además de colorear tokens, si el
 * archivo tiene cara de log (extensión .log, o aparecen líneas con
 * ERROR/WARN reconocibles como las que ya entiende la Consola) tiñe cada
 * línea completa con el mismo fondo que usa .console-line, para que un
 * crash-report o un log abierto desde Archivos se identifique igual de
 * rápido que en la pestaña Consola.
 */
export function highlightFile(content, ext) {
  const lines = content.split('\n');
  const looksLikeLog = LOG_EXTENSIONS.has(ext) || lines.some((l) => detectLineLevel(l));
  if (!looksLikeLog) return highlightTokens(content);

  return lines
    .map((line) => {
      const level = detectLineLevel(line);
      const inner = highlightTokens(line);
      return level ? `<span class="hl-line hl-line-${level}">${inner}</span>` : inner;
    })
    .join('\n');
}
