/**
 * API client for the Adarsh Django backend.
 * Manages CSRF tokens, session cookies, and base URL.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

// ─── Configuration ───────────────────────────────────────────────────────────
export const BASE_URL = 'https://panel.adarshbhopal.in';

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
  const url = `${BASE_URL}${path}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = {
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'AdarshMobileApp/1.1 (Premium Native; Expo)',
    'Bypass-Tunnel-Reminder': 'true',
    ...(options.headers || {}),
  };

  // Always attach CSRF for mutations when available.
  // The backend CSRF bypass middleware already exempts /app/api/ paths,
  // but sending it when we have it is strictly safer.
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

export async function apiGet(path, params = null) {
  try {
    let finalPath = path;
    if (params && Object.keys(params).length > 0) {
      const query = Object.entries(params)
        .filter(([_, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      if (query) {
        finalPath += (finalPath.includes('?') ? '&' : '?') + query;
      }
    }

    const response = await apiFetch(finalPath);
    const text = await response.text();
    
    if (response.status === 503) {
      return { ok: false, status: 503, data: { success: false, message: 'Server tunnel is currently unavailable. Please try again in a moment.' } };
    }

    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[API] JSON Parse Error for path:', finalPath, 'Response:', text.substring(0, 100));
      return { ok: false, status: response.status, data: { success: false, message: response.ok ? 'Invalid server response' : 'Server error (' + response.status + ')' } };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    console.warn('[API] Fetch Error for path:', path, e);
    return { ok: false, status: 0, data: { success: false, message: e.message?.includes('Network') ? 'Connection failed. Check your internet.' : (e.message || 'Network error') } };
  }
}

export async function apiPost(path, body = {}) {
  try {
    const response = await apiFetch(path, {
      method: 'POST',
      json: body,
    });
    const text = await response.text();

    if (response.status === 503) {
      return { ok: false, status: 503, data: { success: false, message: 'Server tunnel is currently unavailable.' } };
    }

    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[API] JSON Parse Error for POST path:', path, 'Response:', text.substring(0, 100));
      return { ok: false, status: response.status, data: { success: false, message: response.ok ? 'Invalid server response' : 'Server error (' + response.status + ')' } };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    console.warn('[API] Fetch Error for POST path:', path, e);
    return { ok: false, status: 0, data: { success: false, message: e.message || 'Network error' } };
  }
}

export async function apiPostForm(path, formData, extraHeaders = {}) {
  try {
    const response = await apiFetch(path, {
      method: 'POST',
      body: formData,
      headers: extraHeaders,
    });
    const text = await response.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[API] JSON Parse Error for form POST:', path);
      return { ok: false, status: response.status, data: { message: 'Invalid server response' } };
    }
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    console.warn('[API] Fetch Error for form POST:', path, e);
    return { ok: false, status: 0, data: { message: e.message || 'Network error' } };
  }
}

/**
 * Fetches the CSRF token by hitting the login page.
 * Call this before the first login attempt.
 */
export async function fetchInitialCsrf() {
  try {
    // Clear any stale cookies before fetching a fresh token
    await clearAuth();
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
