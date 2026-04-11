
from pathlib import Path
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured
import os
import dj_database_url

# Load environment variables from .env file (if exists)
load_dotenv()

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# =============================================================================
# CORE SETTINGS
# =============================================================================

# SECURITY: SECRET_KEY must always come from .env — no hardcoded fallback.
# Generate one with: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
SECRET_KEY = os.getenv('SECRET_KEY')
if not SECRET_KEY:
    raise ImproperlyConfigured(
        'SECRET_KEY is not set. Add it to your .env file. '
        'Generate one with: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"'
    )
# In production, enforce a minimum key length (Django requires 50+ chars)
if not os.getenv('DEBUG', 'False').lower() in ('true', '1', 'yes'):
    if len(SECRET_KEY) < 50:
        raise ImproperlyConfigured(
            f'SECRET_KEY is too short ({len(SECRET_KEY)} chars). '
            'Generate a proper key: python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"'
        )

# SECURITY WARNING: don't run with debug turned on in production!
# Safe default: False — must explicitly opt-in to DEBUG mode
DEBUG = os.getenv('DEBUG', 'False').lower() in ('true', '1', 'yes')


def _env_bool(name: str, default: bool = False) -> bool:
    """Read boolean-like environment variables safely."""
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in ('1', 'true', 'yes', 'on')

# Allowed Hosts
# In DEBUG mode, default to localhost hosts only. Override via DEBUG_ALLOWED_HOSTS.
if DEBUG:
    _debug_hosts = os.getenv('DEBUG_ALLOWED_HOSTS', '127.0.0.1,localhost,testserver')
    ALLOWED_HOSTS = [
        host.strip()
        for host in _debug_hosts.split(',')
        if host.strip()
    ]
    if not ALLOWED_HOSTS:
        ALLOWED_HOSTS = ['127.0.0.1', 'localhost', 'testserver']
else:
    ALLOWED_HOSTS = [
        host.strip()
        for host in os.getenv('ALLOWED_HOSTS', '').split(',')
        if host.strip()
    ]
    if not ALLOWED_HOSTS:
        raise ImproperlyConfigured(
            'ALLOWED_HOSTS is not set. Add comma-separated hostnames to your .env file.'
        )


# =============================================================================
# SUBDOMAIN ROUTING
# When both are set, SubdomainRoutingMiddleware splits traffic:
#   WEBSITE_DOMAIN → config.urls_website  (public site only)
#   PANEL_DOMAIN   → config.urls_panel    (admin panel + PWA)
# In local dev, leave both blank to serve everything on one domain.
# =============================================================================
WEBSITE_DOMAIN = os.getenv('WEBSITE_DOMAIN', '').strip()   # e.g. www.adarshbhopal.in
PANEL_DOMAIN = os.getenv('PANEL_DOMAIN', '').strip()       # e.g. panel.adarshbhopal.in

# Convenience URLs for templates / email links
WEBSITE_URL = os.getenv('WEBSITE_URL', '').rstrip('/') or (
    f'https://{WEBSITE_DOMAIN}' if WEBSITE_DOMAIN else ''
)
PANEL_URL = os.getenv('PANEL_URL', '').rstrip('/') or (
    f'https://{PANEL_DOMAIN}' if PANEL_DOMAIN else ''
)


# =============================================================================
# APPLICATION DEFINITION
# =============================================================================

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'core',
    'accounts',
    'client',
    'exports',
    'mediafiles',
    'staff',
    'idcards',
    'website',
    'cardprint',
    'reprintcard',
    'mobile_app',
    'panel',
]

# Custom User Model - Keep pointing to core.User for database compatibility
# The User class is defined in accounts but re-exported from core for migrations
AUTH_USER_MODEL = 'core.User'

