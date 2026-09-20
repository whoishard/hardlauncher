import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import { useT } from '../i18n.js';
import { LoaderGlyph, LOADER_BADGES } from './InstanceIcon.jsx';
import {
  BACKGROUND_SWATCHES,
  RUBY_COLOR_SWATCHES,
  RUBY_DEFAULT_COLOR,
  RUBY_SHAPE,
  SHADOW_ELLIPSE,
  composeIconDataUrl,
  fileToResizedDataUrl,
  shade,
} from './iconStudioData.js';

// Mismo par overlay+card que el resto de los modales (ver
// CreateInstanceModal.jsx) — copiado acá en vez de importado desde ahí para
// no crear un import circular (CreateInstanceModal → InstanceIconPicker →
// IconStudioModal → CreateInstanceModal).
const modalOverlayMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: 0.22 },
};
const modalCardMotion = {
  initial: { opacity: 0, scale: 0.96, y: 16 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 10 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
};

// Dibuja el rubí (siempre el mismo símbolo, sólo cambia de color) — se usa
// tanto en los swatches de color como en el preview grande, siempre con la
// misma sombrita apoyada y las mismas 3 facetas sombreadas + brillo
// especular que terminan en el PNG final (ver rubySvgParts en
// iconStudioData.js), para que lo que se ve acá en vivo sea igual a lo que
// se va a guardar.
//
// El `size` con el que se llama a este preview (más abajo, dentro de una
// caja de 76px — .icon-studio-preview en theme.css) es la referencia
// "oficial" de qué tan grande se ve el rubí contra su fondo. El PNG final
// tenía otra proporción (el rubí llenaba el cuadro casi entero) y por eso
// se veía "más grande" al guardar comparado con este preview — el fix real
// está del lado del PNG (RUBY_PREVIEW_SCALE en iconStudioData.js, que
// reproduce esta misma proporción tamaño/76).
function RubyGlyph({ color, size = 26 }) {
  const s = SHADOW_ELLIPSE;
  const h = RUBY_SHAPE.highlight;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="#000" opacity={s.opacity} />
      {/* BUG FIX: tapa la costura semi-transparente entre facetas — ver
          mismo fix en rubySvgParts (iconStudioData.js) */}
      <path d={RUBY_SHAPE.outline} fill={shade(color, -10)} />
      {RUBY_SHAPE.facets.map((f, i) => (
        <path key={i} d={f.d} fill={shade(color, f.shade)} />
      ))}
      <ellipse
        cx={h.cx}
        cy={h.cy}
        rx={h.rx}
        ry={h.ry}
        fill={shade(color, 85)}
        opacity={h.opacity}
        transform={`rotate(${h.rotate} ${h.cx} ${h.cy})`}
      />
    </svg>
  );
}

/**
 * Editor de íconos para instancias: elegís un color de fondo y un color
 * para el rubí del cubito de la instancia — el símbolo en sí es siempre el
 * mismo rubí simple y tridimensional (ver RUBY_SHAPE en iconStudioData.js),
 * no hay ningún otro símbolo para elegir — o subís tu propia imagen. Lo que
 * sea que se elija termina renderizado a un PNG cuadrado y se guarda en
 * `icon` como un data URL, exactamente igual que una imagen subida a mano,
 * así que el resto de la app (InstanceIcon, el store, etc.) no necesita
 * saber que existe esto.
 *
 * (Se probaron antes dos variantes con símbolo elegible —una biblioteca de
 * formas genéricas tipo avatar, y antes de eso ítems/bloques/criaturas
 * estilo voxel— y ambas se sacaron: ahora el símbolo del cubito ya no se
 * elige, siempre es el rubí, y lo único configurable son sus dos colores.)
 */
