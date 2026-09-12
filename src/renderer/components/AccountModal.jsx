import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import Icon from './Icon.jsx';
import AccountAvatar from './AccountAvatar.jsx';
import { modalOverlayMotion, modalCardMotion } from './CreateInstanceModal.jsx';

const AUTH_METHODS = [
  { id: 'offline', icon: 'user', titleKey: 'common.offline' },
  { id: 'microsoft', icon: 'microsoft', title: 'Microsoft' },
];

// Logo oficial de 4 cuadrados de Microsoft: da reconocimiento de marca
// instantáneo al botón, en vez de depender del texto para explicar qué es.
function MicrosoftLogo({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

const listItem = {
  hidden: { opacity: 0, y: -6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.18, ease: [0.16, 1, 0.3, 1] } },
  exit: { opacity: 0, x: 20, transition: { duration: 0.12 } },
};

export default function AccountModal({ onClose }) {
  const { accounts, activeAccount, refreshAccounts, setActiveAccount } = useAppStore();
  const t = useT();
  const [method, setMethod] = useState('offline');
  const [username, setUsername] = useState('');
  const [skinOpen, setSkinOpen] = useState(false);
  const [skinUrl, setSkinUrl] = useState('');
  const [pickingSkin, setPickingSkin] = useState(false);
  const [changingSkinFor, setChangingSkinFor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Botón "Subir archivo .png" (tanto en el formulario de crear cuenta como
  // en "Cambiar skin" de una cuenta ya existente): abre el selector nativo
  // de archivos del sistema operativo y devuelve la skin ya leída como data
  // URL, lista para guardar. No pasa por red en ningún momento, así que
  // siempre es la skin real del jugador, de frente — el mismo recorte de
  // "solo cara" (base + overlay) que ya usa AccountAvatar para pintarla.
  async function pickSkinFile() {
    setPickingSkin(true);
    try {
      const dataUrl = await window.hardLauncher.auth.pickSkinFile();
      return dataUrl || null;
    } finally {
      setPickingSkin(false);
    }
  }

  async function handlePickSkinForNewAccount() {
    const dataUrl = await pickSkinFile();
    if (dataUrl) setSkinUrl(dataUrl);
  }

  async function handleChangeSkin(accountId) {
    const dataUrl = await pickSkinFile();
    if (!dataUrl) return;
    setChangingSkinFor(accountId);
    try {
      await window.hardLauncher.auth.updateSkin(accountId, dataUrl);
      await refreshAccounts();
    } finally {
      setChangingSkinFor(null);
    }
  }

  async function handleCreateOffline() {
    setError('');
    if (username.trim().length < 3) {
      setError(t('account.minChars'));
      return;
    }
    setLoading(true);
    try {
      await window.hardLauncher.auth.createOffline(username.trim(), skinUrl.trim() || undefined);
      await refreshAccounts();
      setUsername('');
      setSkinUrl('');
      setSkinOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleLoginMicrosoft() {
    setError('');
    setLoading(true);
    try {
      await window.hardLauncher.auth.loginMicrosoft();
      await refreshAccounts();
    } catch (e) {
      setError(t('account.loginFailed', { error: e.message }));
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(id) {
    await window.hardLauncher.auth.removeAccount(id);
    await refreshAccounts();
  }

  return (
    <motion.div className="modal-overlay" onClick={onClose} {...modalOverlayMotion}>
      <motion.div className="card modal-card account-modal" onClick={(e) => e.stopPropagation()} {...modalCardMotion}>
        <div className="modal-header">
          <h3 className="modal-title">{t('account.title')}</h3>
          <button type="button" className="modal-close-btn" onClick={onClose} title={t('common.close')}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="auth-method-grid">
          {AUTH_METHODS.map((m) => (
            <motion.button
              key={m.id}
              type="button"
              className={'auth-method-card' + (method === m.id ? ' active' : '')}
              onClick={() => {
                setMethod(m.id);
                setError('');
              }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
            >
              <div className="auth-method-icon">
                {m.id === 'microsoft' ? <MicrosoftLogo size={17} /> : <Icon name={m.icon} size={17} />}
              </div>
              {m.title || t(m.titleKey)}
              {method === m.id && (
                <motion.span
                  className="auth-method-check"
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Icon name="check" size={11} strokeWidth={3} />
                </motion.span>
              )}
            </motion.button>
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={method}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
          >
            {method === 'offline' ? (
              <div className="auth-form">
                <input
                  autoFocus
                  placeholder={t('account.username')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateOffline()}
                  maxLength={16}
                />

                <button type="button" className="auth-form-advanced-toggle" onClick={() => setSkinOpen((o) => !o)}>
                  <Icon name="plus" size={11} />
                  {t('account.customSkin')}
                </button>
                <AnimatePresence>
                  {skinOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.15 }}
                      style={{ overflow: 'hidden' }}
                    >
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                        {skinUrl && skinUrl.startsWith('data:') && (
                          <>
                            <AccountAvatar account={{ type: 'offline', skinUrl }} size={32} radius={8} />
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() => setSkinUrl('')}
                              title={t('common.delete')}
                              style={{ padding: '6px 8px' }}
                            >
                              <Icon name="close" size={12} />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="btn-secondary btn-icon-label"
                          onClick={handlePickSkinForNewAccount}
                          disabled={pickingSkin}
                          style={{ flexShrink: 0 }}
                        >
                          <Icon name="folder" size={13} />
                          {pickingSkin ? t('account.picking') : t('account.uploadSkinFile')}
                        </button>
                      </div>
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                        {t('account.uploadSkinHint')}
                      </p>
                      <input
                        placeholder={t('account.skinUrl')}
                        value={skinUrl.startsWith('data:') ? '' : skinUrl}
                        onChange={(e) => setSkinUrl(e.target.value)}
                        disabled={skinUrl.startsWith('data:')}
                        style={{ marginTop: 8 }}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                {error && <div className="auth-form-error">{error}</div>}

                <motion.button
                  className="btn-primary"
                  onClick={handleCreateOffline}
                  disabled={loading}
                  whileHover={!loading ? { scale: 1.01 } : undefined}
                  whileTap={!loading ? { scale: 0.98 } : undefined}
                >
                  {loading ? t('account.creating') : t('account.create')}
                </motion.button>
              </div>
            ) : (
              <div className="auth-form">
                {error && <div className="auth-form-error">{error}</div>}
                <motion.button
                  className="auth-microsoft-btn"
                  onClick={handleLoginMicrosoft}
                  disabled={loading}
                  whileHover={!loading ? { scale: 1.01 } : undefined}
                  whileTap={!loading ? { scale: 0.98 } : undefined}
                >
                  <MicrosoftLogo size={18} />
                  {loading ? t('account.authenticating') : t('account.msLogin')}
                </motion.button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {accounts.length > 0 && (
          <>
            <div className="modal-section-label">{t('account.listCount', { n: accounts.length })}</div>
            <div className="account-list">
              <AnimatePresence initial={false}>
                {accounts.map((acc) => {
                  const isActive = activeAccount?.id === acc.id;
                  return (
                    <motion.div
                      key={acc.id}
                      layout
                      variants={listItem}
                      initial="hidden"
                      animate="show"
                      exit="exit"
                      className={'account-list-row' + (isActive ? ' active' : '')}
                      onClick={() => !isActive && setActiveAccount(acc.id)}
                    >
                      <AccountAvatar account={acc} size={32} radius={9} />
                      <div className="account-list-info">
                        <div className="account-list-name">{acc.username}</div>
                        <div className="account-list-type">
                          {acc.type === 'premium' ? <MicrosoftLogo size={11} /> : <Icon name="user" size={11} />}
                          {acc.type === 'premium' ? t('common.premium') : t('common.offline')}
                        </div>
                      </div>
                      {isActive ? (
                        <span className="account-list-active-check" title={t('account.inUse')}>
                          <Icon name="check" size={13} strokeWidth={2.6} />
                        </span>
                      ) : null}
                      {acc.type === 'offline' && (
                        <button
                          type="button"
                          className="account-list-remove-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleChangeSkin(acc.id);
                          }}
                          disabled={changingSkinFor === acc.id}
                          title={t('account.changeSkin')}
                        >
                          <Icon name="folder" size={13} />
                        </button>
                      )}
                      {/* El botón de eliminar se muestra siempre, incluso
                          para la cuenta activa: antes solo aparecía en las
                          cuentas inactivas, así que si solo tenías una
                          cuenta (necesariamente la activa) no había forma
                          de borrarla desde acá. El backend ya sabe manejar
                          este caso (accountManager.removeAccount reasigna
                          activeAccountId a la siguiente cuenta, o a null si
                          no queda ninguna), así que solo hacía falta sacar
                          esta restricción del lado del renderer. */}
                      <button
                        type="button"
                        className="account-list-remove-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(acc.id);
                        }}
                        title={t('account.remove')}
                      >
                        <Icon name="trash" size={13} />
                      </button>                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