MIDDLEWARE = [
    # Subdomain routing — sets request.urlconf based on Host header
    # MUST be first so all downstream middleware see the correct URL conf
    'core.middleware.SubdomainRoutingMiddleware',
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    # Messages MUST be before custom middleware so force-logout redirects
    # can attach messages that are visible on the landing page.
    'django.contrib.messages.middleware.MessageMiddleware',
    # Request timing — logs duration, slow-request warnings (>1.5 s)
    'core.middleware.RequestTimingMiddleware',
    # Panel entry gate — require website panel-button flow for anonymous panel access
    'core.middleware.PanelEntryGateMiddleware',
    # Permission Validation Middleware - re-checks permissions on every request
    # CRITICAL: Must come after AuthenticationMiddleware
    'core.middleware.PermissionValidationMiddleware',
    # RoleScopingMiddleware removed — deprecated, scoping merged into PermissionValidationMiddleware
    # Session idle timeout — logs out after SESSION_IDLE_TIMEOUT of inactivity
    'core.middleware.SessionIdleTimeoutMiddleware',
    # Security headers — Permissions-Policy, Cache-Control
    'core.middleware.SecurityHeadersMiddleware',
    # Maintenance mode — blocks panel for non-superadmin when enabled
    'core.middleware.MaintenanceModeMiddleware',
    # Website Offline Middleware — blocks public site when status is 'draft'
    'core.middleware.WebsiteOfflineMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
                'core.context_processors.permissions',  # Permission-based UI visibility
                'mobile_app.context_processors.mobile_globals',  # PWA notification count + admin stats
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'


# =============================================================================
# DATABASE
# https://docs.djangoproject.com/en/5.2/ref/settings/#databases
# =============================================================================

# Production: Set DATABASE_URL in .env
# Example DATABASE_URL: postgres://user:password@host:5432/dbname

DATABASE_URL = os.getenv('DATABASE_URL')

if DATABASE_URL:
    # Production / Staging: Use DATABASE_URL (PostgreSQL, MySQL, etc.)
    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
elif DEBUG:
    # Local development only: Use SQLite (no setup needed)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
            'OPTIONS': {
                'timeout': 60,  # Wait up to 60s for DB lock (background bulk writes can be slow)
            },
        }
    }
else:
    raise ImproperlyConfigured(
        'DATABASE_URL is not set. Add it to your .env file for production. '
        'Example: DATABASE_URL=postgres://user:password@host:5432/dbname'
    )


# =============================================================================
# SECURITY SETTINGS
# =============================================================================

# CSRF Trusted Origins
# Local: Not needed | Production: Add your domains
# Auto-configure for Render deployment
_csrf_origins = os.getenv('CSRF_TRUSTED_ORIGINS', '')
CSRF_TRUSTED_ORIGINS = [
    origin.strip() 
    for origin in _csrf_origins.split(',') 
    if origin.strip()
]

# Auto-add Render domain if RENDER_EXTERNAL_HOSTNAME is set
render_hostname = os.getenv('RENDER_EXTERNAL_HOSTNAME')
if render_hostname:
    render_url = f'https://{render_hostname}'
    if render_url not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(render_url)

# Auto-add PANEL_DOMAIN and WEBSITE_DOMAIN to CSRF_TRUSTED_ORIGINS
# so that CSRF works even if the env var is not explicitly set.
for _domain in (PANEL_DOMAIN, WEBSITE_DOMAIN):
    if _domain:
        for _scheme in ('https', 'http'):
            _origin = f'{_scheme}://{_domain}'
            if _origin not in CSRF_TRUSTED_ORIGINS:
                CSRF_TRUSTED_ORIGINS.append(_origin)

# Use the same branded error page for CSRF failures (403).
CSRF_FAILURE_VIEW = 'core.views.errors.csrf_failure'

# ── Reverse-proxy SSL detection ──
# MUST be set whenever Django is behind Nginx/Apache that terminates SSL,
# REGARDLESS of DEBUG. Without this, Django thinks requests arrive over HTTP
# and CSRF origin checks fail (Origin says https:// but Django expects http://).
# This is configured outside the "if not DEBUG" block on purpose.
SECURE_PROXY_SSL_HEADER = (
    os.getenv('SECURE_PROXY_SSL_HEADER_NAME', 'HTTP_X_FORWARDED_PROTO'),
    os.getenv('SECURE_PROXY_SSL_HEADER_VALUE', 'https'),
) if os.getenv('SECURE_PROXY_SSL_HEADER_NAME', 'HTTP_X_FORWARDED_PROTO') else None

