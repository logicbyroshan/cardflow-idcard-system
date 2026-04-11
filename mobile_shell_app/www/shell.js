import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';

let lastBackTapMs = 0;

function setupOfflineRetry() {
  const retryBtn = document.getElementById('retryBtn');
  if (!retryBtn) return;
  retryBtn.addEventListener('click', () => {
    window.location.reload();
  });
}

function setupNetworkStateLogger() {
  Network.addListener('networkStatusChange', (status) => {
    console.log('[shell] networkStatusChange', status.connected, status.connectionType);
  });
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
    console.log('[shell] Press back again to exit');
  });
}

setupOfflineRetry();
setupNetworkStateLogger();
setupAndroidBackHandler();
