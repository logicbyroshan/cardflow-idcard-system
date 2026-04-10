# Adarsh Production Deploy Runbook

## Purpose
This runbook documents the first-time production deploy issue where code was updated but the website UI did not reflect the latest changes.

Use this document for:
- One-time cleanup and stabilization
- Safe production deploys going forward
- Fast diagnosis if UI changes do not appear after deploy

## Incident Summary

### What happened
- Git deploy and collectstatic were completed successfully.
- Live UI still showed old template version strings (for example, `?v=144` and `?v=1`) instead of the latest values.

### Root cause
- Multiple Gunicorn services were active at the same time:
  - `adarsh_prod.service`
  - `gunicorn.service`
- Nginx upstream `django_app` was pointing to only one port (`127.0.0.1:8001`).
- Deploy/restart actions were not always targeting the exact service that Nginx was currently serving.

### Why this looked like a CSS/static issue
- Static pipeline was healthy (`collectstatic` ran successfully).
- The real issue was old HTML/templates being served by a different running app process.

## One-Time Stabilization (Do During Maintenance Window)

## Step 0: Announce maintenance
Suggested announcement:

"Maintenance in progress from 7:00 PM to 7:20 PM. During this window, panel and website actions may be temporarily unavailable. Please save work and avoid new submissions."

## Step 1: Confirm Nginx upstream target
Run:

```bash
sudo nginx -T | grep -nA6 -B2 "upstream django_app"
```

Expected: one upstream block with one clear target port (currently `127.0.0.1:8001`).

## Step 2: Confirm active Gunicorn services
Run:

```bash
systemctl list-units --type=service --all | grep -i gunicorn
sudo ss -ltnp | grep -E ":8000|:8001|gunicorn"
```

If both `gunicorn.service` and `adarsh_prod.service` are active, keep only one production service.

## Step 3: Keep one service only
If production service is `adarsh_prod.service`, run:

```bash
sudo systemctl stop gunicorn
sudo systemctl disable gunicorn
sudo systemctl restart adarsh_prod
sudo systemctl reload nginx
```

Then verify:

```bash
systemctl list-units --type=service --all | grep -i gunicorn
sudo ss -ltnp | grep -E ":8000|:8001|gunicorn"
```

Goal: only one active production app service serving the port used by Nginx upstream.

## Step 4: Deploy latest code to adarsh_prod
Run:

```bash
cd /home/adarsh/apps/adarsh_prod
git fetch origin
git reset --hard origin/main
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart adarsh_prod
sudo systemctl reload nginx
```

## Step 5: Verify live HTML version markers
Use local TLS resolution to avoid external DNS/CDN confusion:

```bash
curl -skS --resolve adarshbhopal.in:443:127.0.0.1 https://adarshbhopal.in/our-work/ | grep -E "v=146|v=144|our-works|ui-consistency"
```

Success criteria:
- New markers appear (for example `v=146`)
- Old markers (for example `v=144` or `v=1`) are gone

## Step 6: Browser-side confirmation
- Hard refresh: `Ctrl + Shift + R`
- Also test in Incognito/Private window
- If using CDN (for example Cloudflare), purge cache for:
  - `/our-work/`
  - `/static/*`

## Standard Deploy SOP (Use Every Time)

Run this exact sequence:

```bash
cd /home/adarsh/apps/adarsh_prod
git fetch origin
git reset --hard origin/main
python manage.py migrate
python manage.py collectstatic --noinput
sudo systemctl restart adarsh_prod
sudo systemctl reload nginx
```

Post-deploy smoke checks:

```bash
curl -skS --resolve adarshbhopal.in:443:127.0.0.1 https://adarshbhopal.in/our-work/ | head -n 120
curl -skS --resolve adarshbhopal.in:443:127.0.0.1 https://adarshbhopal.in/our-work/ | grep -F "?v="
```

## Quick Diagnosis Checklist (If UI Looks Old)

1. Check branch and commit:

```bash
cd /home/adarsh/apps/adarsh_prod
git rev-parse --short HEAD
```

2. Check template file contains expected version tokens:

```bash
grep -n "v=" /home/adarsh/apps/adarsh_prod/templates/website/base.html /home/adarsh/apps/adarsh_prod/templates/website/our-works.html
```

3. Check active app services and listening ports:

```bash
systemctl list-units --type=service --all | grep -i gunicorn
sudo ss -ltnp | grep -E ":8000|:8001|gunicorn"
```

4. Check Nginx upstream target:

```bash
sudo nginx -T | grep -nA6 -B2 "upstream django_app"
```

5. Verify local HTTPS response content:

```bash
curl -skS --resolve adarshbhopal.in:443:127.0.0.1 https://adarshbhopal.in/our-work/ | sed -n '1,180p'
```

## Important Operational Notes

- Do not run two production Gunicorn services unless intentionally configured for load balancing.
- Keep Nginx upstream and service restart target aligned.
- Avoid placeholder Host headers during curl checks.
- If shell variable is used for domain, confirm first:

```bash
echo "DOMAIN=[$DOMAIN]"
```

## Security Follow-up

A secret value was exposed in terminal output during troubleshooting.
Rotate the exposed secret immediately after maintenance and restart the app service.

## Owner Checklist Before Closing Maintenance

- [ ] Single production service active
- [ ] Nginx upstream matches active app port
- [ ] Latest commit deployed in adarsh_prod
- [ ] Migrate and collectstatic completed
- [ ] Live HTML shows expected new version markers
- [ ] Browser and private-window check passed
- [ ] Exposed secret rotated