# Production security settings (only when DEBUG=False)
if not DEBUG:
    # HTTPS settings
    SECURE_SSL_REDIRECT = os.getenv('SECURE_SSL_REDIRECT', 'True').lower() in ('true', '1', 'yes')
    
    # Cookie security
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    
    # HSTS settings
    SECURE_HSTS_SECONDS = 31536000  # 1 year
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True

# ── Security headers (always applied, both dev and prod) ──
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SECURE_REFERRER_POLICY = 'strict-origin-when-cross-origin'
SECURE_CROSS_ORIGIN_OPENER_POLICY = 'same-origin'

# ── Cookie hardening (always applied, both dev and prod) ──
SESSION_COOKIE_HTTPONLY = True          # JS cannot read session cookie
SESSION_COOKIE_SAMESITE = 'Lax'        # CSRF mitigation
SESSION_COOKIE_AGE = 60 * 60 * 24 * 7   # 7-day sessions — PWA auto-logout
CSRF_COOKIE_SAMESITE = 'Lax'           # CSRF cookie SameSite
# Keep sessions write-light: middleware updates only selected keys when needed.
SESSION_SAVE_EVERY_REQUEST = False
# Note: CSRF_COOKIE_HTTPONLY left False (Django default) because JS reads
# the csrftoken cookie via getCSRFToken() for AJAX requests.

# ── Cross-subdomain cookies ──
# If SESSION_COOKIE_DOMAIN is set (e.g. ".adarshbhopal.in"), the session
# cookie is readable by ALL subdomains.  Only needed if you want a login
# on panel.* to also be recognised on www.* (rare — www is public).
_session_cookie_domain = os.getenv('SESSION_COOKIE_DOMAIN', '').strip()
_allow_wildcard_session_cookie = _env_bool('ALLOW_WILDCARD_SESSION_COOKIE_DOMAIN', False)
_is_wildcard_cookie_domain = _session_cookie_domain.startswith('.')
if _session_cookie_domain and (not _is_wildcard_cookie_domain or _allow_wildcard_session_cookie):
    SESSION_COOKIE_DOMAIN = _session_cookie_domain

# CSRF cookie domain — must match the session cookie domain when using
# subdomains, otherwise the csrftoken cookie set on one subdomain is
# invisible to another and POST requests fail with 403.
_csrf_cookie_domain_fallback = (
    _session_cookie_domain
    if (not _is_wildcard_cookie_domain or _allow_wildcard_session_cookie)
    else ''
)
_csrf_cookie_domain = os.getenv('CSRF_COOKIE_DOMAIN', _csrf_cookie_domain_fallback).strip()
if _csrf_cookie_domain:
    CSRF_COOKIE_DOMAIN = _csrf_cookie_domain

# ── Session idle timeout (seconds) ──
# If a user has no requests for this period, session expires on next request.
# Set to 0 to disable. Default: 30 days (matches SESSION_COOKIE_AGE).
SESSION_IDLE_TIMEOUT = int(os.getenv('SESSION_IDLE_TIMEOUT', str(60 * 60 * 24 * 7)))

# ── Session absolute max-age (seconds) ──
# Hard cap on session lifetime regardless of activity.
# Prevents indefinitely-valid stolen tokens from staying valid forever.
# Set to 0 to disable. Default: 30 days.
SESSION_ABSOLUTE_MAX_AGE = int(os.getenv('SESSION_ABSOLUTE_MAX_AGE', str(60 * 60 * 24 * 30)))

# ── Dashboard live-activity window (seconds) ──
# Used by dashboard "Live Working Clients". A user is considered live only if
# their session `_last_activity` is within this recent window.
DASHBOARD_LIVE_ACTIVE_WINDOW_SECONDS = int(os.getenv('DASHBOARD_LIVE_ACTIVE_WINDOW_SECONDS', '180'))

