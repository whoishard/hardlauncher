import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';

// Tipografía auto-alojada (empaquetada con la app vía @fontsource) en vez de
// un @import a Google Fonts. La app empaquetada corre offline la mayor parte
// del tiempo y ese @import remoto podía fallar en silencio (sin internet, con
// un firewall/antivirus, o simplemente por timing) -> el navegador caía al
// fallback del sistema y se veía "pixelado"/genérico en vez de Inter.
// Con los .woff2 empaquetados localmente la fuente correcta siempre está
// disponible, con o sin conexión — Inter en toda la interfaz (títulos y
// resto), igual que en la app real de Modrinth. Antes también se cargaba
// Sora para los títulos, pero quedaba visiblemente distinta al lado de
// Modrinth; ya no se usa en ningún lado (ver --font-display en theme.css).
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '../../styles/theme.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);
