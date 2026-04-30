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
    // Note: React Native's fetch might join multiple Set-Cookie headers with a comma.
    // We use a more robust split that avoids splitting on commas inside dates (e.g., "expires=Mon, 01-Jan-2024").
    const parts = setCookie.split(/,(?=\s*[\w-]+=)/);
    
    parts.forEach(part => {
      const cookieTrimmed = part.trim();
      if (!cookieTrimmed) return;
      
      const cookie = cookieTrimmed.split(';')[0];
      const [k, ...rest] = cookie.split('=');
      if (k) {
        const key = k.trim();
        const value = rest.join('=');
        newCookies[key] = value;
        
        if (key === 'csrftoken') {
          cachedCsrf = value;
          AsyncStorage.setItem(STORAGE_KEYS.csrfToken, cachedCsrf).catch(() => {});
        }
      }
    });

    cachedCookies = Object.entries(newCookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
    await AsyncStorage.setItem(STORAGE_KEYS.cookies, cachedCookies);
  } catch (e) {
    console.warn('[API] Cookie save error:', e);
  }
}

// ─── Core Fetch Wrapper ─────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  // Ensure path has a trailing slash for Django
  let normalizedPath = path;
  if (!normalizedPath.endsWith('/') && !normalizedPath.includes('?')) {
    normalizedPath += '/';
  } else if (normalizedPath.includes('?') && !normalizedPath.split('?')[0].endsWith('/')) {
    const [baseUrl, query] = normalizedPath.split('?');
    normalizedPath = `${baseUrl}/?${query}`;
  }

  const url = `${BASE_URL}${normalizedPath}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = {
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'AdarshMobileApp/1.1 (Premium Native; Expo)',
    ...(options.headers || {}),
  };

  // Attach CSRF for mutations — SKIP for auth paths as they are exempt on backend
  const isAuth = normalizedPath.includes('/auth/') || normalizedPath.includes('/login');
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && cachedCsrf && !isAuth) {
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

export async function apiGet(path) {
  try {
    const response = await apiFetch(path);
    const text = await response.text();
    if (!text) return { ok: response.ok, status: response.status, data: {} };
    
    try {
      const data = JSON.parse(text);
      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      console.warn(`[API] JSON Parse Error for path: ${path} | Response: ${response.status} - ${text.slice(0, 100)}`);
      return { ok: false, status: response.status, data: { message: `Server error (${response.status}) - Invalid Response` } };
    }
  } catch (e) {
    console.error(`[API] Connection Error for path: ${path}`, e);
    return { ok: false, status: 0, data: { message: 'Connection failed' } };
  }
}

export async function apiPost(path, body = {}) {
  try {
    const response = await apiFetch(path, { method: 'POST', json: body });
    const text = await response.text();
    if (!text) return { ok: response.ok, status: response.status, data: {} };

    try {
      const data = JSON.parse(text);
      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      console.warn(`[API] JSON Parse Error for path: ${path} | Response: ${response.status} - ${text.slice(0, 100)}`);
      return { ok: false, status: response.status, data: { message: `Server error (${response.status}) - Invalid Response` } };
    }
  } catch (e) {
    console.error(`[API] Connection Error for path: ${path}`, e);
    return { ok: false, status: 0, data: { message: 'Connection failed' } };
  }
}

export async function apiPostForm(path, formData, extraHeaders = {}) {
  try {
    const response = await apiFetch(path, { method: 'POST', body: formData, headers: extraHeaders });
    const text = await response.text();
    if (!text) return { ok: response.ok, status: response.status, data: {} };

    try {
      const data = JSON.parse(text);
      return { ok: response.ok, status: response.status, data };
    } catch (e) {
      console.warn(`[API] JSON Parse Error for path: ${path} | Response: ${response.status} - ${text.slice(0, 100)}`);
      return { ok: false, status: response.status, data: { message: `Server error (${response.status}) - Invalid Response` } };
    }
  } catch (e) {
    console.error(`[API] Connection Error for path: ${path}`, e);
    return { ok: false, status: 0, data: { message: 'Connection failed' } };
  }
}


/**
 * Fetches the CSRF token by hitting the login page.
 * Call this before the first login attempt.
 */
export async function fetchInitialCsrf() {
  try {
    // Only clear auth if we don't have a CSRF token yet, and only AFTER successful fetch
    const response = await apiFetch('/app/login/', { method: 'GET' });
    await saveCookiesFromResponse(response);
    
    // Only clear stale data after successful response
    if (cachedCsrf) {
      // Fresh token obtained, safe to clear old data
      cachedCookies = '';
      await AsyncStorage.removeItem(STORAGE_KEYS.cookies);
    }
    return !!cachedCsrf;
  } catch (e) {
    // Network error — keep existing cached CSRF/cookies so user can retry
    console.warn('[API] fetchInitialCsrf error:', e);
    return !!cachedCsrf;
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
