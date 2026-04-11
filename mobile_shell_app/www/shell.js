import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { Device } from '@capacitor/device';
import { Network } from '@capacitor/network';
import { Toast } from '@capacitor/toast';

let lastBackTapMs = 0;
let reconnectReloadTimer = null;

const LAST_ONLINE_STORAGE_KEY = 'adarsh.shell.lastOnlineAt';

function byId(id) {
  return document.getElementById(id);
}

function getScreenType() {
  const body = document.body;
  if (!body) return '';
  return String(body.getAttribute('data-shell-screen') || '').trim().toLowerCase();
}

function setText(id, value, fallback) {
  const el = byId(id);
  if (!el) return;
  const next = String(value || '').trim() || String(fallback || '').trim();
  if (next) el.textContent = next;
}

function formatRelativeTime(isoValue) {
  if (!isoValue) return '';
  const date = new Date(isoValue);
  if (Number.isNaN(date.getTime())) return '';
  const sec = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (sec < 60) return sec + ' sec ago';
  if (sec < 3600) return Math.round(sec / 60) + ' min ago';
  if (sec < 86400) return Math.round(sec / 3600) + ' hr ago';
  return Math.round(sec / 86400) + ' day ago';
}

function readLastOnlineAt() {
  try {
    return localStorage.getItem(LAST_ONLINE_STORAGE_KEY) || '';
  } catch (err) {
    return '';
  }
}

function writeLastOnlineAt(value) {
  if (!value) return;
  try {
    localStorage.setItem(LAST_ONLINE_STORAGE_KEY, value);
  } catch (err) {}
}

function updateNetworkUi(status) {
  const connected = !!(status && status.connected);
  const body = document.body;
  if (!body) return;

  body.classList.toggle('shell-online', connected);
  body.classList.toggle('shell-offline', !connected);

  const label = connected ? 'Connected' : 'No internet connection';
  setText('shellNetworkLabel', label, label);

  if (connected) {
    const nowIso = new Date().toISOString();
    writeLastOnlineAt(nowIso);
    setText('shellConnectionHint', 'Connected. Loading app...', 'Connected. Loading app...');
    if (getScreenType() === 'offline') {
      if (reconnectReloadTimer) {
        clearTimeout(reconnectReloadTimer);
      }
      reconnectReloadTimer = setTimeout(() => {
        window.location.reload();
      }, 650);
    }
    return;
  }

  const lastOnlineAt = readLastOnlineAt();
  const lastOnlineText = formatRelativeTime(lastOnlineAt);
  const hint = lastOnlineText
    ? 'Last online: ' + lastOnlineText
    : 'Waiting for connection to continue.';
  setText('shellConnectionHint', hint, hint);
}

function setupOfflineRetry() {
  const retryBtn = document.getElementById('retryBtn');
  if (!retryBtn) return;
  retryBtn.addEventListener('click', () => {
    window.location.reload();
  });
}

function setupOpenWebButton() {
  const openWebBtn = byId('openWebBtn');
  if (!openWebBtn) return;
  openWebBtn.addEventListener('click', async () => {
    const appUrl = new URL('/app/', window.location.origin).toString();
    try {
      await Browser.open({ url: appUrl });
      return;
    } catch (err) {}
    window.location.href = appUrl;
  });
}

function setupSupportButton() {
  const openSupportBtn = byId('openSupportBtn');
  if (!openSupportBtn) return;
  openSupportBtn.addEventListener('click', async () => {
    const supportPath = new URL('/app/profile/', window.location.origin).toString();
    try {
      await Browser.open({ url: supportPath });
      return;
    } catch (err) {}
    window.location.href = supportPath;
  });
}

function setupBootStallFallback() {
  if (getScreenType() !== 'boot') return;
  window.setTimeout(() => {
    document.body.classList.add('shell-boot-stalled');
    setText('shellTitle', 'Still trying to connect', 'Still trying to connect');
    setText('shellSubtitle', 'The app server is taking longer than expected. You can retry now.', 'The app server is taking longer than expected. You can retry now.');
  }, 6500);
}

async function setupAppAndDeviceMeta() {
  try {
    const appInfo = await App.getInfo();
    const version = appInfo && appInfo.version ? String(appInfo.version) : 'unknown';
    const build = appInfo && appInfo.build ? String(appInfo.build) : '0';
    setText('shellAppInfo', 'App version: ' + version + ' (build ' + build + ')', 'App version: unknown');
  } catch (err) {
    setText('shellAppInfo', 'App version: unknown', 'App version: unknown');
  }

  try {
    const deviceInfo = await Device.getInfo();
    const model = String(deviceInfo && deviceInfo.model || '').trim();
    const osVersion = String(deviceInfo && (deviceInfo.osVersion || '') || '').trim();
    const platform = String(deviceInfo && deviceInfo.platform || '').trim();
    const summaryParts = [model, platform && osVersion ? platform + ' ' + osVersion : platform || osVersion].filter(Boolean);
    setText('shellDeviceInfo', 'Device: ' + (summaryParts.join(' | ') || 'unknown'), 'Device: unknown');
  } catch (err) {
    setText('shellDeviceInfo', 'Device: unknown', 'Device: unknown');
  }
}

function setupNetworkStateLogger() {
  try {
    Network.addListener('networkStatusChange', (status) => {
      console.log('[shell] networkStatusChange', status.connected, status.connectionType);
      updateNetworkUi(status);
    });
  } catch (err) {
    updateNetworkUi({ connected: navigator.onLine });
  }
}

async function loadCurrentNetworkState() {
  try {
    const status = await Network.getStatus();
    updateNetworkUi(status);
  } catch (err) {
    updateNetworkUi({ connected: navigator.onLine });
  }
}

function setupAndroidBackHandler() {
  if (Capacitor.getPlatform() !== 'android') return;

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
      return;
    }

    const now = Date.now();
    if (now - lastBackTapMs < 1200) {
      App.exitApp();
      return;
    }

    lastBackTapMs = now;
    Toast.show({ text: 'Press back again to exit' }).catch(() => {});
  });
}

setupOfflineRetry();
setupOpenWebButton();
setupSupportButton();
setupBootStallFallback();
setupAppAndDeviceMeta();
loadCurrentNetworkState();
setupNetworkStateLogger();
setupAndroidBackHandler();
