import type { CapacitorConfig } from '@capacitor/cli';
import { config as loadEnv } from 'dotenv';

loadEnv();

const appName = process.env.APP_NAME || 'Adarsh Panel';
const appId = process.env.APP_ID || 'in.adarshbhopal.panel1804';
const pwaUrl = process.env.PWA_URL || 'https://panel.adarshbhopal.in/app/';
const androidScheme = process.env.ANDROID_SCHEME || 'https';

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: 'www',
  server: {
    url: pwaUrl,
    cleartext: false,
    androidScheme,
    allowNavigation: [
      'panel.adarshbhopal.in',
      'adarshbhopal.in'
    ],
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
