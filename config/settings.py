
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

# Allowed Hosts
# In DEBUG mode allow everything; in production read from .env
if DEBUG:
    ALLOWED_HOSTS = ['*']
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
    'workflows',
    'website',
    'cardprint',
    'reprintcard',
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
    # Permission Validation Middleware - re-checks permissions on every request
    # CRITICAL: Must come after AuthenticationMiddleware
    'core.middleware.PermissionValidationMiddleware',
    # RoleScopingMiddleware removed — deprecated, scoping merged into PermissionValidationMiddleware
    # Session idle timeout — logs out after SESSION_IDLE_TIMEOUT of inactivity
    'core.middleware.SessionIdleTimeoutMiddleware',
    # Security headers — Permissions-Policy, Cache-Control
    'core.middleware.SecurityHeadersMiddleware',
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
                'timeout': 30,  # Wait up to 30s for DB lock (default 5s causes failures during bulk uploads)
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

# Production security settings (only when DEBUG=False)
if not DEBUG:
    # HTTPS settings
    SECURE_SSL_REDIRECT = os.getenv('SECURE_SSL_REDIRECT', 'True').lower() in ('true', '1', 'yes')
    SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')
    
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

# ── Additional hardening (production only) ──
if not DEBUG:
    # Prevent browser from caching sensitive pages from the back button
    # (belt-and-suspenders with SecurityHeadersMiddleware Cache-Control)
    SECURE_BROWSER_XSS_FILTER = True  # for older browsers that don't support CSP

# ── Cookie hardening (always applied, both dev and prod) ──
SESSION_COOKIE_HTTPONLY = True          # JS cannot read session cookie
SESSION_COOKIE_SAMESITE = 'Lax'        # CSRF mitigation
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30  # 30-day sessions (better for PWA)
CSRF_COOKIE_SAMESITE = 'Lax'           # CSRF cookie SameSite
SESSION_SAVE_EVERY_REQUEST = True       # Extend session on every page load
# Note: CSRF_COOKIE_HTTPONLY left False (Django default) because JS reads
# the csrftoken cookie via getCSRFToken() for AJAX requests.

# ── Cross-subdomain cookies ──
# If SESSION_COOKIE_DOMAIN is set (e.g. ".adarshbhopal.in"), the session
# cookie is readable by ALL subdomains.  Only needed if you want a login
# on panel.* to also be recognised on www.* (rare — www is public).
_session_cookie_domain = os.getenv('SESSION_COOKIE_DOMAIN', '').strip()
if _session_cookie_domain:
    SESSION_COOKIE_DOMAIN = _session_cookie_domain

# CSRF cookie domain — must match the session cookie domain when using
# subdomains, otherwise the csrftoken cookie set on one subdomain is
# invisible to another and POST requests fail with 403.
_csrf_cookie_domain = os.getenv('CSRF_COOKIE_DOMAIN', _session_cookie_domain).strip()
if _csrf_cookie_domain:
    CSRF_COOKIE_DOMAIN = _csrf_cookie_domain

# ── Session idle timeout (seconds) ──
# If a user has no requests for this period, session expires on next request.
# Set to 0 to disable. Default: 30 days (matches SESSION_COOKIE_AGE).
SESSION_IDLE_TIMEOUT = int(os.getenv('SESSION_IDLE_TIMEOUT', str(60 * 60 * 24 * 30)))

# ── Permissions-Policy header ──
# Restricts browser APIs not needed by this app.
# camera and microphone are allowed (self) for the PWA photo capture feature.
PERMISSIONS_POLICY = 'camera=(self), microphone=(self), geolocation=(), payment=(), usb=()'


# =============================================================================
# PASSWORD VALIDATION
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators
# =============================================================================

# Password validation relaxed: passwords can be simple (e.g., mobile numbers).
# Only enforce minimum length of 8 characters.
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {
            'min_length': 8,
        }
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

STATIC_URL = 'static/'
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
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# =============================================================================
# FILE UPLOAD LIMITS
# =============================================================================

# Max size for request body (1 GB — covers bulk XLSX + ZIP uploads)
# Files >10 MB are spilled to disk by Django (FILE_UPLOAD_MAX_MEMORY_SIZE),
# so large ZIPs are streamed to a temp file, NOT held in RAM.
DATA_UPLOAD_MAX_MEMORY_SIZE = 1 * 1024 * 1024 * 1024  # 1 GB

# Max size for a single uploaded file kept in memory before spilling to disk (10 MB)
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB

# Max number of files per upload request (ZIP + XLSX + unified ZIPs)
DATA_UPLOAD_MAX_NUMBER_FILES = 30


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


# =============================================================================
# APP VERSION
# =============================================================================

APP_VERSION = os.getenv('APP_VERSION', 'v1.8.0')


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

LOG_DIR = os.path.join(BASE_DIR, 'logs')
os.makedirs(LOG_DIR, exist_ok=True)

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
    },

    # Root logger catches everything not handled by specific loggers
    'root': {
        'handlers': ['console', 'file_app', 'file_error'],
        'level': 'DEBUG' if DEBUG else 'INFO',
    },

    'loggers': {
        'django': {
            'handlers': ['console', 'file_app'],
            'level': 'INFO',
            'propagate': False,
        },
        # Security-sensitive loggers — also write to security.log
        'django.security': {
            'handlers': ['file_security'],
            'level': 'INFO',
            'propagate': False,
        },
        'accounts': {
            'handlers': ['console', 'file_security', 'file_app'],
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        'core.middleware': {
            'handlers': ['console', 'file_security', 'file_app'],
            'level': 'DEBUG' if DEBUG else 'INFO',
            'propagate': False,
        },
        # Slow/excessive query logging — writes to queries.log
        'slow_queries': {
            'handlers': ['file_queries'],
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
