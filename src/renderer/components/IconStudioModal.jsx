import React, { useRef, useState } from 'react';
import { motion } from 'framer-motion';
import Icon from './Icon.jsx';
import { useT } from '../i18n.js';
import { LoaderGlyph, LOADER_BADGES } from './InstanceIcon.jsx';
import {
  BACKGROUND_SWATCHES,
  ICON_SHAPES,
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

// Dibuja una de las formas de ICON_SHAPES (o el cubito default cuando no
// hay ninguna elegida) — se usa tanto en la grilla de selección como en el
// preview grande, siempre con la misma sombrita apoyada que termina en el
// PNG final (ver composeIconDataUrl en iconStudioData.js), para que lo que
// se ve acá en vivo sea igual a lo que se va a guardar.
function ShapeGlyph({ shape, size = 26 }) {
  const s = SHADOW_ELLIPSE;
  return (
    <svg width={size} height={size} viewBox="0 0 16 16">
      {shape && <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill="#000" opacity={s.opacity} />}
      {shape?.faces
        ? shape.faces.map((f, i) => <path key={i} d={f.d} fill="#fff" opacity={f.opacity} />)
        : shape && <path d={shape.d} fill="#fff" opacity={0.92} />}
    </svg>
  );
}

/**
 * Editor de íconos para instancias: elegís un color de fondo y (opcional)
 * una forma simple para el cubito de la instancia — cubo, rombo, círculo,
 * etc., ver ICON_SHAPES en iconStudioData.js — o subís tu propia imagen.
 * Lo que sea que se elija termina renderizado a un PNG cuadrado y se
 * guarda en `icon` como un data URL, exactamente igual que una imagen
 * subida a mano, así que el resto de la app (InstanceIcon, el store, etc.)
 * no necesita saber que existe esto.
 *
 * (Se probó antes una versión con una biblioteca de símbolos estilo voxel
 * —ítems, bloques y criaturas— para combinar con el fondo, pero se sacó:
 * las formas de acá son genéricas, sin ninguna referencia a un objeto,
 * bloque o criatura del juego.)
 */
export default function IconStudioModal({ name, loader, value, onChange, onClose }) {
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
  const [shapeId, setShapeId] = useState(null);
  const [uploaded, setUploaded] = useState(value || null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);

  const badge = LOADER_BADGES[loader];
  const activeShape = ICON_SHAPES.find((s) => s.id === shapeId) || null;

  function randomize() {
    const useShape = Math.random() > 0.15; // a veces queda solo el fondo, como el "randomize" de Modrinth
    setBg(BACKGROUND_SWATCHES[Math.floor(Math.random() * BACKGROUND_SWATCHES.length)]);
    setShapeId(useShape ? ICON_SHAPES[Math.floor(Math.random() * ICON_SHAPES.length)].id : null);
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
      const dataUrl = await composeIconDataUrl(bg, shapeId);
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
          <div
            className="icon-studio-preview"
            style={{
              background:
                tab === 'studio'
                  ? `linear-gradient(135deg, ${shade(bg, 16)}, ${shade(bg, -8)})`
                  : '#2c2e33',
            }}
          >
            {tab === 'studio' ? (
              activeShape ? (
                <ShapeGlyph shape={activeShape} size={44} />
              ) : (
                <Icon name="package" size={30} strokeWidth={1.6} />
              )
            ) : uploaded ? (
              <img src={uploaded} alt="" className="icon-studio-preview-img" />
            ) : (
              <Icon name="image" size={30} strokeWidth={1.5} />
            )}
            {badge && (
              <span className="instance-icon-badge" style={{ background: badge.color, width: 22, height: 22 }}>
                <LoaderGlyph glyph={badge.glyph} size={15} />
              </span>
            )}
          </div>
          <div className="icon-studio-preview-info">
            <div className="icon-picker-title">{name || t('instances.new')}</div>
            {tab === 'studio' && (
              <button type="button" className="btn-secondary btn-icon-label" onClick={randomize}>
                <Icon name="dice" size={13} />
                {t('iconStudio.random')}
              </button>
            )}
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

            <div className="modal-section-label">{t('iconStudio.shape')}</div>
            <div className="symbol-grid">
              <button
                type="button"
                className={'symbol-tile' + (shapeId === null ? ' active' : '')}
                onClick={() => setShapeId(null)}
                title={t('iconStudio.noShape')}
              >
                <Icon name="close" size={16} />
              </button>
              {ICON_SHAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={'symbol-tile' + (shapeId === s.id ? ' active' : '')}
                  onClick={() => setShapeId(s.id)}
                  title={s.label}
                >
                  <ShapeGlyph shape={s} size={26} />
                </button>
              ))}
            </div>
          </>
        ) : (
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
