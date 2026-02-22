# Redis Configuration Guide

## Overview

This project uses Django's cache framework with **automatic Redis detection**.
When a `REDIS_URL` environment variable is set, the application switches to Redis.
Without it, `LocMemCache` (in-memory per-process cache) is used — suitable for
local development but **not recommended for production** with multiple workers.

---

## Quick Setup

### 1. Install Redis

**Ubuntu / Debian:**
```bash
sudo apt update && sudo apt install redis-server -y
sudo systemctl enable redis-server
sudo systemctl start redis-server
```

**macOS (Homebrew):**
```bash
brew install redis
brew services start redis
```

**Windows (WSL recommended):**
```bash
# Inside WSL
sudo apt install redis-server -y
sudo service redis-server start
```

**Docker:**
```bash
docker run -d --name redis -p 6379:6379 redis:7-alpine
```

### 2. Set Environment Variable

Add to your `.env` file:
```env
REDIS_URL=redis://127.0.0.1:6379/1
```

Or for Redis with authentication:
```env
REDIS_URL=redis://:your_password@127.0.0.1:6379/1
```

The `/1` at the end is the Redis database number (0–15). You can change it via
the `REDIS_DB` env var too:
```env
REDIS_DB=2
```

### 3. Verify

Start the Django server and check the logs. With Redis configured:
- No `LocMemCache` warning will appear
- OTP, rate limiting, and export locks are shared across all workers

You can also verify from the Django shell:
```python
from django.core.cache import cache
cache.set('test', 'hello', 30)
print(cache.get('test'))  # Should print 'hello'
```

---

## What Redis Is Used For

| Feature | Cache Key Pattern | TTL | Purpose |
|---------|-------------------|-----|---------|
| **OTP (Forgot Password)** | `otp:<email>` | 300s (5 min) | One-time password for password reset |
| **OTP Attempt Counter** | `otp_attempts:<email>` | 300s | Rate-limit OTP verification tries |
| **Rate Limiting** | `rl:<prefix>:<identifier>` | Varies | Throttle API requests per IP/user |
| **Export Lock** | `export_lock:<user_id>:<table_id>` | 300s | Prevent concurrent exports for same table |
| **Dashboard Stats** | `dashboard_card_stats[:<user_id>]` | 30s | Cached card status counts |
| **Dashboard Client Stats** | `dashboard_client_stats[:<user_id>]` | 60s | Cached client counts |
| **Dashboard Staff Stats** | `dashboard_staff_stats[:<user_id>]` | 60s | Cached staff counts |
| **Dashboard CS Stats** | `dashboard_cs_stats[:<user_id>]` | 60s | Cached client-staff counts |
| **Permission Revalidation** | Session-based (`_perm_checked_at`) | 10s | Interval for re-checking permissions in middleware |
| **Bulk Upload Lock** | `bulk_upload_lock:<user_id>:<table_id>` | 15s | Prevent duplicate upload submissions |
| **Website Status** | `website_status` | 60s | Cached online/offline status for public site |

---

## Why Redis Matters in Production

With **Gunicorn** (multiple workers), each worker is a separate process:

- **LocMemCache** is per-process — OTP stored in worker #1 is invisible to
  worker #2. This breaks password reset and rate limiting.
- **Redis** is shared — all workers read/write the same cache, so OTP,
  rate limits, and export locks work correctly.

### Minimum Requirement
- Redis 6+ recommended
- ~50 MB RAM is sufficient for this application's cache usage
- Persistence (RDB/AOF) is optional — cache data is ephemeral

---

## Production Checklist

- [ ] `REDIS_URL` set in `.env` or environment variables
- [ ] Redis server running and accessible from the application server
- [ ] No `LocMemCache` warning in startup logs
- [ ] Test OTP flow (forgot password) to confirm cache is shared
- [ ] If using Render/Railway/Fly.io, use their managed Redis add-on

---

## Troubleshooting

**"LocMemCache is per-process" warning at startup:**
→ `REDIS_URL` is not set. Add it to your `.env`.

**`ConnectionError: Error connecting to Redis`:**
→ Redis server is not running or URL is wrong. Check `redis-cli ping`.

**OTP not working across requests:**
→ You are likely using LocMemCache with multiple workers. Set `REDIS_URL`.

**Cache not clearing after restart:**
→ Redis persists across app restarts. Use `redis-cli FLUSHDB` to clear
database 1 (or whichever you configured).