export default function IconStudioModal({ name, loader, value, onChange, onClose, modpackIcon }) {
  const t = useT();
  // BUG FIX: antes, si la instancia ya tenía CUALQUIER ícono (`value`
  // truthy), esto arrancaba directo en la pestaña "Imagen personalizada".
  // El problema es que casi toda instancia tiene un `icon` seteado desde
  // que se crea — randomInstanceIcon le asigna uno generado automáticamente
  // aunque el usuario nunca haya subido nada a mano — así que en la
  // práctica "Editar ícono" desde Ajustes casi siempre caía en la pestaña
  // de subir imagen en vez de abrir el Estudio como el usuario esperaba.
  // Ahora el editor siempre abre en "Estudio" al entrar; el valor actual
  // (subido o autogenerado, es el mismo tipo de data URL en ambos casos) se
  // sigue precargando en `uploaded` de abajo, así que la pestaña "Imagen
  // personalizada" no pierde nada si el usuario se pasa a ella.
  const [tab, setTab] = useState('studio');
  const [bg, setBg] = useState(BACKGROUND_SWATCHES[0]);
  const [rubyColor, setRubyColor] = useState(RUBY_DEFAULT_COLOR);
  const [uploaded, setUploaded] = useState(value || null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const badge = LOADER_BADGES[loader];

  function randomize() {
    setBg(BACKGROUND_SWATCHES[Math.floor(Math.random() * BACKGROUND_SWATCHES.length)]);
    setRubyColor(RUBY_COLOR_SWATCHES[Math.floor(Math.random() * RUBY_COLOR_SWATCHES.length)]);
    setTab('studio');
  }

  async function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      setError(t('icon.needImage'));
      return;
    }
    setError('');
    try {
      const dataUrl = await fileToResizedDataUrl(file);
      setUploaded(dataUrl);
    } catch (e) {
      setError(t('icon.processFail'));
    }
  }

  async function handleSave() {
    setError('');
    if (tab === 'upload') {
      if (!uploaded) {
        setError(t('iconStudio.needUpload'));
        return;
      }
      onChange(uploaded);
      onClose();
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await composeIconDataUrl(bg, rubyColor);
      onChange(dataUrl);
      onClose();
    } catch (e) {
      setError(t('iconStudio.genFail'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div className="modal-overlay" onClick={onClose} {...modalOverlayMotion}>
      <motion.div
        className="card modal-card icon-studio-modal"
        onClick={(e) => e.stopPropagation()}
        {...modalCardMotion}
      >
        <div className="modal-header">
          <div>
            <h3 className="modal-title">{t('iconStudio.title')}</h3>
            <p className="modal-subtitle">{t('iconStudio.subtitle')}</p>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label={t('common.close')}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="pill-tabs">
          <button className={'pill-tab' + (tab === 'studio' ? ' active' : '')} onClick={() => setTab('studio')}>
            <Icon name="palette" size={14} />
            {t('iconStudio.tabStudio')}
          </button>
          <button className={'pill-tab' + (tab === 'upload' ? ' active' : '')} onClick={() => setTab('upload')}>
            <Icon name="image" size={14} />
            {t('iconStudio.tabUpload')}
          </button>
        </div>

        <div className="icon-studio-preview-row">
          <div className="icon-studio-preview">
            {/* BUG FIX: el badge del loader (círculo que "asoma" por la
                esquina, igual que en .instance-icon del resto de la app —
                ver InstanceIcon.jsx) vivía adentro de este mismo div, que
                tiene overflow:hidden para que el fondo/imagen respete el
                border-radius redondeado. Como el badge se posiciona con
                offsets negativos (right/bottom: -3px) a propósito, para
                asomar apenas afuera del cuadradito, ese mismo
                overflow:hidden se lo comía a la mitad — quedaba cortado en
                cuarto de círculo en vez de verse completo (ver captura:
                rubí en el editor de ícono de instancia). Ahora el fondo +
                símbolo van en un wrapper interno propio que es el único con
                overflow:hidden, y el badge queda afuera de ese wrapper
                (pero adentro del contenedor relative de más afuera), así
                puede asomar sin que nada se lo recorte. */}
            <div
              className="icon-studio-preview-surface"
              style={{
                background:
                  tab === 'studio'
                    ? `linear-gradient(135deg, ${shade(bg, 16)}, ${shade(bg, -8)})`
                    : '#2c2e33',
              }}
            >
              {tab === 'studio' ? (
                <RubyGlyph color={rubyColor} size={50} />
              ) : uploaded ? (
                <img src={uploaded} alt="" className="icon-studio-preview-img" />
              ) : (
                <Icon name="image" size={30} strokeWidth={1.5} />
              )}
            </div>
            {badge && (
              <span className="instance-icon-badge" style={{ background: badge.color, width: 22, height: 22 }}>
                <LoaderGlyph glyph={badge.glyph} size={15} />
              </span>
            )}
          </div>
          <div className="icon-studio-preview-info">
            <div className="icon-picker-title">{name || t('instances.new')}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {tab === 'studio' && (
                <button type="button" className="btn-secondary btn-icon-label" onClick={randomize}>
                  <Icon name="dice" size={13} />
                  {t('iconStudio.random')}
                </button>
              )}
              {/* Sólo para instancias creadas desde un modpack (modpackIcon
                  presente, ver instanceStore.createInstance): vuelve directo
                  al ícono original del modpack, pisando lo que sea que el
                  jugador haya puesto encima (estudio o imagen subida). Vive
                  acá, afuera de las pestañas "Estudio"/"Imagen
                  personalizada", porque tiene que estar visible sin importar
                  en cuál de las dos esté parado el jugador — y solo se
                  muestra si el ícono actual de verdad difiere del original,
                  para no ofrecer una acción que no haría nada. */}
              {modpackIcon && value !== modpackIcon && (
                <button
                  type="button"
                  className="btn-secondary btn-icon-label"
                  title={t('iconStudio.removeCustomModpackHint')}
                  onClick={() => {
                    onChange(modpackIcon);
                    onClose();
                  }}
                >
                  <Icon name="trash" size={13} />
                  {t('iconStudio.removeCustomModpack')}
                </button>
              )}
            </div>
          </div>
        </div>

        {tab === 'studio' ? (
          <>
            <div className="modal-section-label">{t('iconStudio.background')}</div>
            <div className="swatch-grid">
              {BACKGROUND_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'swatch' + (bg === c ? ' active' : '')}
                  style={{ background: `linear-gradient(135deg, ${shade(c, 16)}, ${shade(c, -8)})` }}
                  onClick={() => setBg(c)}
                  title={c}
                >
                  {bg === c && <Icon name="check" size={14} />}
                </button>
              ))}
              <label className="swatch swatch-custom" title={t('iconStudio.customColor')}>
                <Icon name="palette" size={14} />
                <input
                  type="color"
                  value={bg}
                  onChange={(e) => setBg(e.target.value)}
                  style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                />
              </label>
            </div>

            <div className="modal-section-label">{t('iconStudio.rubyColor')}</div>
            <div className="swatch-grid">
              {RUBY_COLOR_SWATCHES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={'swatch' + (rubyColor === c ? ' active' : '')}
                  style={{ background: `linear-gradient(135deg, ${shade(c, 16)}, ${shade(c, -8)})` }}
                  onClick={() => setRubyColor(c)}
                  title={c}
                >
                  {rubyColor === c && <Icon name="check" size={14} />}
                </button>
              ))}
              <label className="swatch swatch-custom" title={t('iconStudio.customColor')}>
                <Icon name="palette" size={14} />
                <input
                  type="color"
                  value={rubyColor}
                  onChange={(e) => setRubyColor(e.target.value)}
                  style={{ opacity: 0, position: 'absolute', inset: 0, cursor: 'pointer' }}
                />
              </label>
            </div>
          </>
        ) : (
          <>
            <div
              className={'icon-studio-dropzone' + (dragOver ? ' drag-over' : '')}
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                handleFile(e.dataTransfer.files?.[0]);
              }}
            >
              <Icon name="upload" size={22} strokeWidth={1.5} />
              <div className="icon-picker-title">{uploaded ? t('iconStudio.changeImage') : t('iconStudio.dropHint')}</div>
              <div className="icon-picker-hint">{t('iconStudio.dropFormats')}</div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={(e) => handleFile(e.target.files?.[0])}
              />
            </div>
            {/* El botón de quitar ícono vive acá adentro, no en el header
                general del modal: sólo tiene sentido cuando lo que hay
                puesto es justo una imagen subida a mano (pestaña "Imagen
                personalizada" con algo ya cargado en `uploaded`). En la
                pestaña "Estudio" no aplica — ahí lo que corresponde es
                cambiar de color/símbolo, no "quitar" nada.

                BUG FIX: antes esto ponía `onChange(null)`, así que la
                instancia se quedaba con el cuadradito gris genérico
                (glifo de caja default de InstanceIcon.jsx) hasta que el
                usuario volviera a entrar al Estudio a mano. Ahora en vez
                de vaciar el ícono, "Quitar" genera uno nuevo al azar con
                la misma paleta que el botón "Aleatorio" de la pestaña
                Estudio (ver randomize() más arriba) y lo aplica al toque
                — reemplaza directo la imagen personalizada vieja, nunca
                queda ningún rastro de ella (no hay archivo en disco que
                borrar: el ícono viejo y el nuevo son sólo data URLs en
                memoria/store, ver comentario arriba de este componente).

                Esto es el "quitar genérico" (a un ícono aleatorio nuevo),
                válido para cualquier instancia. El botón para volver
                puntualmente al ícono original del modpack es otro,
                separado, más abajo (removeModpackIcon) — vive afuera de
                este bloque tab==='upload' porque tiene que verse sin
                importar en qué pestaña esté el jugador parado. */}
            {uploaded && (
              <button
                type="button"
                className="btn-danger btn-icon-label"
                style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
                disabled={busy}
                onClick={async () => {
                  setError('');
                  setBusy(true);
                  try {
                    const newBg = BACKGROUND_SWATCHES[Math.floor(Math.random() * BACKGROUND_SWATCHES.length)];
                    const newRubyColor = RUBY_COLOR_SWATCHES[Math.floor(Math.random() * RUBY_COLOR_SWATCHES.length)];
                    const dataUrl = await composeIconDataUrl(newBg, newRubyColor);
                    onChange(dataUrl);
                    onClose();
                  } catch (e) {
                    setError(t('iconStudio.genFail'));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Icon name="trash" size={13} />
                {t('common.remove')}
              </button>
            )}
          </>
        )}

        {error && <div className="instance-form-error" style={{ marginTop: 14 }}>{error}</div>}

        <div className="icon-studio-footer">
          <button className="btn-secondary btn-icon-label" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary btn-icon-label" onClick={handleSave} disabled={busy}>
            <Icon name="check" size={14} />
            {busy ? t('iconStudio.generating') : t('iconStudio.useIcon')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
