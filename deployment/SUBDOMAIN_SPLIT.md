# Subdomain Split — Deployment Guide

> **Date:** June 2025
> **Summary:** The project is now split into two subdomains served by a **single Django application**.

| Subdomain | Purpose | URL Conf |
|---|---|---|
| `www.adarshbhopal.in` | Public website (landing page, portfolio, testimonials, SEO) | `config.urls_website` |
| `panel.adarshbhopal.in` | Admin panel, PWA mobile app, Django admin, all management APIs | `config.urls_panel` |

Local development continues to work on a single `localhost:8000` with **all routes** (`config.urls`).

---

## How It Works

### Middleware-Based Routing

A new **`SubdomainRoutingMiddleware`** (in `core/middleware.py`) inspects the `Host` header on every request and sets `request.urlconf` to the appropriate URL configuration:

```
Host: www.adarshbhopal.in   → request.urlconf = 'config.urls_website'
Host: panel.adarshbhopal.in → request.urlconf = 'config.urls_panel'
Host: localhost:8000         → default ROOT_URLCONF = 'config.urls' (all routes)
```

This means:
- **One Gunicorn process** serves both domains.
- **One database**, one media directory, one static files directory.
- The middleware is the **first** in the `MIDDLEWARE` list so all downstream middleware see the correct URL conf.

---

## Files Changed

### New Files
| File | Purpose |
|---|---|
| `config/urls_website.py` | URL conf for `www` — public website routes + SEO + public media |
| `config/urls_panel.py` | URL conf for `panel` — admin panel + PWA + Django admin + protected media |
| `deployment/SUBDOMAIN_SPLIT.md` | This file |

### Modified Files
| File | Change |
|---|---|
| `core/middleware.py` | Added `SubdomainRoutingMiddleware` class |
| `config/settings.py` | Added `WEBSITE_DOMAIN`, `PANEL_DOMAIN`, `WEBSITE_URL`, `PANEL_URL` env vars; added middleware to `MIDDLEWARE` list; added `SESSION_COOKIE_DOMAIN` support |
| `core/context_processors.py` | Injects `PANEL_URL` and `WEBSITE_URL` into all template contexts |
| `.env.example` | Added new env vars (`WEBSITE_DOMAIN`, `PANEL_DOMAIN`, `CSRF_TRUSTED_ORIGINS` updated, etc.) |
| `templates/website/base.html` | Login button now uses `{{ PANEL_URL }}` for cross-domain link |
| `templates/website/offline.html` | Admin panel link now uses `{{ PANEL_URL }}` for cross-domain link |

---

## Environment Variables

Add these to your `.env` file on the server:

```bash
# --- Subdomain Routing (REQUIRED for split) ---
WEBSITE_DOMAIN=www.adarshbhopal.in
PANEL_DOMAIN=panel.adarshbhopal.in

# --- Update existing vars ---
ALLOWED_HOSTS=adarshbhopal.in,www.adarshbhopal.in,panel.adarshbhopal.in
CSRF_TRUSTED_ORIGINS=https://adarshbhopal.in,https://www.adarshbhopal.in,https://panel.adarshbhopal.in
SITE_URL=https://www.adarshbhopal.in

# --- Optional: Cross-subdomain sessions ---
# Only needed if login on panel.* should also authenticate on www.*
# SESSION_COOKIE_DOMAIN=.adarshbhopal.in
```

