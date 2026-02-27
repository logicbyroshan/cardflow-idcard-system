# Adarsh ID Cards — Management Platform

A full-stack Django application for professional ID card design, printing, and management. Built for schools, colleges, and organizations to manage bulk ID card workflows end-to-end.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Django 5.2, Python 3.11, SQLite/PostgreSQL |
| **Frontend** | Tailwind CSS 4, Alpine.js, HTMX |
| **PDF/Export** | ReportLab, xhtml2pdf, openpyxl, python-docx |
| **Media** | Pillow, WhiteNoise (static), protected media serving |
| **PWA** | Service Worker, manifest.json, installable mobile app |
| **Deployment** | Gunicorn, Nginx, systemd |

---

## Project Structure

```
├── accounts/          # Authentication (login, OTP, sessions)
├── cardprint/         # 3-step card print workflow (Print List → Finalized → Pool)
├── client/            # Client organization management
├── config/            # Django settings, URL routing, WSGI/ASGI
├── core/              # User model, permissions, ID card models, base views
├── deployment/        # Gunicorn, Nginx, cron, swap config examples
├── exports/           # PDF, Excel, Word, ZIP export generation
├── mediafiles/        # Image & media file management
├── PWA/               # Progressive Web App (mobile app)
├── reprintcard/       # 4-step reprint workflow (Requested → Confirmed → Downloaded → Pool)
├── staff/             # Admin staff management
├── static/            # CSS, JS, fonts, images
├── templates/         # Django templates (base, dashboard, auth, website, partials)
├── website/           # Public-facing website (landing, portfolio, testimonials, contact)
├── workflows/         # Workflow engine for card processing
├── manage.py
├── requirements.txt
└── package.json       # Tailwind CSS CLI
```

---

## Django Apps

| App | Purpose |
|-----|---------|
| `core` | Central app — User model, IDCard/IDCardTable models, permissions, middleware, context processors |
| `accounts` | Authentication with rate limiting, OTP verification, session management |
| `client` | Client (organization) CRUD, client staff, group settings |
| `staff` | Admin staff management, role assignment, permissions |
| `cardprint` | Card printing workflow — 3 steps: Print List → Finalized → Pool |
| `reprintcard` | Card reprinting workflow — 4 steps: Requested → Confirmed → Downloaded → Pool |
| `exports` | PDF, Excel, Word, and ZIP export generation with background tasks |
| `mediafiles` | Protected media file management for ID card images |
| `website` | Public website — landing page, portfolio, testimonials, contact, SEO |
| `workflows` | Workflow engine for card status transitions |
| `PWA` | Progressive Web App for mobile access |

---

## Key Features

### ID Card Management
- **Bulk upload** of student/staff data via Excel
- **Multi-status workflow**: Pending → Verified → Approved → Download → Pool
- **Group-based organization** with ID card tables per group
- **Role-based permissions** (Super Admin, Admin Staff, Client, Client Staff)

### Card Printing
- 3-step workflow: **Print List** → **Finalized** → **Pool**
- Send approved cards to print from the ID card management view
- Bulk generation and status tracking

### Card Reprinting
- 4-step workflow: **Requested** → **Confirmed** → **Downloaded** → **Pool**
- Reprint request creation from pool/download status cards
- Confirm/reject flow with send-to-print integration

### Export System
- PDF export with digital signing (pyHanko)
- Excel export (openpyxl)
- Word document generation (python-docx)
- ZIP bundling for bulk downloads

### Website (Public)
- Landing page with hero slider, products carousel, testimonials
- Portfolio gallery with lightbox viewer
- Contact form with AJAX submission
- SEO optimized (robots.txt, sitemap.xml, structured data)
- PWA installable (service worker, offline support)

### Admin Dashboard
- Real-time stats cards (pending, verified, approved, downloaded)
- Recent activity feed
- Quick actions with permission controls
- Print & Reprint workflow overview (admin only)
- Global search across ID cards

