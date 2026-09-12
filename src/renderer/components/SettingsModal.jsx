import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import MemorySlider from '../components/MemorySlider.jsx';
import Icon from '../components/Icon.jsx';
import AccountAvatar from '../components/AccountAvatar.jsx';
import { modalOverlayMotion, modalCardMotion } from './CreateInstanceModal.jsx';

/**
 * Versión actual (leída de verdad del main process, no hardcodeada — antes
 * este pie siempre decía "1.0.0" sin importar qué versión estuviera
 * realmente instalada) + botón para forzar un chequeo manual de
 * actualizaciones. El resultado del chequeo (descargando, ya estás al día,
 * error, etc.) se ve en el toast/tarjeta flotante de UpdateToast.jsx, que
 * escucha el mismo evento 'updater:event' — acá no se duplica ese estado,
 * solo se dispara el chequeo.
 */
function UpdateFooter() {
  const t = useT();
  const [version, setVersion] = useState(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    window.hardLauncher?.system?.getVersion().then(setVersion).catch(() => {});
  }, []);

  useEffect(() => {
    if (!checking || !window.hardLauncher?.updater) return undefined;
    // Se ignora el propio evento 'checking' (llega como confirmación
    // inmediata del pedido) y se espera al resultado real, para que el
    // botón no vuelva a su estado normal antes de tiempo.
    const unsub = window.hardLauncher.updater.onEvent((payload) => {
      if (payload.status !== 'checking') setChecking(false);
    });
    return unsub;
  }, [checking]);

  function handleCheck() {
    setChecking(true);
    window.hardLauncher?.updater?.check();
  }

  return (
    <div className="settings-footer">
      <span>Hard Launcher{version ? ` ${version}` : ''}</span>
      <span>·</span>
      <button type="button" className="settings-footer-update-btn" onClick={handleCheck} disabled={checking}>
        {checking ? t('updater.checking') : t('updater.checkButton')}
      </button>
    </div>
  );
}