# ── Session fingerprint validation ──
# Adds lightweight binding of a session to browser fingerprint material.
# Include IP binding only when infra has stable client egress IPs.
SESSION_FINGERPRINT_ENABLED = os.getenv(
    'SESSION_FINGERPRINT_ENABLED',
    'false' if DEBUG else 'true'
).strip().lower() in ('1', 'true', 'yes')
SESSION_FINGERPRINT_INCLUDE_IP = os.getenv(
    'SESSION_FINGERPRINT_INCLUDE_IP',
    'false'
).strip().lower() in ('1', 'true', 'yes')

# How often PermissionValidationMiddleware can skip DB revalidation.
# Lower values reduce access-revocation windows.
PERMISSION_REVALIDATION_INTERVAL = int(os.getenv('PERMISSION_REVALIDATION_INTERVAL', '20'))

# Dev-only OTP log visibility toggle.
# DEBUG alone no longer enables plaintext OTP logs.
DEV_LOG_OTP = _env_bool('DEV_LOG_OTP', False)

# CSP hardening toggles.
# IMPORTANT: The current templates still rely on inline <script> blocks and
# inline event handlers (onclick/oninput). Keep unsafe-inline enabled by
# default until those scripts are migrated to nonce/hash-safe external files.
CSP_ALLOW_UNSAFE_INLINE = _env_bool('CSP_ALLOW_UNSAFE_INLINE', True)
# Alpine full evaluator is required by existing x-show/x-bind expressions
# that use comparisons and logical operators across desktop/mobile templates.
CSP_ALLOW_UNSAFE_EVAL = _env_bool('CSP_ALLOW_UNSAFE_EVAL', True)
CSP_ALLOW_LOCAL_ENGINE_CONNECT = _env_bool('CSP_ALLOW_LOCAL_ENGINE_CONNECT', DEBUG)

# ── Permissions-Policy header ──
# Restricts browser APIs not needed by this app.
# camera and microphone are allowed (self) for the PWA photo capture feature.
PERMISSIONS_POLICY = 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()'


# =============================================================================
# PASSWORD VALIDATION
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators
# =============================================================================

# Password validation baseline.
# Keeps 8-char minimum while adding low-friction protections against
# very weak/common passwords and user-attribute similarity.
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {
            'min_length': 8,
        }
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
        'OPTIONS': {
            'max_similarity': 0.7,
        },
    },
]


# =============================================================================
# INTERNATIONALIZATION
# https://docs.djangoproject.com/en/5.2/topics/i18n/
# =============================================================================

LANGUAGE_CODE = 'en-us'

TIME_ZONE = os.getenv('TIME_ZONE', 'Asia/Kolkata')

USE_I18N = True

USE_TZ = True


# =============================================================================
# STATIC FILES (CSS, JavaScript, Images)
# https://docs.djangoproject.com/en/5.2/howto/static-files/
# =============================================================================

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STATICFILES_DIRS = [BASE_DIR / 'static']

# Whitenoise for serving static files in production
# CompressedManifest version: content-hashes filenames (app.js → app.abc123.js)
# enabling permanent caching with Cache-Control: immutable
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}

# Safety: don't crash with 500 if a static file is missing from the manifest
# (e.g. dynamically-referenced vendor files in lazy-load.js or xlsx-worker.js)
WHITENOISE_MANIFEST_STRICT = False

# Media files (Uploads)
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Set to True ONLY when Nginx is configured with an internal /protected-media/
# location block (see deployment/nginx_example.conf). When False, Django serves
# media files directly even in production — slower but works without Nginx.
MEDIA_USE_XACCEL = os.getenv('MEDIA_USE_XACCEL', 'false').strip().lower() in ('1', 'true', 'yes')

# =============================================================================
# FILE UPLOAD LIMITS
# =============================================================================

# Max size for non-file POST fields (e.g. JSON card_ids, status flags, text fields).
# This does NOT limit file uploads — those are controlled by FILE_UPLOAD_MAX_MEMORY_SIZE
# and streamed/spilled to disk regardless of their size.
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB — POST fields only, not files

# Max size for a single uploaded file kept in memory before spilling to disk (10 MB)
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB

# Max number of files per upload request.
# Portfolio bulk upload allows up to 50 images; bulk-upload-task can include
# 1 XLSX + 20 unified ZIPs + field-specific ZIPs.  Keep headroom.
DATA_UPLOAD_MAX_NUMBER_FILES = 60


