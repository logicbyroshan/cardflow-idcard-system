/**
 * API client for the Adarsh Django backend.
 * Manages CSRF tokens, session cookies, and base URL.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Configuration ───────────────────────────────────────────────────────────
const BASE_URL = 'https://panel.adarshbhopal.in';

const STORAGE_KEYS = {
  csrfToken: 'adarsh_csrf_token',
  sessionId: 'adarsh_session_id',
  cookies: 'adarsh_cookies',
};

// ─── Cookie/CSRF Management ─────────────────────────────────────────────────

let cachedCsrf = '';
let cachedCookies = '';

export async function loadStoredAuth() {
  try {
    const [csrf, cookies] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.csrfToken),
      AsyncStorage.getItem(STORAGE_KEYS.cookies),
    ]);
    cachedCsrf = csrf || '';
    cachedCookies = cookies || '';
  } catch (e) {
    // silent
  }
}

async function saveCookiesFromResponse(response) {
  try {
    const setCookie = response.headers.get('set-cookie');
    if (!setCookie) return;

    // Parse and merge cookies
    const newCookies = {};
    // Parse existing
    if (cachedCookies) {
      cachedCookies.split('; ').forEach(pair => {
        const [k, ...rest] = pair.split('=');
        if (k) newCookies[k.trim()] = rest.join('=');
      });
    }
    // Parse from response (may be multiple headers joined by comma)
    const parts = setCookie.split(/,(?=\s*\w+=)/);
    parts.forEach(part => {
      const cookie = part.trim().split(';')[0];
      const [k, ...rest] = cookie.split('=');
      if (k) {
        newCookies[k.trim()] = rest.join('=');
        if (k.trim() === 'csrftoken') {
          cachedCsrf = rest.join('=');
          AsyncStorage.setItem(STORAGE_KEYS.csrfToken, cachedCsrf).catch(() => {});
        }
      }
    });

    cachedCookies = Object.entries(newCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    await AsyncStorage.setItem(STORAGE_KEYS.cookies, cachedCookies);
  } catch (e) {
    // silent
  }
}

// ─── Core Fetch Wrapper ─────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = {
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    ...(options.headers || {}),
  };

  // Attach CSRF for mutations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && cachedCsrf) {
    headers['X-CSRFToken'] = cachedCsrf;
  }

  // Attach cookies
  if (cachedCookies) {
    headers['Cookie'] = cachedCookies;
  }

  // JSON body
  if (options.json && !options.body) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: options.body,
    credentials: 'include',
  });

  await saveCookiesFromResponse(response);

  return response;
}

// ─── Public API Methods ─────────────────────────────────────────────────────

export async function apiGet(path) {
  const response = await apiFetch(path);
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

export async function apiPost(path, body = {}) {
  const response = await apiFetch(path, {
    method: 'POST',
    json: body,
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

export async function apiPostForm(path, formData, extraHeaders = {}) {
  const response = await apiFetch(path, {
    method: 'POST',
    body: formData,
    headers: extraHeaders,
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

/**
 * Fetches the CSRF token by hitting the login page.
 * Call this before the first login attempt.
 */
export async function fetchInitialCsrf() {
  try {
    const response = await apiFetch('/app/login/', { method: 'GET' });
    await saveCookiesFromResponse(response);
    return !!cachedCsrf;
  } catch (e) {
    return false;
  }
}

export async function clearAuth() {
  cachedCsrf = '';
  cachedCookies = '';
  await AsyncStorage.multiRemove([
    STORAGE_KEYS.csrfToken,
    STORAGE_KEYS.sessionId,
    STORAGE_KEYS.cookies,
  ]);
}

export { BASE_URL };
