import { config as loadEnv } from 'dotenv';

loadEnv();

const required = ['APP_NAME', 'APP_ID', 'PWA_URL'];
let hasError = false;

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

if (!hasError) {
  console.log('[doctor] Environment looks good for app-shell build.');
}

process.exit(hasError ? 1 : 0);
