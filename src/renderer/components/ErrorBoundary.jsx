import React from 'react';
import Icon from './Icon.jsx';
import { t } from '../i18n.js';

/**
 * Red de seguridad para toda la app: sin esto, si una vista tira una
 * excepción durante el render (como ocurría antes al abrir Explorar),
 * React desmonta el árbol entero y no queda nada dibujado -> pantalla en
 * negro sin ningún mensaje. Con este boundary, el error queda contenido
 * dentro del área de contenido y el usuario puede reintentar sin perder
 * la barra lateral ni la barra superior.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[HardLauncher] Error no controlado en la interfaz:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-fallback">
          <Icon name="close" size={28} />
          <h3>{t('error.title')}</h3>
          <p>{this.state.error.message || t('error.generic')}</p>
          <button className="btn-primary" onClick={() => this.setState({ error: null })}>
            {t('error.retry')}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
