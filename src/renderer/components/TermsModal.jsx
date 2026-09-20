import React from 'react';
import { motion } from 'framer-motion';
import { useAppStore } from '../store.js';
import { getTermsContent } from '../termsContent.js';
import { modalOverlayMotion, modalCardMotion } from './CreateInstanceModal.jsx';
import Icon from './Icon.jsx';
import logoMarkRed from '../assets/logo-mark.png';
import logoMarkPurple from '../assets/logo-mark-purple.png';

/**
 * Términos y Condiciones — se muestra en el primer arranque del launcher y
 * de nuevo cada vez que se actualiza a una versión nueva (ver
 * checkTerms()/acceptTerms() en store.js, y termsAcceptedVersion en
 * settingsStore.js del proceso principal).
 *
 * A propósito NO es cerrable clickeando afuera ni con Escape (a diferencia
 * del resto de los modales de la app, ver AccountModal/SettingsModal): no
 * recibe `onClose`, el overlay no tiene onClick, y no hay botón "X". La
 * única forma de avanzar es "Aceptar" (que guarda la versión actual como
 * aceptada) o "Rechazar y salir" (que cierra el launcher del todo) — igual
 * que cualquier EULA de instalación estándar.
 *
 * Presentación: es la PRIMERA pantalla que ve alguien que recién instaló el
 * launcher, así que en vez del modal genérico (título + párrafos sueltos)
 * tiene encabezado propio con el isotipo, cada sección como tarjeta
 * numerada con su ícono, y una casilla de "leí y acepto" que habilita el
 * botón — el patrón de EULA que la gente ya reconoce, y que evita el
 * "aceptar" reflejo sin siquiera haber mirado la pantalla.
 */
export default function TermsModal() {
  const language = useAppStore((s) => s.settings?.language) || 'es';
  const accentColor = useAppStore((s) => s.settings?.accentColor);
  const acceptTerms = useAppStore((s) => s.acceptTerms);
  const [accepting, setAccepting] = React.useState(false);
  const [agreed, setAgreed] = React.useState(false);
  // Sombra/degradé al pie del cuerpo scrolleable: se apaga al llegar abajo
  // para que no quede una franja oscura permanente sobre la última
  // sección cuando ya no hay nada más para leer.
  const [atBottom, setAtBottom] = React.useState(false);
  const content = getTermsContent(language);
  // Mismo criterio que TitleBar/HomeView: el isotipo acompaña el color de
  // acento elegido en Ajustes → Apariencia.
  const logoMark = accentColor === 'purple' ? logoMarkPurple : logoMarkRed;

  function handleScroll(e) {
    const el = e.currentTarget;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 12);
  }

  async function handleAccept() {
    setAccepting(true);
    try {
      await acceptTerms();
    } finally {
      setAccepting(false);
    }
  }

  function handleDecline() {
    // window.close() ya no sirve acá: desde que cerrar con la cruz manda el
    // launcher a la bandeja en vez de salir (ver mainWindow.on('close', ...)
    // en electron/main.js), usar ese mismo canal dejaría el proceso
    // corriendo escondido sin que nadie haya aceptado los Términos. quit()
    // sí cierra el launcher de verdad.
    window.hardLauncher.window.quit();
  }

  return (
    <motion.div className="modal-overlay terms-overlay" {...modalOverlayMotion}>
      <motion.div
        className="card modal-card terms-modal-card"
        onClick={(e) => e.stopPropagation()}
        {...modalCardMotion}
      >
        <div className="terms-hero">
          <div className="terms-hero-logo">
            <img src={logoMark} alt="" />
          </div>
          <div className="terms-hero-text">
            <span className="terms-hero-eyebrow">{content.eyebrow}</span>
            <h2 className="terms-hero-title">{content.title}</h2>
            <p className="terms-hero-intro">{content.intro}</p>
          </div>
        </div>

        <div
          className={'terms-modal-body' + (atBottom ? ' at-bottom' : '')}
          onScroll={handleScroll}
        >
          {content.sections.map((section, i) => (
            <section className="terms-section" key={section.heading}>
              <div className="terms-section-marker">
                <span className="terms-section-number">{i + 1}</span>
                <span className="terms-section-line" />
              </div>
              <div className="terms-section-content">
                <h3>
                  <Icon name={section.icon || 'info'} size={15} />
                  {section.heading}
                </h3>
                <p>{section.body}</p>
              </div>
            </section>
          ))}
        </div>

        <div className="terms-modal-footer">
          {/* <label> envolviendo el input: así clickear el texto también
              marca la casilla, no hace falta apuntarle al cuadradito. */}
          <label className={'terms-agree' + (agreed ? ' checked' : '')}>
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              disabled={accepting}
            />
            <span className="terms-agree-box">
              <Icon name="check" size={13} strokeWidth={2.6} />
            </span>
            <span className="terms-agree-label">{content.agree}</span>
          </label>

          <div className="terms-modal-actions">
            <button className="btn-secondary" onClick={handleDecline} disabled={accepting}>
              {content.decline}
            </button>
            <button
              className="btn-primary btn-icon-label"
              onClick={handleAccept}
              disabled={accepting || !agreed}
            >
              {!accepting && <Icon name="check" size={15} />}
              {content.accept}
            </button>
          </div>

          <p className="terms-footnote">{content.footnote}</p>
        </div>
      </motion.div>
    </motion.div>
  );
}