---

## URL Structure

| URL Prefix | App | Description |
|------------|-----|-------------|
| `/` | website | Public website (landing, portfolio, testimonials) |
| `/panel/` | core | Admin panel dashboard & base views |
| `/panel/auth/` | accounts | Login, logout, OTP verification |
| `/panel/client/` | client | Client management (CRUD, staff) |
| `/panel/staff/` | staff | Admin staff management |
| `/panel/print/` | cardprint | Card printing workflow |
| `/panel/reprint/` | reprintcard | Card reprinting workflow |
| `/panel/exports/` | exports | Export generation |
| `/panel/images/` | mediafiles | Media file management |
| `/panel/website/` | website | Website content admin |
| `/panel/work/` | workflows | Workflow management |
| `/app/` | PWA | Mobile app (PWA) |
| `/admin/` | Django admin | Built-in Django admin |

Supports **subdomain routing** — separate domains for website and panel via `SubdomainRoutingMiddleware`.

---

## Setup

### Prerequisites
- Python 3.11+
- Node.js (for Tailwind CSS CLI)
- SQLite (dev) or PostgreSQL (production)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd "Adarsh FInal Deploye"

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Linux/Mac
.\venv\Scripts\Activate.ps1  # Windows

# Install dependencies
pip install -r requirements.txt
npm install

# Environment configuration
cp .env.example .env  # Create and edit .env with your settings
# Required: SECRET_KEY, DEBUG, ALLOWED_HOSTS, DATABASE_URL (production)

# Database setup
python manage.py migrate
python manage.py createsuperuser

# Build Tailwind CSS
npx @tailwindcss/cli -i tailwind-input.css -o static/css/tailwind.css

# Collect static files
python manage.py collectstatic

# Run development server
python manage.py runserver
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SECRET_KEY` | Django secret key | *Required* |
| `DEBUG` | Debug mode | `False` |
| `ALLOWED_HOSTS` | Comma-separated hosts | *Required in production* |
| `DATABASE_URL` | Database connection URL | SQLite (dev) |
| `WEBSITE_DOMAIN` | Public website domain | — |
| `PANEL_DOMAIN` | Admin panel domain | — |

---

## Deployment

Target: **1 GB RAM VPS** (Ubuntu/Debian)

1. **Setup swap** (2 GB recommended) — see `deployment/setup_swap_example.sh`
2. **Configure Nginx** — see `deployment/nginx_example.conf`
3. **Configure Gunicorn** (systemd) — see `deployment/gunicorn_example.service`
4. **Setup cron cleanup** — see `deployment/cron_cleanup_example.txt`
5. **Run migrations and collect static**
6. **Restart services**: `sudo systemctl restart gunicorn nginx`

See [`deployment/README.md`](deployment/README.md) for detailed instructions.

---

## Permissions System

Centralized via `PermissionService` in `core/services/permission_service.py`.

**Roles:**
- **Super Admin** — Full access to all features
- **Admin Staff** — Scoped access to assigned clients
- **Client** — Organization-level management
- **Client Staff** — Delegated permissions from parent client

**Permission categories:** ID card CRUD, status transitions, bulk operations, export, website management, mobile app access.

All permissions are injected into templates via context processor (`core/context_processors.py`).

---

## Middleware Stack

| Middleware | Purpose |
|-----------|---------|
| `SubdomainRoutingMiddleware` | Routes requests based on subdomain (website vs panel) |
| `WhiteNoiseMiddleware` | Serves static files efficiently |
| `RequestTimingMiddleware` | Logs request duration |
| `PermissionValidationMiddleware` | Validates user permissions per request |
| `SessionIdleTimeoutMiddleware` | Auto-logout after idle timeout |
| `SecurityHeadersMiddleware` | Adds security headers (CSP, X-Frame-Options, etc.) |
| `WebsiteOfflineMiddleware` | Enables maintenance mode for public website |

---

## License

Proprietary — All rights reserved.
