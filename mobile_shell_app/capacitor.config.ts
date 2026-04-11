import type { CapacitorConfig } from '@capacitor/cli';
import { config as loadEnv } from 'dotenv';

loadEnv();

const appName = process.env.APP_NAME || 'Adarsh Panel';
const appId = process.env.APP_ID || 'in.adarshbhopal.panel1804';
const pwaUrl = process.env.PWA_URL || 'https://panel.adarshbhopal.in/app/';
const pwaDevUrl = process.env.PWA_DEV_URL || '';
const useDevUrl = (process.env.CAP_SHELL_USE_DEV_URL || '').trim() === '1';
const activeUrl = useDevUrl && pwaDevUrl ? pwaDevUrl : pwaUrl;
const androidScheme = process.env.ANDROID_SCHEME || 'https';

const allowNavigation = [pwaUrl, pwaDevUrl]
  .filter(Boolean)
  .map((raw) => {
    try {
      return new URL(raw).host;
    } catch {
      return '';
    }
  })
  .filter(Boolean);

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: 'www',
  server: {
    url: activeUrl,
    cleartext: false,
    androidScheme,
    allowNavigation,
    errorPath: 'offline.html'
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      backgroundColor: '#0f172a',
      launchAutoHide: true,
      androidScaleType: 'CENTER_CROP',
      showSpinner: false
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#ffffff'
    }
  }
};

export default config;
