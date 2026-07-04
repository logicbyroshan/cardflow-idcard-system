Enable Redis for production (low-memory, high-concurrency)

Summary
- This project already uses Redis when `REDIS_URL` (or host/port env vars) is set.
- Enabling Redis reduces per-process memory pressure and allows cross-process coordination for: caches, session caching (`cached_db`), Channels, and export throttles.

Required env vars (example .env entries)
- REDIS_URL=redis://:password@127.0.0.1:6379/1
  - or set REDIS_HOST, REDIS_PORT, REDIS_DB, REDIS_USERNAME, REDIS_PASSWORD

Optional tuning env vars
- REDIS_SOCKET_TIMEOUT=1.5
- REDIS_SOCKET_CONNECT_TIMEOUT=1.5
- REDIS_HEALTH_CHECK_INTERVAL=30
- REDIS_MAX_CONNECTIONS=100
- REDIS_CLIENT_NAME=adarsh-django-cache

Optional background queue env vars
- CELERY_BROKER_URL=redis://:password@127.0.0.1:6379/2
- CELERY_RESULT_BACKEND=redis://:password@127.0.0.1:6379/3

What the app does when Redis is present
- `CACHES['default']` will use `django.core.cache.backends.redis.RedisCache`.
- `SESSION_ENGINE` will switch to `django.contrib.sessions.backends.cached_db`.
- `CHANNEL_LAYERS` will use `channels_redis.core.RedisChannelLayer` if configured.
- Export throttle (exports/export_throttle.py) uses Django cache for cross-process slots.

Verification steps (on the server)
1. Ensure Redis is running and reachable:

```bash
redis-cli -h 127.0.0.1 -p 6379 PING
# expect: PONG
```

2. Set `REDIS_URL` in your production environment (example for systemd or Render):

```bash
# example for a .env file
REDIS_URL=redis://:mypassword@127.0.0.1:6379/1
```

3. Restart your app (Gunicorn, systemd, container):

```bash
# systemd example
sudo systemctl restart myapp.service
# or inside container: docker-compose up -d
```

4. Quick runtime check inside the Python/Django environment:

```bash
# from project root, with virtualenv activated
python manage.py shell
>>> from django.core.cache import cache
>>> cache.set('adarsh.redis.check', 'ok', 10)
>>> cache.get('adarsh.redis.check')
'ok'
```

5. Verify sessions are cached (cached_db): create a session and check `django_session` table plus cache keys in Redis.

If you also want the Celery queue path active, install dependencies and run a worker:

```bash
pip install -r requirements.txt
celery -A config worker -l info
```

Recommended low-memory production settings
- Use Redis for caches and sessions rather than `LocMemCache`.
- Keep `BACKGROUND_WORKER_MAX_WORKERS` low (2-4) and `BACKGROUND_HEAVY_TASK_CONCURRENCY` to 1 on small hosts.
- Use separate Redis DBs for cache (db=1) and channels (db=2) if using same Redis instance.
- Monitor `INFO` and `CLIENT LIST` from `redis-cli` for connection spikes.

Notes
- Redis is optional. If it is not configured, the app falls back to the existing cache/session behavior and keeps working.
- If you want me to switch more endpoints to fragment/template caching, I can add template tag changes next (non-breaking, TTL-based).
