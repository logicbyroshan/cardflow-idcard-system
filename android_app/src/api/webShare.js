/**
 * API client to communicate with the public Adarsh landing website.
 * Fetches portfolio categories, products, and active client lists.
 */

const WEB_SHARE_BASE_URL = process.env.EXPO_PUBLIC_WEB_SHARE_BASE_URL || 'https://www.adarshbhopal.in';
const API_KEY = process.env.EXPO_PUBLIC_WEB_SHARE_API_KEY || 'adarsh_secure_fallback_key_2026_web_app';

/**
 * Common fetch utility with API key authentication header.
 */
async function webShareFetch(path) {
  const url = `${WEB_SHARE_BASE_URL}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-API-KEY': API_KEY,
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[WebShare API] Fetch failed for path: ${path}`, error);
    return { 
      ok: false, 
      error: error.message || 'Network request failed' 
    };
  }
}

/**
 * Fetch all active categories along with nested active products (images & videos).
 */
export async function fetchPortfolio() {
  return await webShareFetch('/api/web-share/portfolio/');
}

/**
 * Fetch website client logo profiles, visibility flags, ordering, and card counts.
 */
export async function fetchClients() {
  return await webShareFetch('/api/web-share/clients/');
}
