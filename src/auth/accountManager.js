const Store = require('electron-store');
const { getConfigDir } = require('../shared/paths');

const store = new Store({
  name: 'accounts',
  cwd: getConfigDir(),
  // En producción conviene cifrar este archivo (electron-store soporta "encryptionKey")
  // ya que guarda tokens de acceso.
});

function listAccounts() {
  return store.get('accounts', []);
}

function saveAccount(account) {
  // account._raw (cuentas premium) trae el objeto vivo de msmc con funciones
  // y referencias circulares: no es serializable a JSON, así que se guarda en
  // disco sin él. Sigue disponible en memoria durante esta sesión porque el
  // objeto "account" original (con _raw) es el que se le devuelve al renderer.
  const { _raw, ...serializable } = account;
  const accounts = listAccounts();
  const idx = accounts.findIndex((a) => a.id === serializable.id);
  if (idx >= 0) accounts[idx] = serializable;
  else accounts.push(serializable);
  store.set('accounts', accounts);

  // Si es la primera cuenta, se activa automáticamente.
  if (!store.get('activeAccountId')) store.set('activeAccountId', account.id);
  return account;
}

function removeAccount(accountId) {
  const accounts = listAccounts().filter((a) => a.id !== accountId);
  store.set('accounts', accounts);
  if (store.get('activeAccountId') === accountId) {
    store.set('activeAccountId', accounts[0]?.id || null);
  }
  return true;
}

// Actualiza la skin (data URL local, ver electron/main.js → auth:pickSkinFile)
// de una cuenta ya creada, sin tocar el resto de sus datos. Se usa desde el
// botón "Cambiar skin" del modal de cuentas — necesario porque hasta ahora
// la skin solo se podía cargar al CREAR la cuenta offline, y una cuenta que
// ya existía (o que se creó sin skin) se quedaba para siempre con la cara
// genérica de NoSoyHard (ver AccountAvatar.jsx).
function updateAccountSkin(accountId, skinUrl) {
  const accounts = listAccounts();
  const idx = accounts.findIndex((a) => a.id === accountId);
  if (idx < 0) throw new Error('Cuenta no encontrada.');
  accounts[idx] = { ...accounts[idx], skinUrl: skinUrl || null, skinSource: skinUrl ? 'file' : 'default' };
  store.set('accounts', accounts);
  return accounts[idx];
}

function setActiveAccount(accountId) {
  const exists = listAccounts().some((a) => a.id === accountId);
  if (!exists) throw new Error('Cuenta no encontrada.');
  store.set('activeAccountId', accountId);
  return getActiveAccount();
}

function getActiveAccount() {
  const activeId = store.get('activeAccountId');
  if (!activeId) return null;
  return listAccounts().find((a) => a.id === activeId) || null;
}

module.exports = { listAccounts, saveAccount, removeAccount, updateAccountSkin, setActiveAccount, getActiveAccount };
