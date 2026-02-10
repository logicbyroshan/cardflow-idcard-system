
from pathlib import Path
from dotenv import load_dotenv
import os
import dj_database_url

# Load environment variables from .env file (if exists)
load_dotenv()

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent


# =============================================================================
# CORE SETTINGS
# =============================================================================

# SECURITY WARNING: keep the secret key used in production secret!
# In production, set SECRET_KEY in .env file
SECRET_KEY = os.getenv('SECRET_KEY', 'django-insecure-dev-key-change-in-production-*m$!x7r9vt=%9aqv1nnaav')

# SECURITY WARNING: don't run with debug turned on in production!
# Local default: True | Production: Set DEBUG=False in .env
DEBUG = os.getenv('DEBUG', 'True').lower() in ('true', '1', 'yes')

# Allowed Hosts
# In DEBUG mode allow everything; in production read from .env
if DEBUG:
    ALLOWED_HOSTS = ['*']
else:
    _default_hosts = ''
    ALLOWED_HOSTS = [
        host.strip()
        for host in os.getenv('ALLOWED_HOSTS', _default_hosts).split(',')
        if host.strip()
    ]


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
    'client_staff',
    'exports',
    'mediafiles',
    'staff',
    'workflows',
    'website',
]

# Custom User Model - Keep pointing to core.User for database compatibility
# The User class is defined in accounts but re-exported from core for migrations
AUTH_USER_MODEL = 'core.User'

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
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

# Local default: SQLite | Production: Set DATABASE_URL in .env
# Example DATABASE_URL: postgres://user:password@host:5432/dbname

DATABASE_URL = os.getenv('DATABASE_URL')

if DATABASE_URL:
    # Production: Use DATABASE_URL (PostgreSQL, MySQL, etc.)
    DATABASES = {
        'default': dj_database_url.config(
            default=DATABASE_URL,
            conn_max_age=600,
            conn_health_checks=True,
        )
    }
else:
    # Local development: Use SQLite (no setup needed)
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }


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
    
    # Other security
    SECURE_CONTENT_TYPE_NOSNIFF = True
    X_FRAME_OPTIONS = 'DENY'


# =============================================================================
# PASSWORD VALIDATION
# https://docs.djangoproject.com/en/5.2/ref/settings/#auth-password-validators
# =============================================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
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
# Use CompressedStaticFilesStorage (NOT Manifest version) to avoid missing file errors
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}

# Media files (Uploads)
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# =============================================================================
# FILE UPLOAD LIMITS
# =============================================================================

# Max size for request body (100 MB — covers bulk XLSX + ZIP uploads)
DATA_UPLOAD_MAX_MEMORY_SIZE = 100 * 1024 * 1024  # 100 MB

# Max size for a single uploaded file kept in memory before spilling to disk (10 MB)
FILE_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024  # 10 MB


# =============================================================================
# CACHING
# =============================================================================

CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
    }
}


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

# Site URL for email links
# Local: http://localhost:8000 | Production: Set SITE_URL in .env
SITE_URL = os.getenv('SITE_URL', 'http://localhost:8000')


# =============================================================================
# LOGGING (Optional - useful for debugging in production)
# =============================================================================

if not DEBUG:
    LOGGING = {
        'version': 1,
        'disable_existing_loggers': False,
        'formatters': {
            'verbose': {
                'format': '{levelname} {asctime} {module} {message}',
                'style': '{',
            },
        },
        'handlers': {
            'console': {
                'class': 'logging.StreamHandler',
                'formatter': 'verbose',
            },
        },
        'root': {
            'handlers': ['console'],
            'level': 'INFO',
        },
        'loggers': {
            'django': {
                'handlers': ['console'],
                'level': 'INFO',
                'propagate': False,
            },
        },
    }

