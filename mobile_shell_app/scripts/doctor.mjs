import { config as loadEnv } from 'dotenv';

loadEnv();

const required = ['APP_NAME', 'APP_ID', 'PWA_URL'];
let hasError = false;
const useDevUrl = (process.env.CAP_SHELL_USE_DEV_URL || '').trim() === '1';

for (const key of required) {
  const value = process.env[key];
  if (!value || !value.trim()) {
    hasError = true;
    console.error(`[doctor] Missing ${key} in .env`);
  }
}

const pwaUrl = process.env.PWA_URL || '';
if (pwaUrl && !/^https:\/\//i.test(pwaUrl)) {
  hasError = true;
  console.error('[doctor] PWA_URL must be HTTPS for production builds.');
}

if (useDevUrl) {
  const pwaDevUrl = process.env.PWA_DEV_URL || '';
  if (!pwaDevUrl.trim()) {
    hasError = true;
    console.error('[doctor] CAP_SHELL_USE_DEV_URL=1 requires PWA_DEV_URL.');
  }
  if (pwaDevUrl && !/^https?:\/\//i.test(pwaDevUrl)) {
    hasError = true;
    console.error('[doctor] PWA_DEV_URL must start with http:// or https://.');
  }
}

if (!hasError) {
  console.log('[doctor] Environment looks good for app-shell build.');
}

process.exit(hasError ? 1 : 0);