# =============================================================================
# BACKGROUND TASK WORKER
# =============================================================================

# ThreadPool size for DB-backed background tasks.
# Default 2 improves queue throughput while keeping memory bounded.
BACKGROUND_WORKER_MAX_WORKERS = max(
    1,
    min(4, int(os.getenv('BACKGROUND_WORKER_MAX_WORKERS', '2')))
)

# Heavy task concurrency cap (PDF/DOCX/ZIP generation, bulk uploads).
# Keep lower than worker count on low-memory hosts.
BACKGROUND_HEAVY_TASK_CONCURRENCY = max(
    1,
    min(BACKGROUND_WORKER_MAX_WORKERS, int(os.getenv('BACKGROUND_HEAVY_TASK_CONCURRENCY', '1')))
)


# =============================================================================
# CACHING
# =============================================================================

# Auto-detect Redis: set REDIS_URL in .env for production
# (e.g., REDIS_URL=redis://127.0.0.1:6379/1)
# Without REDIS_URL, falls back to LocMemCache (fine for single-process dev).
REDIS_URL = os.getenv('REDIS_URL', '')

if REDIS_URL:
    # Production: Redis — OTP, rate limiting, and export locks are shared
    # across all Gunicorn workers.
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.redis.RedisCache',
            'LOCATION': REDIS_URL,
            'TIMEOUT': 300,
            'OPTIONS': {
                'db': int(os.getenv('REDIS_DB', '1')),
            },
        }
    }
else:
    # Local development: LocMemCache (per-process, no setup needed)
    CACHES = {
        'default': {
            'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
            'TIMEOUT': 300,
            'OPTIONS': {
                'MAX_ENTRIES': 1000,
            },
        }
    }

# CRITICAL: Block production from running with per-process LocMemCache.
# Rate limiting, OTP storage, and export locks are silently broken without Redis.
if not DEBUG and CACHES['default']['BACKEND'].endswith('LocMemCache'):
    raise ImproperlyConfigured(
        'LocMemCache is per-process: rate limiting, OTP storage, and export locks '
        'are NOT shared between Gunicorn workers. '
        'Set REDIS_URL in .env for production (e.g. REDIS_URL=redis://127.0.0.1:6379/1).'
    )


# =============================================================================
# AUTHENTICATION
# =============================================================================

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# NOTE: AUTH_USER_MODEL is now defined at the top with INSTALLED_APPS
# AUTH_USER_MODEL = 'accounts.User'

# Login settings
LOGIN_URL = 'login'
LOGIN_REDIRECT_URL = 'dashboard'
LOGOUT_REDIRECT_URL = 'login'


# =============================================================================
# EMAIL CONFIGURATION
# Local: Console backend (emails printed to terminal)
# Production: SMTP backend (set credentials in .env)
# =============================================================================

# Check if email credentials are provided
_email_configured = bool(os.getenv('EMAIL_HOST_USER'))

if _email_configured:
    # Production: Use SMTP
    EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend'
    EMAIL_HOST = os.getenv('EMAIL_HOST', 'smtp.gmail.com')
    EMAIL_PORT = int(os.getenv('EMAIL_PORT', '587'))
    EMAIL_USE_TLS = os.getenv('EMAIL_USE_TLS', 'True').lower() in ('true', '1', 'yes')
    EMAIL_HOST_USER = os.getenv('EMAIL_HOST_USER', '')
    EMAIL_HOST_PASSWORD = os.getenv('EMAIL_HOST_PASSWORD', '')
    DEFAULT_FROM_EMAIL = os.getenv('DEFAULT_FROM_EMAIL', EMAIL_HOST_USER)
else:
    # Local development: Print emails to console
    EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'
    EMAIL_HOST_USER = ''
    EMAIL_HOST_PASSWORD = ''
    DEFAULT_FROM_EMAIL = 'noreply@localhost'

# Contact form recipient — if not set, contact-form emails are silently skipped
CONTACT_FORM_RECIPIENT = os.getenv('CONTACT_FORM_RECIPIENT', '')

# Site URL for email links
# Local: http://localhost:8000 | Production: Set SITE_URL in .env
SITE_URL = os.getenv('SITE_URL', 'http://localhost:8000')

