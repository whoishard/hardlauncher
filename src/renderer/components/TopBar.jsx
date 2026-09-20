import React, { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, matchPath } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore } from '../store.js';
import { useT } from '../i18n.js';
import AccountModal from './AccountModal.jsx';
import AccountAvatar from './AccountAvatar.jsx';
import Icon from './Icon.jsx';

function currentRouteMeta(pathname, t) {
  const ROUTE_META = [
    { pattern: '/', icon: 'home', label: t('nav.home') },
    { pattern: '/explore', icon: 'compass', label: t('nav.explore') },
    { pattern: '/instances', icon: 'layers', label: t('nav.instances') },
    { pattern: '/instances/:id', icon: 'layers', label: t('nav.instance') },
    { pattern: '/project/:id', icon: 'compass', label: t('nav.project') },
  ];
  return ROUTE_META.find((r) => matchPath({ path: r.pattern, end: true }, pathname)) || ROUTE_META[0];
}

export default function TopBar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { activeAccount, accounts, setActiveAccount, refreshAccounts } = useAppStore();
  const t = useT();
  const [showDropdown, setShowDropdown] = useState(false);
  const [showAccountModal, setShowAccountModal] = useState(false);
  const ref = useRef(null);
  const meta = currentRouteMeta(location.pathname, t);

  useEffect(() => {
    refreshAccounts();
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setShowDropdown(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  async function handleRemove(e, id) {
    e.stopPropagation();
    await window.hardLauncher.auth.removeAccount(id);
    await refreshAccounts();
  }

  return (
    <div className="topbar">
      <div className="topbar-nav">
        <button className="topbar-nav-btn" onClick={() => navigate(-1)} title={t('nav.back')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="topbar-nav-btn" onClick={() => navigate(1)} title={t('nav.forward')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="topbar-breadcrumb">
          <Icon name={meta.icon} size={15} />
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={meta.label}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            >
              {meta.label}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>

      <div className="topbar-account-wrap" ref={ref}>
        <button className="topbar-account" onClick={() => setShowDropdown((o) => !o)}>
          {activeAccount ? (
            <>
              <div className="topbar-account-avatar">
                <AccountAvatar account={activeAccount} size={32} radius={9} />
                <span className="topbar-account-avatar-dot" />
              </div>
              <div className="topbar-account-text">
                <span className="topbar-account-name">{activeAccount.username}</span>
                <span className="topbar-account-type">
                  {activeAccount.type === 'premium' ? t('account.premium') : t('account.offline')}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="topbar-account-avatar topbar-account-avatar-empty">
                <Icon name="plus" size={14} />
              </div>
              <div className="topbar-account-text">
                <span className="topbar-account-name">{t('account.add')}</span>
                <span className="topbar-account-type">{t('account.noneActive')}</span>
              </div>
            </>
          )}
          <svg width="10" height="6" viewBox="0 0 10 6" className={'custom-select-arrow' + (showDropdown ? ' open' : '')}>
            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>

        <AnimatePresence>
        {showDropdown && (
          <motion.div
            className="topbar-account-menu"
            initial={{ opacity: 0, scale: 0.96, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: -6 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="topbar-account-menu-header">{t('account.playingAs')}</div>

            <div className="topbar-account-menu-list">
              {accounts.map((acc) => (
                <div
                  key={acc.id}
                  className={'topbar-account-option' + (activeAccount?.id === acc.id ? ' selected' : '')}
                  onClick={() => {
                    setActiveAccount(acc.id);
                    setShowDropdown(false);
                  }}
                >
                  <span className={'topbar-account-status-dot' + (activeAccount?.id === acc.id ? ' active' : '')} />
                  <div className="topbar-account-avatar sm">
                    <AccountAvatar account={acc} size={28} radius={8} />
                  </div>
                  <div className="topbar-account-option-text">
                    <div className="topbar-account-option-name">{acc.username}</div>
                    <div className="topbar-account-option-type">{acc.type === 'premium' ? t('common.premium') : t('common.offline')}</div>
                  </div>
                  <button
                    type="button"
                    className="topbar-account-remove"
                    title={t('account.remove')}
                    onClick={(e) => handleRemove(e, acc.id)}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>
              ))}
              {accounts.length === 0 && (
                <div className="topbar-account-menu-empty">{t('account.empty')}</div>
              )}
            </div>

            <button
              className="topbar-account-add"
              onClick={() => {
                setShowDropdown(false);
                setShowAccountModal(true);
              }}
            >
              <Icon name="plus" size={14} />
              {t('account.addNew')}
            </button>
          </motion.div>
        )}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {showAccountModal && <AccountModal onClose={() => setShowAccountModal(false)} />}
      </AnimatePresence>
    </div>
  );
}
