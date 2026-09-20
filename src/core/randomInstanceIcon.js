const iconPalette = require('../shared/iconPalette.json');

/**
 * Ícono default de una instancia nueva: antes, cualquier instancia creada
 * sin pasar por el Estudio de íconos (ver IconStudioModal.jsx) se quedaba
 * con `icon: null` para siempre, es decir, el mismo cuadradito gris con el
 * glifo de caja genérico para TODAS — nada que la distinga de las demás en
 * la grilla de instancias (ver InstanceIcon.jsx). Ahora, si no se especificó
 * un ícono a mano, se genera uno al azar usando exactamente la misma paleta
 * de fondos y de colores de rubí del Estudio (src/shared/iconPalette.json
 * — mismo archivo que usa iconStudioData.js del lado del renderer), así el
 * resultado es indistinguible de un ícono armado a mano con el botón
 * "Aleatorio" del estudio. El símbolo en sí (el rubí, con sus 3 facetas
 * sombreadas + brillo especular) es siempre el mismo — no hay ningún otro
 * símbolo entre los que elegir, en el estudio ni acá — lo único que varía
 * al azar es el color de fondo y el color del rubí.
 *
 * Corre en el proceso principal (instanceStore.createInstance, importación
 * desde otro launcher, instalación de un .mrpack sin ícono de proyecto
 * conocido, etc.), donde no hay <canvas> ni Image() del navegador
 * disponibles — por eso, a diferencia de composeIconDataUrl (que rasteriza
 * a PNG para el ícono elegido a mano en el estudio), acá se devuelve
 * directamente el SVG como data URL. Se ve exactamente igual: el único
 * lugar donde se usa (InstanceIcon.jsx) lo pone como `background-image`
 * de un div, y un SVG ahí se renderiza igual de bien que un PNG.
 */

/** Aclara (percent > 0) u oscurece (percent < 0) un color hex "#rrggbb".
 * Misma fórmula que shade() en iconStudioData.js — se duplica acá (en vez
 * de importarla) porque ese archivo es del lado del renderer y usa sintaxis
 * de módulos ES pensada para Vite, no requireable directo desde Node. */
function shade(hex, percent) {
  const num = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * percent);
  let r = (num >> 16) + amt;
  let g = ((num >> 8) & 0xff) + amt;
  let b = (num & 0xff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Genera un ícono de instancia al azar y lo devuelve como data URL (SVG). */
function randomInstanceIcon() {
  const bg = pick(iconPalette.backgrounds);
  const rubyColor = pick(iconPalette.rubyColors);
  const ruby = iconPalette.ruby;

  const from = shade(bg, 16);
  const to = shade(bg, -8);
  const shadow = { cx: 8, cy: 14.6, rx: 5.4, ry: 1.15, opacity: 0.28 };
  const h = ruby.highlight;
  // Mismo factor que RUBY_PREVIEW_SCALE en iconStudioData.js (44/76, ver
  // comentario ahí) — se duplica acá porque este archivo corre en el
  // proceso principal y no puede importar ese módulo. Sin esto el rubí
  // quedaba llenando el cuadrado entero, mucho más grande que la
  // proporción "con harto fondo alrededor" que se ve en el editor.
  const RUBY_SCALE = 44 / 76;

  const inner = [
    `<ellipse cx="${shadow.cx}" cy="${shadow.cy}" rx="${shadow.rx}" ry="${shadow.ry}" fill="#000" opacity="${shadow.opacity}"/>`,
    `<path d="${ruby.outline}" fill="${shade(rubyColor, -10)}"/>`,
  ];
  for (const f of ruby.facets) {
    inner.push(`<path d="${f.d}" fill="${shade(rubyColor, f.shade)}"/>`);
  }
  inner.push(
    `<ellipse cx="${h.cx}" cy="${h.cy}" rx="${h.rx}" ry="${h.ry}" fill="${shade(rubyColor, 85)}" opacity="${h.opacity}" transform="rotate(${h.rotate} ${h.cx} ${h.cy})"/>`
  );

  const parts = [
    `<defs><linearGradient id="bgg" x1="0" y1="0" x2="16" y2="16">` +
      `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`,
    `<rect width="16" height="16" fill="url(#bgg)"/>`,
    `<g transform="translate(8 8) scale(${RUBY_SCALE}) translate(-8 -8)">${inner.join('')}</g>`,
  ];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">${parts.join('')}</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf-8').toString('base64')}`;
}

module.exports = { randomInstanceIcon };