# Client tutorial page video URL (shown on /panel/tutorial/)
CLIENT_TUTORIAL_VIDEO_URL = os.getenv('CLIENT_TUTORIAL_VIDEO_URL', 'https://www.youtube.com/')


# =============================================================================
# APP VERSION
# =============================================================================

def _get_app_version() -> str:
    """
    Resolve the running app version using these sources (in order):
      1. VERSION.txt file at the project root  (canonical source)
      2. APP_VERSION environment variable
      3. `git describe --tags --always`  (dev fallback)
      4. Hard-coded fallback
    """
    import subprocess as _sp

    # 1. VERSION.txt  (canonical)
    ver_file = BASE_DIR / 'VERSION.txt'
    try:
        if ver_file.exists():
            v = ver_file.read_text().strip()
            if v:
                return v if v.startswith('v') else f'v{v}'
    except Exception:
        pass

    # 2. Environment variable
    env_ver = os.getenv('APP_VERSION', '').strip()
    if env_ver:
        return env_ver if env_ver.startswith('v') else f'v{env_ver}'

    # 3. Git describe (fallback for dev)
    try:
        r = _sp.run(
            ['git', 'describe', '--tags', '--always'],
            capture_output=True, text=True,
            cwd=str(BASE_DIR), timeout=2,
        )
        if r.returncode == 0:
            v = r.stdout.strip()
            if v:
                return v if v.startswith('v') else f'v{v}'
    except Exception:
        pass

    return 'v2.18.09'


APP_VERSION = _get_app_version()

try:
    MOBILE_PWA_CACHE_GENERATION = max(1, int(os.getenv('MOBILE_PWA_CACHE_GENERATION', '1')))
except ValueError:
    MOBILE_PWA_CACHE_GENERATION = 1

try:
    MOBILE_PWA_CACHE_ROLLBACK_WINDOW = max(1, int(os.getenv('MOBILE_PWA_CACHE_ROLLBACK_WINDOW', '2')))
except ValueError:
    MOBILE_PWA_CACHE_ROLLBACK_WINDOW = 2


# =============================================================================
# ANDROID MOBILE SHELL POLICY
# =============================================================================

MOBILE_SHELL_ANDROID_MIN_BUILD = max(1, int(os.getenv('MOBILE_SHELL_ANDROID_MIN_BUILD', '1')))
MOBILE_SHELL_ANDROID_LATEST_BUILD = max(
    MOBILE_SHELL_ANDROID_MIN_BUILD,
    int(os.getenv('MOBILE_SHELL_ANDROID_LATEST_BUILD', str(MOBILE_SHELL_ANDROID_MIN_BUILD))),
)
MOBILE_SHELL_ANDROID_LATEST_VERSION = os.getenv('MOBILE_SHELL_ANDROID_LATEST_VERSION', '1.0.0').strip() or '1.0.0'
MOBILE_SHELL_ANDROID_FORCE_UPDATE = _env_bool('MOBILE_SHELL_ANDROID_FORCE_UPDATE', False)
MOBILE_SHELL_ANDROID_UPDATE_URL = os.getenv('MOBILE_SHELL_ANDROID_UPDATE_URL', '/static/website/apk/adarsh-admin.apk').strip()
MOBILE_SHELL_PRIVACY_URL = os.getenv('MOBILE_SHELL_PRIVACY_URL', WEBSITE_URL or SITE_URL).strip()
MOBILE_SHELL_SUPPORT_URL = os.getenv('MOBILE_SHELL_SUPPORT_URL', WEBSITE_URL or SITE_URL).strip()


# =============================================================================
# PERFORMANCE MONITORING THRESHOLDS
# =============================================================================

# Requests slower than this are logged as WARNING by RequestTimingMiddleware
SLOW_REQUEST_THRESHOLD = float(os.getenv('SLOW_REQUEST_THRESHOLD', '1.5'))

# Requests with more queries than this trigger EXCESSIVE QUERIES warning
QUERY_COUNT_THRESHOLD = int(os.getenv('QUERY_COUNT_THRESHOLD', '50'))

