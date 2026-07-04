# Adarsh ID Panel: Production Deployment Manual

This manual details deployment steps, environment variables, server settings, Nginx/Gunicorn routing, and background service configurations.

---

## 1. Environment Configurations

All system variables are managed via an `.env` file loaded on application startup:

```ini
# Core
SECRET_KEY=production_secret_key_goes_here
DEBUG=False
ALLOWED_HOSTS=api.adarshid.com

# Database
DATABASE_URL=postgresql://adarsh_user:secure_db_pass@127.0.0.1:5432/adarsh_db
CONN_MAX_AGE=600

# Redis Cache & Tasks Broker
REDIS_URL=redis://127.0.0.1:6379/1

# Storage Backend (local / r2 / minio)
STORAGE_PROVIDER=r2
R2_ENDPOINT_URL=https://<account_id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=adarsh-prod-media
R2_ACCESS_KEY=cloudflare_r2_access_key
R2_SECRET_KEY=cloudflare_r2_secret_key

# JWT Token Settings
JWT_ACCESS_EXPIRATION_MINUTES=60
JWT_REFRESH_EXPIRATION_DAYS=7
```

---

## 2. Infrastructure Architecture & Services

```
                   ┌─────────────────┐
                   │   Nginx HTTPS   │
                   └────────┬────────┘
                            │ /api/v1/
                            ▼
                   ┌─────────────────┐
                   │    Gunicorn     │
                   └────────┬────────┘
                            │ WSGI
                            ▼
              ┌─────────────────────────────┐
              │      Django Application     │
              └───────┬──────────────┬──────┘
                      │              │
                      ▼              ▼
              ┌──────────────┐┌──────────────┐
              │  PostgreSQL  ││ Redis Cache  │
              └──────────────┘└──────┬───────┘
                                     │ Broker
                                     ▼
                              ┌──────────────┐
                              │Celery Workers│
                              └──────────────┘
```

### A. Gunicorn Configuration
Gunicorn serves the WSGI entrypoint `config.wsgi:application`.
Example `/etc/systemd/system/gunicorn.service`:
```ini
[Unit]
Description=Gunicorn daemon for Adarsh ID Panel
After=network.target

[Service]
User=django
Group=django
WorkingDirectory=/app/Adarsh-ID-Panel
ExecStart=/app/Adarsh-ID-Panel/.venv/bin/gunicorn --workers 3 --bind 127.0.0.1:8000 config.wsgi:application --access-logfile /var/log/gunicorn/access.log --error-logfile /var/log/gunicorn/error.log
Restart=always

[Install]
WantedBy=multi-user.target
```

### B. Nginx Virtual Host Setup
Nginx routes public requests, manages SSL handshakes, and serves static files.
Example Nginx Server block `/etc/nginx/sites-available/adarshid`:
```nginx
server {
    listen 80;
    server_name api.adarshid.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name api.adarshid.com;

    ssl_certificate /etc/letsencrypt/live/api.adarshid.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.adarshid.com/privkey.pem;

    client_max_body_size 100M;  # Required for large ZIP/Excel uploads

    location /static/ {
        alias /app/Adarsh-ID-Panel/static_root/;
    }

    location /media/ {
        alias /app/Adarsh-ID-Panel/media/;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;  # Tracing correlation
    }
}
```

### C. Background Services (Celery Workers & Beat)
Systemd unit for Celery worker:
```ini
[Unit]
Description=Celery Worker service
After=network.target

[Service]
Type=simple
User=django
WorkingDirectory=/app/Adarsh-ID-Panel
ExecStart=/app/Adarsh-ID-Panel/.venv/bin/celery -A config worker --loglevel=info -Q default,imports,exports
Restart=always

[Install]
WantedBy=multi-user.target
```

Systemd unit for Celery Beat scheduler:
```ini
[Unit]
Description=Celery Beat Scheduler service
After=network.target

[Service]
Type=simple
User=django
WorkingDirectory=/app/Adarsh-ID-Panel
ExecStart=/app/Adarsh-ID-Panel/.venv/bin/celery -A config beat --loglevel=info
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 3. Health & Liveness Checks

To monitor the platform in production, the load balancer or monitoring container must query the following endpoints:

- **`/api/v1/health/live/`**:
  * **Liveness Probe**: Confirms the web process is running. Returns `200 OK` statically under `<1ms` without querying external databases, avoiding false-positive restarts under heavy database loads.
- **`/api/v1/health/`**:
  * **Readiness Probe**: Performs real-time checks on PostgreSQL, Redis cache reads, S3/R2 writes, and active Celery workers.
- **`/api/v1/health/db/`**:
  * Confirms database connection health and response latency.
