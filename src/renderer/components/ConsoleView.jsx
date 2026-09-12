import React, { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import { useT } from '../i18n.js';

function detectLevel(line) {
  const l = line.toLowerCase();
  if (l.includes('[hard launcher]')) return 'launcher';
  if (l.includes('/error') || l.includes('[error]') || l.includes('exception') || l.includes('severe')) return 'error';
  if (l.includes('/warn') || l.includes('[warn]')) return 'warn';
  return 'info';
}

/**
 * Consola del juego. Antes era un único bloque de texto plano (todos los
 * logs pegados con \n dentro de un <div>), sin separación visual entre
 * líneas ni forma de distinguir errores de logs normales, sin poder copiar
 * el contenido y sin auto-scroll — había que arrastrar la barra manualmente
 * cada vez que entraba una línea nueva. Ahora cada línea es su propia fila
 * (con color según nivel), hay auto-scroll opcional, y botones de limpiar
 * y copiar todo el log.
 */
export default function ConsoleView({ lines, running, hasError, onClear }) {
  const t = useT();
  const [autoScroll, setAutoScroll] = useState(true);
  const [copied, setCopied] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [lines, autoScroll]);

  // Si el usuario scrollea manualmente hacia arriba, se desactiva el
  // auto-scroll para que pueda leer tranquilo; si vuelve a bajar del todo,
  // se reactiva solo.
  function handleScroll(e) {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Sin permisos de portapapeles: no rompe la consola por esto.
    }
  }

  return (
    <div className="console-panel">
      <div className="console-toolbar">
        <div className="console-toolbar-status">
          <span className={'console-status-dot' + (hasError ? ' error' : running ? ' running' : '')} />
          {hasError ? t('console.error') : running ? t('console.running') : t('console.idle')}
        </div>
        <div className="console-toolbar-actions">
          <button
            type="button"
            className={'console-toolbar-btn' + (autoScroll ? ' active' : '')}
            onClick={() => setAutoScroll((v) => !v)}
            title={t('console.autoscroll')}
          >
            <Icon name="refresh" size={13} />
            Auto-scroll
          </button>
          <button type="button" className="console-toolbar-btn" onClick={handleCopy} disabled={lines.length === 0}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="8" y="8" width="12" height="12" rx="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {copied ? t('console.copied') : t('console.copy')}
          </button>
          <button type="button" className="console-toolbar-btn" onClick={onClear} disabled={lines.length === 0}>
            <Icon name="trash" size={13} />
            {t('console.clear')}
          </button>
        </div>
      </div>

      <div className="console-view" ref={scrollRef} onScroll={handleScroll}>
        {lines.length === 0 ? (
          <div className="console-empty">
            <Icon name="layers" size={22} />
            {t('console.empty')}
          </div>
        ) : (
          lines.map((line, i) => (
            <div key={i} className={'console-line level-' + detectLevel(line)}>
              <span className="console-line-index">{i + 1}</span>
              <span className="console-line-text">{line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