# Individual SQL queries slower than this (seconds) are logged to queries.log
SLOW_QUERY_THRESHOLD = float(os.getenv('SLOW_QUERY_THRESHOLD', '0.1'))


# =============================================================================
# LOGGING
# =============================================================================

# M3: Whether to also write logs to rotating files on disk.
# Enable on VPS / bare-metal by setting LOG_TO_FILE=true in .env.
# Leave unset (default False) on ephemeral containers (Render, Docker)
# where logs/ is wiped on restart — stdout/stderr is captured by the host.
LOG_TO_FILE = os.getenv('LOG_TO_FILE', 'false').strip().lower() in ('1', 'true', 'yes')

LOG_DIR = os.path.join(BASE_DIR, 'logs')
if LOG_TO_FILE:
    os.makedirs(LOG_DIR, exist_ok=True)

# Handler lists — conditionally include file handlers to avoid creating
# RotatingFileHandler instances (which open file descriptors) on containers.
_APP_HANDLERS = ['console'] + (['file_app', 'file_error'] if LOG_TO_FILE else [])
_APP_HANDLER  = ['console'] + (['file_app'] if LOG_TO_FILE else [])
_SEC_HANDLERS = ['console'] + (['file_security', 'file_app'] if LOG_TO_FILE else [])
_QRY_HANDLER  = ['file_queries'] if LOG_TO_FILE else ['console']

_file_handlers: dict = {}
if LOG_TO_FILE:
    _file_handlers = {
        'file_app': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOG_DIR, 'app.log'),
            'maxBytes': 10 * 1024 * 1024,  # 10 MB
            'backupCount': 5,
            'formatter': 'verbose',
            'level': 'INFO',
        },
        'file_error': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOG_DIR, 'error.log'),
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 10,
            'formatter': 'verbose',
            'level': 'ERROR',
        },
        'file_security': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOG_DIR, 'security.log'),
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 10,
            'formatter': 'verbose',
            'level': 'INFO',
        },
        'file_queries': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': os.path.join(LOG_DIR, 'queries.log'),
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 3,
            'formatter': 'verbose',
            'level': 'WARNING',
        },
    }

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,

    'formatters': {
        'verbose': {
            'format': '[{asctime}] {levelname} {name} {module}.{funcName}:{lineno} — {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S',
        },
        'simple': {
            'format': '{levelname} {name}: {message}',
            'style': '{',
        },
    },

    'filters': {
        'require_debug_false': {
            '()': 'django.utils.log.RequireDebugFalse',
        },
        'require_debug_true': {
            '()': 'django.utils.log.RequireDebugTrue',
        },
    },

    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose' if not DEBUG else 'simple',
            'level': 'DEBUG' if DEBUG else 'INFO',
        },
        **_file_handlers,
    },

    # Root logger — console always; file handlers only when LOG_TO_FILE=true
    'root': {
        'handlers': _APP_HANDLERS,
        'level': 'DEBUG' if DEBUG else 'INFO',
    },

    'loggers': {
        'django': {
            'handlers': _APP_HANDLER,
            'level': 'INFO',
            'propagate': False,
        },
        # Capture 500 errors from Django's request handler — written to error.log
        'django.request': {
            'handlers': _APP_HANDLERS,  # includes file_error (ERROR level) when LOG_TO_FILE
            'level': 'WARNING',
            'propagate': False,
        },
        # Security-sensitive loggers — also write to security.log when enabled
        'django.security': {
            'handlers': _SEC_HANDLERS,
            'level': 'INFO',
            'propagate': False,
        },
        'accounts': {
            'handlers': _SEC_HANDLERS,
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        'core.middleware': {
            'handlers': _SEC_HANDLERS,
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        # Slow/excessive query logging — file when LOG_TO_FILE, else console
        'slow_queries': {
            'handlers': _QRY_HANDLER,
            'level': 'WARNING',
            'propagate': False,
        },
        # DB backend query logging — only verbose in DEBUG mode
        'django.db.backends': {
            'handlers': ['console'],
            'level': 'DEBUG' if DEBUG else 'WARNING',
            'propagate': False,
        },
    },
}
