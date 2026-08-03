/**
 * API client for the Adarsh Django backend.
 * Manages CSRF tokens, session cookies, and base URL.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// ─── Configuration ───────────────────────────────────────────────────────────
// Allow overriding BASE_URL via Expo constants (`expo publish` extra) or global for tests
export const BASE_URL = (
  process.env.EXPO_PUBLIC_API_URL ||
  (Constants?.expoConfig?.extra && Constants.expoConfig.extra.API_BASE_URL) ||
  'https://www.adarshbhopal.in'
);

const STORAGE_KEYS = {
  csrfToken: 'adarsh_csrf_token',
  sessionId: 'adarsh_session_id',
  cookies: 'adarsh_cookies',
};

// ─── Global session kicked callback ──────────────────────────────────────────
let onSessionKickedCallback = null;

export function registerSessionKickedCallback(cb) {
  onSessionKickedCallback = cb;
}


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
  const url = path.startsWith('http') ? path : `${BASE_URL}${path}`;
  const method = (options.method || 'GET').toUpperCase();

  const headers = {
    'Accept': 'application/json',
    'X-Requested-With': 'XMLHttpRequest',
    'User-Agent': 'AdarshMobileApp/1.1 (Premium Native; Expo)',
    ...(options.headers || {}),
  };

  // Always attach CSRF for mutations when available.
  // The backend CSRF bypass middleware already exempts /api/mobile/ paths,
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

  // Support timeout via AbortController
  const timeout = typeof options.timeout === 'number' ? options.timeout : 15000;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: options.body,
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Request timed out');
    throw e;
  } finally {
    clearTimeout(id);
  }

  // Try to persist cookies/csrf when possible
  try { await saveCookiesFromResponse(response); } catch (e) { /* non-fatal */ }

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

    // Simple retry for GETs on transient failures
    let attempt = 0;
    let response;
    let text = '';
    while (attempt < 2) {
      try {
        response = await apiFetch(finalPath, { timeout: 15000 });
        text = await response.text();
        break;
      } catch (e) {
        attempt += 1;
        if (attempt >= 2) throw e;
        // small backoff
        await new Promise(r => setTimeout(r, 300 * attempt));
      }
    }
    
    if (response.status === 503) {
      return { ok: false, status: 503, data: { success: false, message: 'Server is currently unreachable. This may be due to high traffic or maintenance. Please try again later.' } };
    }

    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[API] JSON Parse Error for path:', finalPath, 'Response:', text.substring(0, 100));
      return { 
        ok: false, 
        status: response.status, 
        data: { 
          success: false, 
          message: response.ok ? 'Invalid server response' : 'Server encountered an issue (' + response.status + ')' 
        } 
      };
    }

    if (!response.ok) {
      if (response.status === 401 && data?.logged_in_elsewhere && onSessionKickedCallback) {
        onSessionKickedCallback();
      }
      return { 
        ok: false, 
        status: response.status, 
        data: { 
          success: false, 
          message: data.message || 'Server error (' + response.status + ')' 
        } 
      };
    }

    // Fallback: some mobile endpoints may return CSRF/token in JSON for native clients
    try {
      const maybeToken = data?.csrftoken || data?.csrf || data?.csrf_token || data?.data?.csrftoken || data?.data?.csrf_token;
      if (maybeToken) {
        cachedCsrf = maybeToken;
        AsyncStorage.setItem(STORAGE_KEYS.csrfToken, cachedCsrf).catch(() => {});
      }
    } catch (e) {}
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    console.warn('[API] Fetch Error for path:', path, e);
    const isNetwork = e.message?.toLowerCase().includes('network') || e.message?.toLowerCase().includes('failed to fetch');
    return { ok: false, status: 0, data: { success: false, message: isNetwork ? 'Connection failed. Please check your internet and try again.' : (e.message || 'An unexpected error occurred') } };
  }
}

export async function apiPost(path, body = {}) {
  try {
    const response = await apiFetch(path, {
      method: 'POST',
      json: body,
      timeout: 20000,
    });
    const text = await response.text();

    if (response.status === 503) {
      return { ok: false, status: 503, data: { success: false, message: 'Server is currently unavailable. Please try again soon.' } };
    }

    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('[API] JSON Parse Error for POST path:', path, 'Response:', text.substring(0, 100));
      return { 
        ok: false, 
        status: response.status, 
        data: { 
          success: false, 
          message: response.ok ? 'Invalid response' : 'Server error (' + response.status + ')' 
        } 
      };
    }

    if (!response.ok) {
      if (response.status === 401 && data?.logged_in_elsewhere && onSessionKickedCallback) {
        onSessionKickedCallback();
      }
      return { 
        ok: false, 
        status: response.status, 
        data: { 
          success: false, 
          message: data.message || 'Server error (' + response.status + ')' 
        } 
      };
    }

    // Fallback: capture CSRF returned in JSON
    try {
      const maybeToken = data?.csrftoken || data?.csrf || data?.csrf_token || data?.data?.csrftoken || data?.data?.csrf_token;
      if (maybeToken) {
        cachedCsrf = maybeToken;
        AsyncStorage.setItem(STORAGE_KEYS.csrfToken, cachedCsrf).catch(() => {});
      }
    } catch (e) {}
    return { ok: response.ok, status: response.status, data };
  } catch (e) {
    console.warn('[API] Fetch Error for POST path:', path, e);
    return { ok: false, status: 0, data: { success: false, message: 'Network connection error' } };
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
      if (response.status === 401 && data?.logged_in_elsewhere && onSessionKickedCallback) {
        onSessionKickedCallback();
      }
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
    const response = await apiFetch('/api/mobile/server-info/', { method: 'GET' });
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

export function getSessionCookies() {
  return cachedCookies;
}

export function resolveAdarshImageUrl(val) {
  const url = String(val || '').trim();
  if (!url || url === 'NOT_FOUND' || url === 'null' || url === 'undefined') {
    return '';
  }
  if (url.startsWith('file://') || url.startsWith('content://') || url.startsWith('data:image')) {
    return url;
  }
  
  // 1. If it contains /media/ or media/
  if (url.includes('/media/')) {
    const idx = url.indexOf('/media/');
    return `${BASE_URL}${url.substring(idx)}`;
  }
  if (url.includes('media/')) {
    const idx = url.indexOf('media/');
    return `${BASE_URL}/${url.substring(idx)}`;
  }

  // 2. If it is a static asset url
  if (url.includes('/static/')) {
    const idx = url.indexOf('/static/');
    return `${BASE_URL}${url.substring(idx)}`;
  }
  if (url.includes('static/')) {
    const idx = url.indexOf('static/');
    return `${BASE_URL}/${url.substring(idx)}`;
  }

  // 3. If it starts with http/https but does not have /media/ or /static/
  if (url.startsWith('http')) {
    return url;
  }

  // 4. Otherwise, treat it as a relative media path (e.g., adarshimg/..., clients_imgs/...)
  const cleanPath = url.startsWith('/') ? url.substring(1) : url;
  return `${BASE_URL}/media/${cleanPath}`;
}

