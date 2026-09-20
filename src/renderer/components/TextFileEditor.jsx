import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useT } from '../i18n.js';
import { highlightFile } from '../utils/syntaxHighlight.js';

// Coincide con el tab-size:2 que ya tenía el textarea (ver theme.css) — así
// Tab inserta lo mismo que la fuente monoespaciada ya venía mostrando.
const INDENT = '  ';

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Todas las posiciones donde aparece `query` dentro de `text`. */
function findMatches(text, query, caseSensitive) {
  if (!query) return [];
  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? query : query.toLowerCase();
  const matches = [];
  let from = 0;
  let idx = hay.indexOf(needle, from);
  while (idx !== -1) {
    matches.push(idx);
    from = idx + needle.length;
    idx = hay.indexOf(needle, from);
  }
  return matches;
}

/**
 * Editor de texto integrado que usa la pestaña Archivos (ver FilesTab en
 * InstanceDetailView.jsx) para tocar configs de la instancia sin salir del
 * launcher. Vive como componente aparte porque terminó necesitando bastante
 * estado propio (buscar/reemplazar, numeración de líneas, pantalla
 * completa) que no tenía sentido mezclar con el estado del explorador de
 * archivos.
 *
 * El componente es "tonto" respecto a la persistencia: quien lo usa le pasa
 * el archivo actual y qué hacer al cambiar/guardar/cerrar; todo el IPC con
 * el proceso principal (leer/escribir el archivo real) sigue viviendo en
 * FilesTab, que es quien conoce instanceId y las rutas.
 */