### Quick Check — Local Development
Leave `WEBSITE_DOMAIN` and `PANEL_DOMAIN` empty (or don't set them). All routes will be available on `localhost:8000` as before.

---

## Server Setup

### 1. DNS Records

Add two A records pointing to your server IP:

```
www.adarshbhopal.in     A    <server-ip>
panel.adarshbhopal.in   A    <server-ip>
```

If you also want `adarshbhopal.in` (no www) to work, add:

```
adarshbhopal.in         A    <server-ip>
```

### 2. SSL Certificates (Certbot)

```bash
# Install certbot if not already installed
sudo apt install certbot python3-certbot-nginx

# Get certificates for both subdomains
sudo certbot --nginx -d www.adarshbhopal.in -d panel.adarshbhopal.in -d adarshbhopal.in
```

### 3. Nginx Configuration

You need **one upstream** and **two server blocks**. See `deployment/nginx_subdomain_example.conf` for a complete example. Key structure:

```nginx
upstream django_app {
    server 127.0.0.1:8000;
    keepalive 32;
}

# Public website
server {
    listen 443 ssl http2;
    server_name www.adarshbhopal.in adarshbhopal.in;
    # ... static, public media, proxy to django_app ...
}

# Admin panel
server {
    listen 443 ssl http2;
    server_name panel.adarshbhopal.in;
    # ... static, all media (with internal for protected dirs), proxy to django_app ...
}

# HTTP → HTTPS redirect
server {
    listen 80;
    server_name www.adarshbhopal.in panel.adarshbhopal.in adarshbhopal.in;
    return 301 https://$host$request_uri;
}
```

**Important Nginx notes:**
- Both server blocks proxy to the **same Gunicorn upstream** (single Django app).
- The `Host` header is passed through (`proxy_set_header Host $host`), which is how `SubdomainRoutingMiddleware` knows which domain the request is for.
- The panel server block needs the long timeouts (600s) and large `client_max_body_size` for bulk uploads.
- The website server block can have smaller timeouts and body size limits.

### 4. Gunicorn

No changes needed. Same single Gunicorn process:

```bash
gunicorn config.wsgi:application --bind 127.0.0.1:8000 --workers 2
```

### 5. Update `.env` on Server

```bash
cd /path/to/project
nano .env
# Add the new env vars as shown above
```

### 6. Restart Services

```bash
sudo systemctl restart gunicorn
sudo systemctl reload nginx
```

---

## Route Summary

### www.adarshbhopal.in (Public Website)

| Path | Description |
|---|---|
| `/` | Home page |
| `/our-work/` | Portfolio / Products page |
| `/why-choose-us/` | Why Choose Us page |
| `/testimonials/` | Testimonials page |
| `/privacy-policy/` | Privacy Policy |
| `/submit-contact/` | Contact form (AJAX) |
| `/submit-testimonial/` | Testimonial form (AJAX) |
| `/api/reels/` | Load more reels (AJAX) |
| `/robots.txt` | SEO robots |
| `/sitemap.xml` | SEO sitemap |
| `/media/adarshimg/*` | Public media (logo, hero images) |
| `/media/images/*` | Public media (portfolio images) |

### panel.adarshbhopal.in (Admin Panel)

| Path | Description |
|---|---|
| `/panel/` | Dashboard (redirects based on role) |
| `/panel/auth/login/` | Login page |
| `/panel/auth/logout/` | Logout |
| `/panel/client/...` | Client management APIs |
| `/panel/staff/...` | Staff management |
| `/panel/exports/...` | Export management |
| `/panel/images/...` | Media file management |
| `/panel/work/...` | Workflow management |
| `/panel/website/...` | Website content admin |
| `/app/` | PWA mobile app |
| `/admin/` | Django admin site |
| `/media/*` | All media (protected dirs require auth) |

---

## Rollback

To revert to single-domain mode:

1. Remove `WEBSITE_DOMAIN` and `PANEL_DOMAIN` from `.env` (or set them to empty strings).
2. The middleware will detect no domains are configured and skip routing.
3. All routes will be served on every domain via `config.urls`.
4. Revert Nginx to a single server block if needed.

No code changes required — the split is entirely controlled by environment variables.

---

## Troubleshooting

| Issue | Solution |
|---|---|
| `NoReverseMatch` for `accounts:login` on website | The Login button in website templates now uses `{{ PANEL_URL }}` — make sure `PANEL_DOMAIN` is set in `.env` |
| 404 on `panel.adarshbhopal.in/` | The panel's root is `/panel/`, not `/`. Users should go to `/panel/` or `/panel/auth/login/` |
| Sessions not shared across subdomains | Set `SESSION_COOKIE_DOMAIN=.adarshbhopal.in` in `.env` (note the leading dot) |
| CSRF errors on panel | Ensure `https://panel.adarshbhopal.in` is in `CSRF_TRUSTED_ORIGINS` |
| Static files not loading | Both subdomains serve static files via WhiteNoise — ensure `collectstatic` was run |
| Media files 404 on website | Only `adarshimg/` and `images/` are served on the website domain. Other media dirs are panel-only. |