export default function SettingsModal({ onClose }) {
  const [section, setSection] = useState('appearance');
  const { settings, loadSettings } = useAppStore();
  const t = useT();

  const NAV_GROUPS = [
    {
      heading: t('settings.nav.display'),
      items: [
        { id: 'appearance', label: t('settings.nav.appearance'), icon: 'palette' },
        { id: 'language', label: t('settings.nav.language'), icon: 'globe' },
        { id: 'behavior', label: t('settings.nav.behavior'), icon: 'gear' },
      ],
    },
    {
      heading: t('settings.nav.account'),
      items: [{ id: 'accounts', label: t('settings.nav.accounts'), icon: 'user' }],
    },
    {
      heading: t('settings.nav.instances'),
      items: [
        { id: 'general', label: t('settings.nav.defaults'), icon: 'gamepad' },
        { id: 'java', label: t('settings.nav.java'), icon: 'cup' },
        { id: 'storage', label: t('settings.nav.storage'), icon: 'database' },
      ],
    },
  ];

  useEffect(() => {
    if (!settings) loadSettings();
  }, []);

  return (
    <motion.div className="modal-overlay" onClick={onClose} {...modalOverlayMotion}>
      <motion.div className="card modal-card launcher-settings-modal" onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
        <div className="modal-header">
          <h3 className="modal-title" style={{ fontSize: 17 }}>
            {t('settings.title')}
          </h3>
          <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="settings-layout launcher-settings-layout">
          <nav>
            {NAV_GROUPS.map((group) => (
              <div className="settings-nav-group" key={group.heading}>
                <div className="settings-nav-heading">{group.heading}</div>
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    className={'settings-nav-item' + (section === item.id ? ' active' : '')}
                    onClick={() => setSection(item.id)}
                  >
                    <Icon name={item.icon} size={19} />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
            <UpdateFooter />
          </nav>

          <div className="launcher-settings-modal-body">
            {section === 'appearance' && <AppearanceSection />}
            {section === 'language' && <LanguageSection />}
            {section === 'behavior' && <BehaviorSection />}
            {section === 'accounts' && <AccountsSection />}
            {section === 'general' && <GeneralSection />}
            {section === 'java' && <JavaSection />}
            {section === 'storage' && <StorageSection />}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function ThemePreview({ id }) {
  const palettes = {
    dark: { bg: '#222326', bar: '#3c3e46', dot: '#a78bfa' },
    light: { bg: '#ffffff', bar: '#e2dff0', dot: '#a78bfa' },
    oled: { bg: '#000000', bar: '#232329', dot: '#a78bfa' },
    system: { bg: 'linear-gradient(135deg, #222326 50%, #ffffff 50%)', bar: '#a78bfa', dot: '#a78bfa' },
  };
  const p = palettes[id];
  return (
    <div className="theme-option-preview" style={{ background: p.bg }}>
      <div className="theme-preview-dot" style={{ background: p.dot }} />
      <div className="theme-preview-bar wide" style={{ background: p.bar }} />
      <div className="theme-preview-bar short" style={{ background: p.bar }} />
    </div>
  );
}

function AppearanceSection() {
  const { settings, updateSettings } = useAppStore();
  const t = useT();
  if (!settings) return null;
  const themes = [
    { id: 'dark', label: t('settings.theme.dark') },
    { id: 'light', label: t('settings.theme.light') },
    { id: 'oled', label: t('settings.theme.oled') },
    { id: 'system', label: t('settings.theme.system') },
  ];

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>{t('settings.themeTitle')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        {t('settings.themeHint')}
      </p>
      <div className="theme-grid">
        {themes.map((theme) => (
          <button
            key={theme.id}
            type="button"
            className={'theme-option' + (settings.theme === theme.id ? ' selected' : '')}
            onClick={() => updateSettings({ theme: theme.id })}
          >
            <ThemePreview id={theme.id} />
            <div className="theme-option-label">
              <span className="theme-option-radio" />
              {theme.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function LanguageSection() {
  const { settings, updateSettings } = useAppStore();
  const t = useT();
  if (!settings) return null;

  const LANGUAGES = [
    { id: 'es', native: 'Español', en: 'Spanish' },
    { id: 'en', native: 'English', en: 'English' },
    { id: 'pt', native: 'Português', en: 'Portuguese' },
  ];

  return (
    <div style={{ maxWidth: 420 }}>
      <h3 style={{ marginTop: 0 }}>{t('settings.langTitle')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        {t('settings.langHint')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {LANGUAGES.map((l) => (
          <motion.button
            key={l.id}
            type="button"
            className={'card lang-option' + (settings.language === l.id ? ' selected' : '')}
            onClick={() => updateSettings({ language: l.id })}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.985 }}
          >
            <span className="lang-option-meta">
              <span className="lang-option-native">{l.native}</span>
              <span className="lang-option-en">{l.en}</span>
            </span>
            {settings.language === l.id && (
              <span style={{ color: 'var(--accent-primary-hover)', fontWeight: 700 }}>✓</span>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function BehaviorSection() {
  const { settings, updateSettings } = useAppStore();
  const t = useT();
  if (!settings) return null;

  return (
    <div style={{ maxWidth: 480 }}>
      <h3 style={{ marginTop: 0 }}>{t('settings.behaviorTitle')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        {t('settings.behaviorHint')}
      </p>
      <div
        className="card"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, gap: 16 }}
      >
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('settings.keepOpen')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('settings.keepOpenHint')}</div>
        </div>
        <div
          className={'toggle' + (settings.keepLauncherOpenWhilePlaying ? ' on' : '')}
          onClick={() => updateSettings({ keepLauncherOpenWhilePlaying: !settings.keepLauncherOpenWhilePlaying })}
        />
      </div>
    </div>
  );
}

function AccountsSection() {
  const { accounts, activeAccount, setActiveAccount, refreshAccounts } = useAppStore();
  const t = useT();

  useEffect(() => {
    refreshAccounts();
  }, []);

  async function handleRemove(id) {
    await window.hardLauncher.auth.removeAccount(id);
    refreshAccounts();
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h3 style={{ marginTop: 0 }}>{t('account.title')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        {t('settings.accountsHint')}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {accounts.map((acc) => (
          <div key={acc.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <AccountAvatar account={acc} size={36} />
              <div>
                <div style={{ fontWeight: 600 }}>{acc.username}</div>
                <span className="badge">{acc.type === 'premium' ? t('common.premium') : t('common.offline')}</span>
                {activeAccount?.id === acc.id && <span className="badge" style={{ marginLeft: 6 }}>{t('common.active')}</span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              {activeAccount?.id !== acc.id && (
                <button className="btn-secondary" onClick={() => setActiveAccount(acc.id)}>
                  {t('common.use')}
                </button>
              )}
              <button className="btn-secondary" onClick={() => handleRemove(acc.id)}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        ))}
        {accounts.length === 0 && <p style={{ color: 'var(--text-muted)' }}>{t('account.emptyShort')}</p>}
      </div>
    </div>
  );
}

function GeneralSection() {
  const { settings, updateSettings } = useAppStore();
  const t = useT();
  const [maxSystemMemory, setMaxSystemMemory] = useState(16384);

  useEffect(() => {
    window.hardLauncher.system.getTotalMemoryMB().then((mb) => setMaxSystemMemory(mb));
  }, []);

  if (!settings) return null;

  return (
    <div style={{ maxWidth: 520 }}>
      <h3 style={{ marginTop: 0 }}>{t('settings.defaultsTitle')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -8, marginBottom: 20 }}>
        {t('settings.defaultsHint')}
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <MemorySlider
          label={t('settings.memMin')}
          value={settings.defaultMemoryMin}
          min={512}
          max={maxSystemMemory}
          step={256}
          onChange={(v) => updateSettings({ defaultMemoryMin: v })}
        />
        <div style={{ height: 16 }} />
        <MemorySlider
          label={t('settings.memMax')}
          value={settings.defaultMemoryMax}
          min={512}
          max={maxSystemMemory}
          step={256}
          onChange={(v) => updateSettings({ defaultMemoryMax: v })}
        />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 10, marginBottom: 0 }}>
          {t('settings.ramTotal', { n: (maxSystemMemory / 1024).toFixed(1) })}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('settings.resolution')}
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            value={settings.defaultResolutionWidth}
            onChange={(e) => updateSettings({ defaultResolutionWidth: Number(e.target.value) })}
            placeholder={t('settings.width')}
          />
          <input
            type="number"
            value={settings.defaultResolutionHeight}
            onChange={(e) => updateSettings({ defaultResolutionHeight: Number(e.target.value) })}
            placeholder={t('settings.height')}
          />
        </div>
      </div>

      {/* Se agrega junto a la resolución por defecto: la pestaña "Ventana"
          de Ajustes de una instancia (Custom window settings → Fullscreen)
          ahora puede pisar este valor por instancia; esto es lo que se usa
          mientras esa instancia no tenga ajustes de ventana propios. */}
      <div
        className="card"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, gap: 16 }}
      >
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('settings.fullscreen')}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('settings.fullscreenHint')}
          </div>
        </div>
        <div
          className={'toggle' + (settings.defaultFullscreen ? ' on' : '')}
          onClick={() => updateSettings({ defaultFullscreen: !settings.defaultFullscreen })}
        />
      </div>

      {/* "Global overrides" al estilo Modrinth App: argumentos de Java,
          variables de entorno y hooks de lanzamiento que hereda toda
          instancia nueva (con el toggle "personalizado" ya prendido en su
          propio panel), sin tener que cargarlos instancia por instancia. */}
      <h3 style={{ marginTop: 28 }}>{t('settings.advancedTitle')}</h3>
      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: -8, marginBottom: 16 }}>
        {t('settings.advancedHint')}
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('settings.defaultJvmArgs')}
        </label>
        <input
          value={settings.defaultJvmArgs}
          onChange={(e) => updateSettings({ defaultJvmArgs: e.target.value })}
          placeholder="-XX:+UseG1GC -XX:+ParallelRefProcEnabled"
          style={{ width: '100%' }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
          {t('settings.defaultJvmArgsHint')}
        </p>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('settings.defaultEnvVars')}
        </label>
        <input
          value={settings.defaultEnvVars}
          onChange={(e) => updateSettings({ defaultEnvVars: e.target.value })}
          placeholder="__GL_THREADED_OPTIMIZATIONS=1"
          style={{ width: '100%' }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
          {t('settings.defaultEnvVarsHint')}
        </p>
      </div>

      <div className="card">
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('settings.defaultPreLaunchHook')}
        </label>
        <input
          value={settings.defaultPreLaunchHook}
          onChange={(e) => updateSettings({ defaultPreLaunchHook: e.target.value })}
          placeholder={t('settings.defaultPreLaunchHookPlaceholder')}
          style={{ width: '100%', marginBottom: 12 }}
        />
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('settings.defaultWrapperHook')}
        </label>
        <input
          value={settings.defaultWrapperHook}
          onChange={(e) => updateSettings({ defaultWrapperHook: e.target.value })}
          placeholder={t('settings.defaultWrapperHookPlaceholder')}
          style={{ width: '100%', marginBottom: 12 }}
        />
        <label style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>
          {t('settings.defaultPostExitHook')}
        </label>
        <input
          value={settings.defaultPostExitHook}
          onChange={(e) => updateSettings({ defaultPostExitHook: e.target.value })}
          placeholder={t('settings.defaultPostExitHookPlaceholder')}
          style={{ width: '100%' }}
        />
        <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
          {t('settings.defaultHooksHint')}
        </p>
      </div>
    </div>
  );
}

function JavaSection() {
  const { settings, updateSettings } = useAppStore();
  const t = useT();
  if (!settings) return null;

  async function pickJava() {
    const picked = await window.hardLauncher.settings.pickJavaExecutable();
    if (picked) updateSettings({ javaPathOverride: picked });
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <h3 style={{ marginTop: 0 }}>{t('settings.javaTitle')}</h3>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
        {t('settings.javaHint')}
      </p>
      {settings.javaPathOverride ? (
        <div className="card" style={{ padding: 10, fontSize: 12, wordBreak: 'break-all', marginBottom: 10 }}>
          {settings.javaPathOverride}
        </div>
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('settings.javaAuto')}</p>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn-secondary" onClick={pickJava}>
          {t('settings.pickExe')}
        </button>
        {settings.javaPathOverride && (
          <button className="btn-secondary" onClick={() => updateSettings({ javaPathOverride: null })}>
            {t('settings.clearJava')}
          </button>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb > 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function StorageSection() {
  const [info, setInfo] = useState(null);
  const t = useT();

  function load() {
    window.hardLauncher.storage.info().then(setInfo);
  }

  useEffect(load, []);

  const rows = info
    ? [
        { label: t('settings.storageInstances'), ...info.instances },
        { label: t('settings.storageGame'), ...info.gameFiles },
        { label: t('settings.storageJava'), ...info.javaRuntimes },
      ]
    : [];

  const totalBytes = rows.reduce((sum, r) => sum + (r.bytes || 0), 0);

  return (
    <div style={{ maxWidth: 560 }}>
      <h3 style={{ marginTop: 0 }}>{t('settings.storageTitle')}</h3>
      {!info && <p style={{ color: 'var(--text-secondary)' }}>{t('settings.storageCalc')}</p>}
      {/* Antes cada tamaño aparecía en gris tenue de 12px, casi invisible —
          era el dato más importante de esta pantalla y el que menos se veía.
          Ahora es lo más grande y con más contraste de cada fila. */}
      {info && (
        <div className="storage-total-banner">
          <span>{t('settings.storageTotal')}</span>
          <strong>{formatBytes(totalBytes)}</strong>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((row) => (
          <div key={row.path} className="card storage-row">
            <div>
              <div className="storage-row-label">{row.label}</div>
              <div className="storage-row-size">{formatBytes(row.bytes)}</div>
            </div>
            <button className="btn-secondary btn-icon-label" onClick={() => window.hardLauncher.storage.openFolder(row.path)}>
              <Icon name="folder" size={15} />
              {t('common.openFolder')}
            </button>
          </div>
        ))}
      </div>
      {info && (
        <button className="btn-secondary" style={{ marginTop: 12 }} onClick={load}>
          {t('settings.recalc')}
        </button>
      )}
    </div>
  );
}