export default function TextFileEditor({ file, onChange, onSave, onClose }) {
  const t = useT();
  const textareaRef = useRef(null);
  const gutterRef = useRef(null);
  const highlightRef = useRef(null);
  const searchInputRef = useRef(null);

  const [wordWrap, setWordWrap] = useState(false);
  // Arranca directo en pantalla completa (antes había que tocar el botón
  // de maximizar cada vez que se abría un archivo) — se sigue pudiendo
  // salir con el mismo botón/ícono de la barra de herramientas.
  const [fullscreen, setFullscreen] = useState(true);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [search, setSearch] = useState({ open: false, query: '', caseSensitive: false, showReplace: false });
  const [replaceValue, setReplaceValue] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);

  const content = file.content || '';

  // Al abrir un archivo distinto se resetea todo el estado que es propio de
  // la sesión de edición (no tendría sentido, por ejemplo, dejar la
  // búsqueda abierta con texto que aplicaba al archivo anterior).
  useEffect(() => {
    setSearch({ open: false, query: '', caseSensitive: false, showReplace: false });
    setReplaceValue('');
    setActiveMatch(0);
    setConfirmDiscard(false);
    setCursor({ line: 1, col: 1 });
  }, [file.path]);

  const lines = useMemo(() => content.split('\n'), [content]);
  const lineCount = lines.length;
  const charCount = content.length;

  // Extensión del archivo (sin el punto), usada para decidir cómo colorear
  // el contenido — ver highlightFile en utils/syntaxHighlight.js. Se
  // recalcula solo si cambia el nombre, no en cada tecleo.
  const fileExt = useMemo(() => {
    const name = file.name || '';
    return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  }, [file.name]);

  const highlightedHtml = useMemo(() => highlightFile(content, fileExt), [content, fileExt]);

  const matches = useMemo(
    () => findMatches(content, search.query, search.caseSensitive),
    [content, search.query, search.caseSensitive]
  );

  // Si el archivo cambió y el índice activo quedó fuera de rango (por
  // ejemplo tras un reemplazo que redujo la cantidad de coincidencias), lo
  // volvemos a acomodar en vez de dejarlo apuntando a nada.
  useEffect(() => {
    if (matches.length === 0) {
      if (activeMatch !== 0) setActiveMatch(0);
      return;
    }
    if (activeMatch >= matches.length) setActiveMatch(0);
  }, [matches, activeMatch]);

  // Refleja la coincidencia activa como selección de texto (sin robarle el
  // foco al input de búsqueda, para poder seguir escribiendo/tipeando la
  // consulta sin interrupciones) y la centra en el viewport del textarea.
  useEffect(() => {
    if (!search.open || matches.length === 0 || !textareaRef.current) return;
    const pos = matches[activeMatch];
    if (pos == null) return;
    const el = textareaRef.current;
    el.setSelectionRange(pos, pos + search.query.length);
    const before = content.slice(0, pos);
    const lineIndex = before.split('\n').length - 1;
    const approxLineHeight = el.scrollHeight / Math.max(lineCount, 1);
    el.scrollTop = Math.max(0, approxLineHeight * lineIndex - el.clientHeight / 2);
    syncGutterScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMatch, matches, search.open]);

  function syncGutterScroll() {
    if (gutterRef.current && textareaRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
    // La capa de color (.files-editor-highlight) vive detrás del textarea
    // real con position:absolute e inset:0, así que solo ella se scrollea
    // sola — hay que empujarla a mano cada vez que se mueve el textarea de
    // arriba, tanto vertical como horizontalmente (con word-wrap off el
    // textarea también scrollea de costado).
    if (highlightRef.current && textareaRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  }

  function updateCursorFromTextarea() {
    const el = textareaRef.current;
    if (!el) return;
    const before = el.value.slice(0, el.selectionStart);
    const beforeLines = before.split('\n');
    setCursor({ line: beforeLines.length, col: beforeLines[beforeLines.length - 1].length + 1 });
  }

  function requestClose() {
    if (file.dirty && !file.saving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  function openSearch(withReplace) {
    setSearch((s) => ({ ...s, open: true, showReplace: s.showReplace || withReplace }));
    requestAnimationFrame(() => searchInputRef.current?.focus());
  }

  function closeSearch() {
    setSearch((s) => ({ ...s, open: false }));
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function goToMatch(delta) {
    if (matches.length === 0) return;
    setActiveMatch((i) => (i + delta + matches.length) % matches.length);
  }

  function replaceCurrent() {
    if (matches.length === 0) return;
    const pos = matches[activeMatch];
    const next = content.slice(0, pos) + replaceValue + content.slice(pos + search.query.length);
    onChange(next);
  }

  function replaceAll() {
    if (!search.query) return;
    const pattern = new RegExp(escapeRegExp(search.query), search.caseSensitive ? 'g' : 'gi');
    onChange(content.replace(pattern, replaceValue));
  }

  // Indentado/desindentado con Tab. Con selección multilínea empuja o
  // recorta todas las líneas tocadas en vez de reemplazar la selección por
  // un único caracter de tabulación, que es lo que hace un textarea nativo
  // y rompe cualquier config con sangría (json, yaml, etc.).
  function indentSelection(dedent) {
    const el = textareaRef.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;

    if (selectionStart === selectionEnd && !dedent) {
      const next = value.slice(0, selectionStart) + INDENT + value.slice(selectionEnd);
      onChange(next);
      const caret = selectionStart + INDENT.length;
      requestAnimationFrame(() => el.setSelectionRange(caret, caret));
      return;
    }

    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1;
    const nextBreak = value.indexOf('\n', selectionEnd);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(lineStart, lineEnd).split('\n');

    let firstLineDelta = 0;
    let totalDelta = 0;
    const changed = block.map((line, i) => {
      if (dedent) {
        let removed = 0;
        let trimmed = line;
        if (line.startsWith(INDENT)) removed = INDENT.length;
        else if (line.startsWith(' ')) removed = 1;
        else if (line.startsWith('\t')) removed = 1;
        trimmed = line.slice(removed);
        if (i === 0) firstLineDelta = -removed;
        totalDelta -= removed;
        return trimmed;
      }
      if (i === 0) firstLineDelta = INDENT.length;
      totalDelta += INDENT.length;
      return INDENT + line;
    });

    const next = value.slice(0, lineStart) + changed.join('\n') + value.slice(lineEnd);
    onChange(next);
    const newStart = Math.max(lineStart, selectionStart + firstLineDelta);
    const newEnd = Math.max(newStart, selectionEnd + totalDelta);
    requestAnimationFrame(() => el.setSelectionRange(newStart, newEnd));
  }

  function handleTextareaKeyDown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      indentSelection(e.shiftKey);
    }
  }

  // Atajos globales del editor: funcionan sin importar qué elemento tenga
  // el foco (textarea, input de búsqueda, botones de la barra), igual que
  // ya se hacía para el visor de capturas más abajo en este mismo archivo
  // (Escape para cerrar el lightbox).
  useEffect(() => {
    function onKeyDown(e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (file.dirty && !file.saving && !file.loading) onSave();
        return;
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch(false);
        return;
      }
      if (e.key === 'Escape') {
        if (confirmDiscard) return;
        if (search.open) {
          e.preventDefault();
          closeSearch();
          return;
        }
        e.preventDefault();
        requestClose();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.dirty, file.saving, file.loading, search.open, confirmDiscard]);

  const matchLabel = search.query
    ? matches.length
      ? t('files.editor.matchCount', { current: activeMatch + 1, total: matches.length })
      : t('files.editor.noMatches')
    : '';

  return (
    <>
      <div className="modal-overlay" onClick={() => !file.saving && requestClose()}>
        <div
          className={`card modal-card files-editor-modal-card${fullscreen ? ' fullscreen' : ''}`}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-header">
            <div>
              <h3 className="modal-title">{file.name}</h3>
              <p className="modal-subtitle">{file.dirty ? t('files.unsavedChanges') : file.path}</p>
            </div>
            <button className="modal-close-btn" onClick={requestClose} aria-label={t('common.close')}>
              <Icon name="close" size={16} />
            </button>
          </div>

          {file.loading ? (
            <p style={{ color: 'var(--text-secondary)' }}>{t('files.loading')}</p>
          ) : (
            <>
              <div className="files-editor-toolbar">
                <button
                  type="button"
                  className={`files-editor-toolbar-btn${search.open ? ' active' : ''}`}
                  onClick={() => (search.open ? closeSearch() : openSearch(false))}
                  title={t('files.editor.search')}
                >
                  <Icon name="search" size={13} />
                  {t('files.editor.search')}
                </button>
                <button
                  type="button"
                  className={`files-editor-toolbar-btn${wordWrap ? ' active' : ''}`}
                  onClick={() => setWordWrap((w) => !w)}
                  title={t('files.editor.wordWrap')}
                >
                  <Icon name="wrapText" size={13} />
                  {t('files.editor.wordWrap')}
                </button>
                <div className="files-editor-toolbar-spacer" />
                <button
                  type="button"
                  className="files-editor-icon-btn"
                  onClick={() => setFullscreen((f) => !f)}
                  title={fullscreen ? t('files.editor.exitFullscreen') : t('files.editor.fullscreen')}
                >
                  <Icon name={fullscreen ? 'minimize2' : 'maximize'} size={14} />
                </button>
              </div>

              {search.open && (
                <div className="files-editor-searchbar">
                  <Icon name="search" size={14} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                  <input
                    ref={searchInputRef}
                    value={search.query}
                    placeholder={t('files.editor.searchPlaceholder')}
                    onChange={(e) => {
                      const query = e.target.value;
                      setSearch((s) => ({ ...s, query }));
                      setActiveMatch(0);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        goToMatch(e.shiftKey ? -1 : 1);
                      }
                    }}
                  />
                  <span className="files-editor-search-count">{matchLabel}</span>
                  <button
                    type="button"
                    className="files-editor-icon-btn"
                    onClick={() => goToMatch(-1)}
                    disabled={matches.length === 0}
                    title={t('files.editor.prevMatch')}
                  >
                    <Icon name="arrowUp" size={13} />
                  </button>
                  <button
                    type="button"
                    className="files-editor-icon-btn"
                    onClick={() => goToMatch(1)}
                    disabled={matches.length === 0}
                    title={t('files.editor.nextMatch')}
                  >
                    <Icon name="arrowDown" size={13} />
                  </button>
                  <button
                    type="button"
                    className={`files-editor-icon-btn${search.caseSensitive ? ' active' : ''}`}
                    onClick={() => setSearch((s) => ({ ...s, caseSensitive: !s.caseSensitive }))}
                    title={t('files.editor.caseSensitive')}
                  >
                    Aa
                  </button>
                  <button
                    type="button"
                    className={`files-editor-icon-btn${search.showReplace ? ' active' : ''}`}
                    onClick={() => setSearch((s) => ({ ...s, showReplace: !s.showReplace }))}
                    title={t('files.editor.replace')}
                  >
                    <Icon name="swap" size={13} />
                  </button>
                  <button
                    type="button"
                    className="files-editor-icon-btn"
                    onClick={closeSearch}
                    title={t('common.close')}
                  >
                    <Icon name="close" size={13} />
                  </button>

                  {search.showReplace && (
                    <div className="files-editor-replace-row">
                      <input
                        value={replaceValue}
                        placeholder={t('files.editor.replacePlaceholder')}
                        onChange={(e) => setReplaceValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            replaceCurrent();
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="files-editor-toolbar-btn"
                        onClick={replaceCurrent}
                        disabled={matches.length === 0}
                      >
                        {t('files.editor.replaceOne')}
                      </button>
                      <button
                        type="button"
                        className="files-editor-toolbar-btn"
                        onClick={replaceAll}
                        disabled={matches.length === 0}
                      >
                        {t('files.editor.replaceAll')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="files-editor-body">
                {!wordWrap && (
                  <div className="files-editor-gutter" ref={gutterRef}>
                    {lines.map((_, i) => (
                      <div className="files-editor-gutter-line" key={i}>
                        {i + 1}
                      </div>
                    ))}
                  </div>
                )}
                <div className="files-editor-code-wrap">
                  {/* Capa de solo lectura detrás del textarea real: mismo
                      tipografía/padding/line-height pixel a pixel (ver
                      .files-editor-highlight en theme.css) para que el texto
                      coloreado quede exactamente debajo de cada caracter
                      real. El textarea de encima sigue siendo el que edita y
                      recibe el foco — este <pre> es puramente decorativo
                      (aria-hidden, sin selección propia). */}
                  <pre
                    ref={highlightRef}
                    className={`files-editor-highlight${wordWrap ? '' : ' no-wrap'}`}
                    aria-hidden="true"
                    dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                  />
                  <textarea
                    ref={textareaRef}
                    className={`files-editor-textarea${wordWrap ? '' : ' no-wrap'}`}
                    spellCheck={false}
                    value={content}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleTextareaKeyDown}
                    onScroll={syncGutterScroll}
                    onSelect={updateCursorFromTextarea}
                    onClick={updateCursorFromTextarea}
                    onKeyUp={updateCursorFromTextarea}
                  />
                </div>
              </div>

              <div className="files-editor-statusbar">
                {file.dirty && <span className="dirty-dot" />}
                <span>{t('files.editor.cursorPos', { line: cursor.line, col: cursor.col })}</span>
                <span>{t('files.editor.lineCount', { n: lineCount })}</span>
                <span>{t('files.editor.charCount', { n: charCount })}</span>
                <div className="files-editor-statusbar-spacer" />
                <span>UTF-8</span>
              </div>
            </>
          )}

          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <button
              className="btn-primary btn-icon-label"
              onClick={onSave}
              disabled={file.loading || file.saving || !file.dirty}
            >
              <Icon name="check" size={14} />
              {file.saving ? t('common.saving') : t('files.save')}
            </button>
            <button className="btn-secondary" onClick={requestClose} disabled={file.saving}>
              {t('common.cancel')}
            </button>
          </div>
        </div>
      </div>

      {confirmDiscard && (
        <div className="modal-overlay" onClick={() => setConfirmDiscard(false)}>
          <div className="card modal-card" style={{ width: 380 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">{t('files.editor.discardTitle')}</h3>
                <p className="modal-subtitle">{t('files.editor.discardBody')}</p>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                className="btn-danger"
                style={{ flex: 1 }}
                onClick={() => {
                  setConfirmDiscard(false);
                  onClose();
                }}
              >
                {t('files.editor.discardConfirm')}
              </button>
              <button className="btn-secondary" style={{ flex: 1 }} onClick={() => setConfirmDiscard(false)}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
