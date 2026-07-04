import os
from pathlib import Path
import environ
import structlog
from datetime import timedelta

BASE_DIR = Path(__file__).resolve().parent.parent.parent
env = environ.Env(DEBUG=(bool, False))
environ.Env.read_env(os.path.join(BASE_DIR, '.env'))

SECRET_KEY = env('SECRET_KEY')
DEBUG = env('DEBUG')
ALLOWED_HOSTS = env.list('ALLOWED_HOSTS', default=[])

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    'rest_framework',
    'rest_framework_simplejwt',
    'corsheaders',
    'drf_spectacular',
    'django_filters',

    'apps.users',
    'apps.organizations',
    'apps.permissions',
    #'apps.features',
    #'apps.licenses',
    #'apps.versions',
    'apps.impersonation',
    'apps.tables',
    'apps.fields',
    'apps.cards',
    'apps.workflow',
    'apps.imports',
    'apps.exports',
    'apps.mediafiles',
    'apps.jobs',
    'apps.notifications',
    #'apps.search',
    'apps.sandbox',
    'apps.auditlogs',
    'apps.pro',
    'apps.desktop_sync',
    'apps.hardening',
    'apps.operations',
    'apps.reprints',
]

MIDDLEWARE = [
    'apps.hardening.middleware.RequestCorrelationMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
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
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

DATABASES = {
    'default': env.db('DATABASE_URL', default='postgres://postgres:postgres@127.0.0.1:5432/adarsh')
}
DATABASES['default']['CONN_MAX_AGE'] = env.int('DATABASE_CONN_MAX_AGE', 60)

CACHES = {
    "default": {
        "BACKEND": "django_redis.cache.RedisCache",
        "LOCATION": env('REDIS_URL', default='redis://127.0.0.1:6379/0'),
        "OPTIONS": {
            "CLIENT_CLASS": "django_redis.client.DefaultClient",
        }
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'static_root')

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
AUTH_USER_MODEL = 'users.User'

REST_FRAMEWORK = {
    'DEFAULT_SCHEMA_CLASS': 'drf_spectacular.openapi.AutoSchema',
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.IsAuthenticated',
    ],
    'DEFAULT_THROTTLE_CLASSES': [
        'apps.hardening.throttling.HardenedAnonRateThrottle',
        'apps.hardening.throttling.HardenedUserRateThrottle',
        'apps.desktop_sync.throttling.DesktopRateThrottle',
        'apps.hardening.throttling.ProRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '100/day',
        'user': '1000/day',
        'desktop': '300/min',
        'pro': '1000/min',
    },
    'DEFAULT_FILTER_BACKENDS': ['django_filters.rest_framework.DjangoFilterBackend'],
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=env.int('JWT_ACCESS_EXPIRATION_MINUTES', 60)),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=env.int('JWT_REFRESH_EXPIRATION_DAYS', 7)),
    'SIGNING_KEY': env('JWT_SECRET_KEY', default=SECRET_KEY),
}

CORS_ALLOWED_ORIGINS = env.list('CORS_ALLOWED_ORIGINS', default=[])

CELERY_BROKER_URL = env('CELERY_BROKER_URL', default='redis://localhost:6379/1')
CELERY_RESULT_BACKEND = env('CELERY_BROKER_URL', default='redis://localhost:6379/1')

# Hardening: Global Task Time Limits
CELERY_TASK_TIME_LIMIT = 3600       # 1 hour hard limit
CELERY_TASK_SOFT_TIME_LIMIT = 3000  # 50 minutes soft limit

# Celery Queue Routing
CELERY_TASK_DEFAULT_QUEUE = 'default'
CELERY_TASK_ROUTES = {
    'apps.jobs.tasks.run_job_task': {'queue': 'default'},
    'sandbox.cleanup_expired_sessions': {'queue': 'default'},
}

