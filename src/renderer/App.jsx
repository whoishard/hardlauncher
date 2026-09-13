import React, { useEffect } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import TitleBar from './components/TitleBar.jsx';
import Sidebar from './components/Sidebar.jsx';
import TopBar from './components/TopBar.jsx';
import AmbientBackground from './components/AmbientBackground.jsx';
import HomeView from './views/HomeView.jsx';
import InstancesView from './views/InstancesView.jsx';
import InstanceDetailView from './views/InstanceDetailView.jsx';
import ExploreView from './views/ExploreView.jsx';
import ProjectDetailView from './views/ProjectDetailView.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import InstallProgressToast from './components/InstallProgressToast.jsx';
import UpdateToast from './components/UpdateToast.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { useAppStore } from './store.js';

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const mainContentRef = React.useRef(null);
  const refreshAccounts = useAppStore((s) => s.refreshAccounts);
  const refreshInstances = useAppStore((s) => s.refreshInstances);
  const loadSettings = useAppStore((s) => s.loadSettings);
  const clearRunningInstance = useAppStore((s) => s.clearRunningInstance);
  const theme = useAppStore((s) => s.settings?.theme);
  const language = useAppStore((s) => s.settings?.language);
  const settingsModalOpen = useAppStore((s) => s.settingsModalOpen);
  const openSettingsModal = useAppStore((s) => s.openSettingsModal);
  const closeSettingsModal = useAppStore((s) => s.closeSettingsModal);

  useEffect(() => {
    refreshAccounts();
    refreshInstances();
    loadSettings();
  }, []);

  // Este listener vive acá (en App, siempre montado) y no en InstanceDetailView,
  // a propósito: si el usuario navega a otra pantalla mientras el juego sigue
  // abierto, el listener de esa vista se desmonta y nunca se entera de que
  // terminó. El indicador global de la barra de título necesita saberlo
  // pase lo que pase, así que escucha acá arriba, en el componente raíz.
  useEffect(() => {
    const unsub = window.hardLauncher.game.onExit(() => clearRunningInstance());
    return unsub;
  }, []);

  // Botones "Inicio" / "Instancias" / "Ajustes" del popup del ícono de
  // bandeja (ver electron/main.js + electron/trayMenu.html): el proceso
  // principal ya trajo la ventana al frente antes de mandar esto, acá solo
  // falta llevar la propia navegación de React a donde corresponda.
  useEffect(() => {
    const unsub = window.hardLauncher.window.onNavigate((route) => navigate(route));
    return unsub;
  }, [navigate]);

  useEffect(() => {
    const unsub = window.hardLauncher.window.onOpenSettings(() => openSettingsModal());
    return unsub;
  }, [openSettingsModal]);

  // Aplica el tema elegido al elemento <html> (data-theme), de donde lo lee
  // el CSS. "system" resuelve entre claro/oscuro según el SO y se actualiza
  // solo si el usuario cambia el tema de Windows mientras la app está abierta.
  useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: light)');

    function apply() {
      const resolved = theme === 'system' ? (mql.matches ? 'light' : 'dark') : theme || 'dark';
      document.documentElement.setAttribute('data-theme', resolved);
    }

    apply();
    if (theme === 'system') {
      mql.addEventListener('change', apply);
      return () => mql.removeEventListener('change', apply);
    }
  }, [theme]);

  useEffect(() => {
    const lang = language || 'es';
    document.documentElement.lang = lang === 'pt' ? 'pt-BR' : lang;
    document.documentElement.setAttribute('data-lang', lang);
  }, [language]);

  // .main-content es el único contenedor con scroll (ver theme.css) y vive
  // fuera del <Routes>, así que NO se remonta al navegar entre vistas: si
  // quedaste scrolleado abajo del todo en Inicio y vas a Explorar, arrancás
  // igual de abajo en la vista nueva en vez de arriba. Lo reseteamos a mano
  // en cada cambio de ruta. Nota: no puede ir en el mismo efecto que aplica
  // el idioma/tema de arriba porque esos corren también cuando cambian
  // theme/language sin que haya navegación real.
  useEffect(() => {
    mainContentRef.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location.pathname]);

  return (
    <div className="app-root">
      <AmbientBackground />
      <TitleBar />
      <ToastContainer />
      <InstallProgressToast />
      <UpdateToast />
      <div className="app-shell">
        <Sidebar />
        <div className="content-column">
          <TopBar />
          <div className="main-content" ref={mainContentRef}>
            <ErrorBoundary key={location.pathname}>
              {/* mode="wait" para que la vista saliente termine de desvanecerse
                  antes de que entre la nueva: evita el parpadeo de dos vistas
                  superpuestas que se ve con la transición por defecto. */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={location.pathname}
                  className="page-enter"
                  // Antes esto también animaba "y" (opacity + traslado vertical).
                  // Framer Motion, para animar "y", le deja puesto un
                  // transform (translateY) al div incluso ya en reposo en
                  // y:0 — y un ancestro con transform, sea el valor que sea,
                  // se vuelve el "viewport" de cualquier position:fixed que
                  // tenga adentro (ver spec de CSS). Como esta página envuelve
                  // TODA vista enrutada, cualquier modal fixed abierto desde
                  // adentro (ajustes de instancia, la lightbox de capturas,
                  // etc.) quedaba fijo al tamaño de este contenedor en vez de
                  // a la ventana real, y al scrollear la página el contenido
                  // de más abajo se veía nítido y clickeable por encima/debajo
                  // del modal en vez de quedar tapado por él. Animar solo
                  // opacity no toca transform, así que esos modales vuelven a
                  // cubrir toda la ventana como corresponde.
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  // minHeight en vez de height: con height:'100%' fijo, en vistas
                  // largas (el listado de Explorar, los mods instalados de una
                  // instancia, etc.) el contenido desborda esta caja pero los
                  // hermanos siguientes (el ::after "espaciador" de .main-content,
                  // ver theme.css) igual se ubican pegados al borde de ese 100%
                  // en vez de después del contenido real — quedan tapados por el
                  // propio desborde y el espaciador nunca llega a verse. El
                  // resultado: la paginación, la última fila de mods, etc. terminan
                  // pegadas al borde inferior real de la ventana. minHeight sigue
                  // garantizando el alto completo cuando el contenido es corto
                  // (nada cambia ahí), pero deja crecer la caja cuando el
                  // contenido es más largo que la ventana, así el espaciador cae
                  // donde corresponde: después del último elemento de verdad.
                  style={{ minHeight: '100%' }}
                >
                  <Routes location={location}>
                    <Route path="/" element={<HomeView />} />
                    <Route path="/instances" element={<InstancesView />} />
                    <Route path="/instances/:id" element={<InstanceDetailView />} />
                    <Route path="/explore" element={<ExploreView />} />
                    <Route path="/project/:id" element={<ProjectDetailView />} />
                  </Routes>
                </motion.div>
              </AnimatePresence>
            </ErrorBoundary>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {settingsModalOpen && <SettingsModal onClose={closeSettingsModal} />}
      </AnimatePresence>
    </div>
  );
}