CELERY_BEAT_SCHEDULE = {
    'sandbox-cleanup-expired-sessions': {
        'task': 'sandbox.cleanup_expired_sandbox_sessions',
        'schedule': 3600,  # every hour
    },
    'pro-statistics-snapshot': {
        'task': 'pro.generate_statistics_snapshot',
        'schedule': 3600,  # every hour
    },
    'pro-audit-aggregation': {
        'task': 'pro.aggregate_audit_logs',
        'schedule': 86400,  # every day
    },
    'ops-backup-verification': {
        'task': 'apps.operations.tasks.verify_backups_task',
        'schedule': 86400,  # daily
    },
    'ops-retention-cleanup': {
        'task': 'apps.operations.tasks.retention_cleanup_task',
        'schedule': 86400,  # daily
    },
    'ops-env-diagnostics': {
        'task': 'apps.operations.tasks.env_diagnostics_task',
        'schedule': 60,  # every 1 minute
    },
    'ops-disk-checks': {
        'task': 'apps.operations.tasks.disk_checks_task',
        'schedule': 300,  # every 5 minutes
    },
    'ops-memory-checks': {
        'task': 'apps.operations.tasks.memory_checks_task',
        'schedule': 300,  # every 5 minutes
    },
}

# Storage Configuration
STORAGE_PROVIDER = env('STORAGE_PROVIDER', default='local')
STORAGE_R2_CONFIG = {
    'endpoint_url': env('R2_ENDPOINT_URL', default=''),
    'bucket_name': env('R2_BUCKET_NAME', default=''),
    'access_key': env('R2_ACCESS_KEY', default=''),
    'secret_key': env('R2_SECRET_KEY', default=''),
}
STORAGE_MINIO_CONFIG = {
    'endpoint_url': env('MINIO_ENDPOINT_URL', default=''),
    'bucket_name': env('MINIO_BUCKET_NAME', default=''),
    'access_key': env('MINIO_ACCESS_KEY', default=''),
    'secret_key': env('MINIO_SECRET_KEY', default=''),
}

# Image Validation
ALLOWED_IMAGE_EXTENSIONS = ['jpeg', 'jpg', 'png', 'webp']
ALLOWED_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']


# Structured Logging Configuration
def add_request_context(logger, method_name, event_dict):
    try:
        from apps.hardening.context import get_request_context
        ctx = get_request_context()
        event_dict.update({k: v for k, v in ctx.items() if v is not None})
    except ImportError:
        pass
    
    # Map 'event' key to 'message'
    if 'event' in event_dict:
        event_dict['message'] = event_dict.pop('event')
    
    # Map logger name to 'service'
    if logger:
        event_dict['service'] = getattr(logger, 'name', str(logger))
    elif 'logger_name' in event_dict:
        event_dict['service'] = event_dict.pop('logger_name')
        
    return event_dict

structlog.configure(
    processors=[
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", key="timestamp"),
        add_request_context,
        structlog.processors.JSONRenderer()
    ],
    context_class=dict,
    logger_factory=structlog.stdlib.LoggerFactory(),
    wrapper_class=structlog.stdlib.BoundLogger,
    cache_logger_on_first_use=True,
)

LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'json': {
            '()': structlog.stdlib.ProcessorFormatter,
            'processor': structlog.processors.JSONRenderer(),
            'foreign_pre_chain': [
                structlog.stdlib.add_log_level,
                structlog.processors.TimeStamper(fmt="iso", key="timestamp"),
                add_request_context,
            ],
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'json',
        },
        'file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': env('LOG_FILE_PATH', default='adarsh.log'),
            'maxBytes': 1024 * 1024 * 5,  # 5 MB
            'backupCount': 5,
            'formatter': 'json',
        },
    },
    'loggers': {
        'django': {
            'handlers': ['console', 'file'],
            'level': env('LOG_LEVEL', default='INFO'),
            'propagate': True,
        },
        'apps': {
            'handlers': ['console', 'file'],
            'level': 'DEBUG',
            'propagate': True,
        }
    },
}

DATA_UPLOAD_MAX_MEMORY_SIZE = 10485760  # 10MB
FILE_UPLOAD_MAX_MEMORY_SIZE = 10485760  # 10MB\n