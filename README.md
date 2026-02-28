# Adarsh ID Cards — Management Platform

A production-grade, full-stack Django application for professional ID card design, printing, and management. Built for schools, colleges, and organizations to manage bulk ID card workflows end-to-end — from data upload to final print-ready output.

> **Live:** [adarshbhopal.in](https://adarshbhopal.in) (website) · [panel.adarshbhopal.in](https://panel.adarshbhopal.in) (admin)

---

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Architecture Overview](#architecture-overview)
3. [Project Structure](#project-structure)
4. [Django Apps](#django-apps)
5. [Data Models](#data-models)
6. [Features](#features)
7. [User Roles & Permissions](#user-roles--permissions)
8. [Permission Matrix](#permission-matrix)
9. [Middleware Stack](#middleware-stack)
10. [Services Architecture](#services-architecture)
11. [Background Task System](#background-task-system)
12. [Notification System](#notification-system)
13. [Activity Logging & Audit Trail](#activity-logging--audit-trail)
14. [Export System](#export-system)
15. [Face Cropper Engine](#face-cropper-engine)
16. [URL Structure & Routing](#url-structure--routing)
17. [PWA — Mobile App](#pwa--mobile-app)
18. [Public Website](#public-website)
19. [Email System](#email-system)
20. [Setup & Installation](#setup--installation)
21. [Environment Variables](#environment-variables)
22. [Deployment](#deployment)
23. [License](#license)

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Backend** | Django 5.2, Python 3.11+ | Core application framework |
| **Database** | SQLite (dev) / PostgreSQL (prod) | Data storage via Django ORM |
| **Frontend** | Tailwind CSS 4, Alpine.js, vanilla JS | Responsive UI with reactive components |
| **Interactivity** | HTMX | Server-rendered partial updates without SPA overhead |
| **PDF Generation** | ReportLab, xhtml2pdf | ID card & table PDF exports |
| **Excel** | openpyxl, xlrd | XLSX import/export |
| **Word** | python-docx | DOCX document generation |
| **Digital Signing** | pyHanko | PDF digital signatures |
| **Image Processing** | Pillow | Resize, crop, thumbnail generation |
| **Static Files** | WhiteNoise | Production-ready static serving with cache busting |
| **PWA** | Service Worker, Web App Manifest | Installable mobile app experience |
| **Deployment** | Gunicorn, Nginx, systemd | Production WSGI serving |
| **Environment** | python-dotenv | Secure configuration via `.env` |
| **Face Cropping** | FastAPI + PyInstaller (separate service) | Automatic passport photo cropping |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        NGINX (Reverse Proxy)                        │
│                   SSL termination · Static files                    │
├─────────────┬───────────────────────────────────┬───────────────────┤
│  Website    │         Panel Subdomain           │   PWA (/app/)     │
│  Subdomain  │   panel.adarshbhopal.in           │                   │
│  (public)   │                                   │                   │
└──────┬──────┴─────────────────┬─────────────────┴──────┬────────────┘
       │                        │                         │
       ▼                        ▼                         ▼
┌──────────────┐  ┌──────────────────────────┐  ┌────────────────────┐
│  Website     │  │     Admin Panel           │  │   Mobile PWA       │
│  URL Config  │  │     URL Config            │  │   (Alpine.js)      │
│  (public     │  │  ┌─────────────────────┐  │  │                    │
│   landing,   │  │  │   Django Views      │  │  │  Camera capture,   │
│   portfolio, │  │  │  (ultra-thin)       │  │  │  card list,        │
│   contact)   │  │  │       │             │  │  │  status changes    │
│              │  │  │       ▼             │  │  │                    │
│              │  │  │  Service Layer      │  │  │                    │
│              │  │  │  ┌───────────────┐  │  │  │                    │
│              │  │  │  │ Permission    │  │  │  │                    │
│              │  │  │  │ Service       │  │  │  │                    │
│              │  │  │  ├───────────────┤  │  │  │                    │
│              │  │  │  │ IDCard        │  │  │  │                    │
│              │  │  │  │ Service       │  │  │  │                    │
│              │  │  │  ├───────────────┤  │  │  │                    │
│              │  │  │  │ Workflow      │  │  │  │                    │
│              │  │  │  │ Service       │  │  │  │                    │
│              │  │  │  ├───────────────┤  │  │  │                    │
│              │  │  │  │ Export        │  │  │  │                    │
│              │  │  │  │ Service       │  │  │  │                    │
│              │  │  │  ├───────────────┤  │  │  │                    │
│              │  │  │  │ Background    │  │  │  │                    │
│              │  │  │  │ Worker (1)    │  │  │  │                    │
│              │  │  │  └───────┬───────┘  │  │  │                    │
│              │  │  │          │          │  │  │                    │
│              │  │  │          ▼          │  │  │                    │
│              │  │  │    Django ORM       │  │  │                    │
│              │  │  └─────────────────────┘  │  │                    │
└──────────────┘  └──────────────────────────┘  └────────────────────┘
                              │
                              ▼
                  ┌──────────────────────┐
                  │   SQLite / PostgreSQL │
                  └──────────────────────┘

                  ┌──────────────────────┐
                  │   Face Cropper       │
                  │   (FastAPI @ :4765)  │
                  │   Local Windows Svc  │
                  └──────────────────────┘
```

### Design Principles

1. **Ultra-Thin Views** — Views only parse requests, call services, and return responses. No model mutations (`.save()`, `.create()`, `.delete()`) in view files.
2. **Service Layer Authority** — All business logic lives in service classes under `core/services/`. Each service is the single authority for its domain.
3. **Permission-First** — Every API and page view checks permissions via `PermissionService` before any operation. Decorators enforce role requirements.
4. **Memory-Conscious** — Designed for 1 GB RAM VPS. Background worker uses single thread. Files processed from disk, never loaded fully into memory.
5. **Audit Everything** — `ActivityService` logs 30+ action types. All sensitive operations recorded with IP, user, and timestamp.

### Request Flow

```
Browser → Nginx → Gunicorn → SubdomainRoutingMiddleware
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
             Website URLs                    Panel URLs
                    │                               │
                    ▼                               ▼
            PermissionValidation            PermissionValidation
            Middleware                      Middleware
                    │                               │
                    ▼                               ▼
              View Function                  View Function
                    │                               │
                    ▼                               ▼
             Template Render               Service Layer
                                                │
                                    ┌───────────┼───────────┐
                                    ▼           ▼           ▼
                              Permission   Workflow    Activity
                              Service      Service     Service
                                    │           │           │
                                    ▼           ▼           ▼
                                        Django ORM
                                            │
                                            ▼
                                        Database
```

---

## Project Structure

```
Adarsh FInal Deploye/
├── accounts/                  # Authentication app
│   ├── models.py              #   (no custom models — uses core.User)
│   ├── services.py            #   OTP, login, password reset logic
│   ├── rate_limit.py          #   IP-based rate limiting
│   ├── views.py               #   Login, logout, OTP views
│   └── urls.py                #   Auth URL patterns
│
├── cardprint/                 # Card printing workflow app
│   ├── models.py              #   (no custom models — uses core.IDCard)
│   ├── services.py            #   Print workflow: send to print, finalize, pool
│   ├── views.py               #   3-step print pages + APIs
│   └── urls.py                #   Print URL patterns
│
├── client/                    # Client organization management app
│   ├── models.py              #   Client model (org/school profile + perms)
│   ├── services.py            #   Client dashboard, staff ops, image upload
│   ├── views.py               #   Client CRUD pages + APIs
│   └── urls.py                #   Client URL patterns
│
├── config/                    # Django project configuration
│   ├── settings.py            #   All settings (env-driven, production-ready)
│   ├── urls.py                #   Root URL config (local dev — both site + panel)
│   ├── urls_website.py        #   Website-only URL config (subdomain)
│   ├── urls_panel.py          #   Panel-only URL config (subdomain)
│   ├── wsgi.py                #   WSGI application entry point
│   └── asgi.py                #   ASGI application entry point
│
├── core/                      # Central app — models, permissions, base views
│   ├── models.py              #   Re-exports: User, Notification, ActivityLog, etc.
│   ├── middleware.py           #   7 custom middleware classes
│   ├── context_processors.py  #   Permission injection into all templates
│   ├── services/              #   Business logic layer (15+ service modules)
│   │   ├── permission_service.py    # Single authority for all permission checks
│   │   ├── idcard_service.py        # IDCard CRUD, search, field management
│   │   ├── workflow_service.py      # Status transitions (print + reprint)
│   │   ├── client_service.py        # Client CRUD
│   │   ├── staff_service.py         # Staff CRUD
│   │   ├── notification_service.py  # Notification broadcast + targeting
│   │   ├── activity_service.py      # Audit trail logging
│   │   ├── background_worker.py     # Singleton ThreadPoolExecutor
│   │   ├── bulk_upload_service.py   # XLSX + ZIP import
│   │   ├── bulk_upload_processor.py # Memory-efficient bulk processing
│   │   ├── reupload_processor.py    # Image reupload from ZIP
│   │   ├── export_processor.py      # Background export handlers
│   │   ├── user_profile_service.py  # Profile management
│   │   ├── task_cleanup.py          # Stale task & file cleanup
│   │   └── base.py                  # ServiceResult dataclass
│   ├── views/                 #   Split view modules
│   │   ├── base.py            #     Dashboard, staff/client mgmt, settings
│   │   ├── auth.py            #     Login/logout/OTP/password reset
│   │   ├── idcard_api.py      #     IDCard CRUD APIs (30+ endpoints)
│   │   ├── notification_api.py#     Notification list/read/create APIs
│   │   ├── engine_api.py      #     Face Cropper proxy APIs
│   │   ├── cropper_api.py     #     Cropper version/webhook APIs
│   │   └── task_api.py        #     Background task status/cancel APIs
│   ├── utils/                 #   Utility modules
│   │   ├── htmx.py            #     HTMX detection and partial rendering
│   │   ├── threaded_email.py  #     Async email sending (background thread)
│   │   └── image_helpers.py   #     Image manipulation utilities
│   ├── templatetags/          #   Custom template filters
│   │   └── custom_filters.py  #     humanize_header, wrap_header, etc.
│   ├── management/            #   Custom management commands
│   └── migrations/            #   Database migration files
│
├── exports/                   # Export generation app
│   ├── pdf.py                 #   PDF table export (ReportLab + xhtml2pdf)
│   ├── excel.py               #   XLSX export (openpyxl)
│   ├── word.py                #   DOCX export (python-docx)
│   ├── zip.py                 #   ZIP image bundling
│   ├── column_spec.py         #   Column sizing intelligence (90+ field patterns)
│   ├── services.py            #   Export orchestration (read-only)
│   ├── tasks.py               #   Background export task creation
│   └── urls.py                #   Export URL patterns
│
├── mediafiles/                # Protected media management app
│   ├── models.py              #   CardMedia, ImageProcessingLog
│   ├── services/              #   Image upload, thumbnail, optimization
│   ├── constants.py           #   Max sizes, allowed formats
│   └── urls.py                #   Media URL patterns
│
├── reprintcard/               # Card reprinting workflow app
│   ├── models.py              #   (no custom models — uses core.IDCard)
│   ├── services.py            #   Reprint workflow: request, confirm, download
│   ├── views.py               #   4-step reprint pages + APIs
│   └── urls.py                #   Reprint URL patterns
│
├── staff/                     # Admin staff management app
│   ├── models.py              #   Staff model (profile + perms + assignments)
│   └── urls.py                #   Staff URL patterns
│
├── website/                   # Public website app
│   ├── models.py              #   10+ content models (hero, portfolio, FAQ, etc.)
│   ├── services.py            #   Website content CRUD
│   ├── views.py               #   Landing, portfolio, contact, sitemap
│   └── urls.py                #   Public URL patterns
│
├── workflows/                 # Workflow engine app
│   ├── models.py              #   IDCardGroup, IDCardTable, IDCard models
│   └── (views in core)        #   Views handled by core app
│
├── PWA/                       # Progressive Web App
│   ├── mobile_app/            #   Mobile-specific views, templates, APIs
│   ├── static/                #   Service worker, manifest, offline assets
│   └── templates/             #   Mobile UI templates
│
├── Face Cropper/              # Standalone face cropping engine
│   ├── main.py                #   FastAPI application
│   ├── passport_engine_core/  #   Image processing module
│   ├── installer/             #   InnoSetup installer scripts
│   └── DEPLOYMENT.md          #   Engine deployment guide
│
├── templates/                 # Django HTML templates
│   ├── base.html              #   Base template (shared layout)
│   ├── dashboard/             #   Role-specific dashboards
│   ├── partials/              #   Reusable template partials
│   ├── components/            #   UI components (toast, modal, etc.)
│   └── ...                    #   Page templates
│
├── static/                    # Static assets (source)
│   ├── css/                   #   Stylesheets (Tailwind + custom)
│   ├── js/                    #   JavaScript modules
│   ├── assets/                #   Images, fonts, favicon
│   └── vendor/                #   Third-party libraries
│
├── deployment/                # Production deployment configs
│   ├── nginx_example.conf     #   Nginx reverse proxy config
│   ├── gunicorn_example.service #  Systemd service file
│   ├── gunicorn.conf_example.py # Gunicorn worker config
│   ├── setup_swap_example.sh  #   Swap file setup script
│   └── README.md              #   Deployment instructions
│
├── manage.py                  # Django management CLI
├── requirements.txt           # Python dependencies
├── package.json               # Node.js (Tailwind CSS CLI)
├── tailwind-input.css         # Tailwind CSS input file
└── db.sqlite3                 # Development database
```

---

## Django Apps

| App | Purpose | Has Models? |
|-----|---------|-------------|
| `core` | Central hub — User model, permissions, middleware, context processors, base views, all services | Yes (User, Notification, ActivityLog, BackgroundTask, SystemSettings, ExportTemplate, CropperRelease) |
| `accounts` | Authentication — login, OTP verification, password reset, rate limiting, session management | No (uses core.User) |
| `client` | Client organization CRUD — company/school profiles, client staff management, group settings | Yes (Client) |
| `staff` | Admin staff management — role assignment, client assignment, permissions | Yes (Staff) |
| `workflows` | Data models for ID card workflow — groups, tables, cards | Yes (IDCardGroup, IDCardTable, IDCard) |
| `cardprint` | Card printing workflow — 3-step: Print List → Finalized → Pool | No (uses workflow models) |
| `reprintcard` | Card reprinting workflow — 4-step: Requested → Confirmed → Downloaded → Pool | No (uses workflow models) |
| `exports` | Multi-format export engine — PDF, XLSX, DOCX, ZIP generation | No (uses workflow models) |
| `mediafiles` | Protected media file management — image upload, thumbnails, optimization | Yes (CardMedia, ImageProcessingLog) |
| `website` | Public-facing website — landing page, portfolio, testimonials, FAQ, contact, SEO | Yes (10+ content models) |
| `PWA` | Progressive Web App — mobile-optimized interface with camera capture | No (proxy APIs to core) |

---

## Data Models

### Core Domain Models

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│      User        │     │     Client       │     │     Staff        │
│  ─────────────── │     │  ─────────────── │     │  ─────────────── │
│  role (enum)     │◄────│  user (1:1)      │     │  user (1:1)      │
│  email           │     │  name            │     │  client (FK)     │
│  phone           │     │  address/city    │     │  assigned_clients│
│  is_active       │     │  status          │     │  assigned_groups │
│                  │◄────│  image_folder    │     │  allowed_classes │
│                  │     │  32 perm_* flags │     │  37 perm_* flags │
└──────────────────┘     └────────┬─────────┘     └──────────────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    ▼                           ▼
          ┌──────────────────┐        ┌──────────────────┐
          │   IDCardGroup    │        │    CardMedia      │
          │  ─────────────── │        │  ─────────────── │
          │  client (FK)     │        │  card (FK)        │
          │  name            │        │  field_name       │
          │                  │        │  image file       │
          └────────┬─────────┘        │  thumbnail        │
                   │                  └──────────────────┘
                   ▼
          ┌──────────────────┐
          │   IDCardTable    │
          │  ─────────────── │
          │  group (FK)      │
          │  name            │
          │  fields (JSON)   │◄── [{name, type, order}]
          │  max 20 fields   │
          └────────┬─────────┘
                   │               Field Types:
                   ▼               ─────────────
          ┌──────────────────┐     text, email, class,
          │     IDCard       │     section, photo,
          │  ─────────────── │     mother_photo,
          │  table (FK)      │     father_photo,
          │  field_data (JSON)│    barcode, qr_code,
          │  status (enum)   │     signature
          │  created_by      │
          │  updated_by      │
          └──────────────────┘

Status Workflow:
  pending → verified → pool → approved → download
                                            │
                                            ▼
                                         reprint
```

### System Models

| Model | Purpose |
|-------|---------|
| **Notification** | Broadcast/targeted messages with priority (low/normal/high/urgent), category (general/announcement/update/maintenance/alert), and targeting (all/role/selected users) |
| **NotificationRead** | Per-user read tracking for notifications |
| **BackgroundTask** | Async task queue — tracks status, progress, result files, metadata. Types: bulk_upload, reupload_images, export_zip/pdf/docx/excel |
| **ActivityLog** | Append-only audit trail — 30+ action types, IP tracking, target model references |
| **SystemSettings** | Key-value configuration store with 5-minute cache |
| **ExportTemplate** | User-defined export templates with custom footer instructions for PDF/Word |
| **CropperRelease** | Face Cropper version tracking — version, download URL, changelog, is_latest |

### Website Models

| Model | Purpose |
|-------|---------|
| **WebsiteStatus** | Singleton — toggles public website between Live and Draft (503 offline) |
| **BusinessDetails** | Singleton — site name, tagline, contact info, social media, hero section, SEO |
| **HeroImage** | Dynamic hero slider — unlimited images with ordering, per-image title/subtitle |
| **Feature** | "Why Choose Us" section items — icon, title, description |
| **PortfolioCategory** | 9 default categories (ID Cards, Lanyards, Certificates, etc.) + custom |
| **PortfolioItem** | Gallery items — image/video/reel support, orientation variants |
| **TrustedClient** | Logo carousel for social proof |
| **Testimonial** | Customer reviews with star ratings |
| **FAQ** | Frequently asked questions |
| **Reel** | Short video showcases |
| **ContactSubmission** | Form submissions with email automation retry (exponential backoff) |

---

## Features

### ID Card Management
- **Dynamic field schema** — each table defines its own fields (text, email, photo, barcode, etc.)
- **Multi-status workflow** — Pending → Verified → Pool → Approved → Download
- **Group-based organization** — clients have groups containing tables of cards
- **Individual card CRUD** — add, edit, delete, view details, reupload photo
- **Card search** — search across all fields within a table
- **Field upgrades** — batch class/section upgrades
- **Horizontal scroll tables** — large datasets scroll properly without wrapping
- **Humanized headers** — automatic word splitting for concatenated field names

### Card Printing (3-Step)
| Step | Status | Action |
|------|--------|--------|
| 1 | **Print List** | Cards sent from Approved status → ready for printing |
| 2 | **Finalized** | Print confirmed → cards marked as finalized |
| 3 | **Pool** | Finalized cards moved to permanent pool |

### Card Reprinting (4-Step)
| Step | Status | Action |
|------|--------|--------|
| 1 | **Requested** | Reprint request created from pool/download cards |
| 2 | **Confirmed** | Admin confirms the reprint request |
| 3 | **Downloaded** | Reprint data downloaded for printing |
| 4 | **Pool** | Reprinted cards returned to pool |

### Bulk Operations (Admin Only)
- **Bulk Upload** — XLSX + ZIP import (up to 5,000 rows, batch size 100)
- **Bulk Download** — Export as PDF, XLSX, DOCX, or ZIP with images
- **Bulk Reupload** — Replace all images via ZIP file
- **Bulk Delete** — Delete all cards in a table (with verification code)
- **Bulk Status Change** — Move multiple cards between statuses

### Export System
| Format | Content | Features |
|--------|---------|----------|
| **PDF** | Text + images | Landscape A4, dynamic columns, thumbnails, repeating headers, digital signing (pyHanko) |
| **Excel** | Text only | Auto-sized columns, frozen headers, consistent formatting |
| **Word** | Text + images | Institution header, branded footer, 7 entries/page, image borders |
| **ZIP** | Images only | Separate ZIPs per image field, sanitized filenames |

### Dashboard & Management
- **Role-specific dashboards** — Super Admin, Admin Staff, Client, Client Staff each see relevant data
- **Real-time stats** — pending, verified, approved, downloaded card counts
- **Recent activity feed** — role-filtered activity log
- **Notification bar** — in-app notifications with unread badge
- **Global search** — search across ID cards from any page
- **Manage Panel** — system administration with tabs:
  - Notifications management (create/broadcast)
  - Download Templates (export template CRUD)
  - Log History (searchable/filterable activity logs)
  - System Info (version, health, configuration)

### Public Website
- **Landing page** — hero slider, product carousel, features section
- **Portfolio gallery** — categorized gallery with lightbox viewer
- **Testimonials** — customer reviews with star ratings
- **FAQ section** — collapsible Q&A
- **Contact form** — AJAX submission with email automation
- **SEO optimized** — robots.txt, sitemap.xml, structured data, meta tags
- **Maintenance mode** — toggle website offline with 503 page

### Progressive Web App (Mobile)
- **Installable** — service worker + web app manifest
- **Camera capture** — take photos directly from mobile
- **Card management** — view, add, edit, status change on mobile
- **Role-based UI** — adapts to user role
- **Offline support** — cached pages for offline access

### Email System
- **Branded HTML emails** — gradient header, styled body, branded footer
- **OTP verification** — 6-digit code with expiry, styled email template
- **Welcome email** — sent on account creation
- **Password change notification** — security alert on password change
- **Contact form auto-reply** — with exponential retry backoff
- **Async sending** — all emails dispatched via background thread (non-blocking)

---

## User Roles & Permissions

### Role Hierarchy

```
┌─────────────────────────────────────────────────┐
│                 SUPER ADMIN                      │
│  Full access to everything. Always passes all   │
│  permission checks. Manages the entire system.  │
├─────────────────────────────────────────────────┤
│               ADMIN STAFF                        │
│  Scoped to assigned clients only. Has granular  │
│  per-feature toggles. Website management.       │
│  Can perform bulk operations and exports.       │
├─────────────────────────────────────────────────┤
│                 CLIENT                           │
│  Organization/school owner. Manages their own   │
│  groups, tables, and cards. Can delegate        │
│  permissions to their client staff.             │
│  ⛔ No bulk operations or image reupload.       │
├─────────────────────────────────────────────────┤
│              CLIENT STAFF                        │
│  Delegated access from parent client.           │
│  Double-gated: staff perm AND client perm       │
│  must both be True. Most restricted role.       │
│  ⛔ No bulk operations or image reupload.       │
└─────────────────────────────────────────────────┘
```

### Permission Resolution

| Role | How Permissions Are Checked |
|------|----------------------------|
| **Super Admin** | Always `True` — bypasses all permission checks |
| **Admin Staff** | `staff_profile.<perm>` must be `True`. If a client is specified, staff must also be assigned to that client. |
| **Client** | `client_profile.<perm>` must be `True`. Client status must be `active`. |
| **Client Staff** | **Double-gated**: `staff_profile.<perm> AND client.<perm>` must both be `True`. Client status must be `active`. If the perm doesn't exist on the Staff model, inherits from client. |

### Blocked Permissions (Admin Only)

These permissions are **always denied** for Client and Client Staff roles at the service level, regardless of database flags:

| Permission | Description |
|------------|-------------|
| `perm_idcard_bulk_upload` | Bulk upload cards via XLSX + ZIP |
| `perm_idcard_bulk_download` | Bulk download/export cards |
| `perm_idcard_bulk_reupload` | Bulk reupload all images via ZIP |
| `perm_delete_all_idcard` | Delete all cards in a table |
| `perm_reupload_idcard_image` | Reupload individual card image |

Only **Super Admin** and **Admin Staff** can perform these operations.

---

## Permission Matrix

### Legend
- ✅ = Available (can be toggled on/off per user)
- ⛔ = Blocked (always denied regardless of flags)
- 🔓 = Always granted
- 🔗 = Inherited (double-gated from parent client)

### ID Card Client & Settings Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| View client list (`perm_idcard_client_list`) | 🔓 | ✅ | ✅ | 🔗 |
| View settings (`perm_idcard_setting_list`) | 🔓 | ✅ | ✅ | 🔗 |
| Add table (`perm_idcard_setting_add`) | 🔓 | ✅ | ✅ | 🔗 |
| Edit table (`perm_idcard_setting_edit`) | 🔓 | ✅ | ✅ | 🔗 |
| Delete table (`perm_idcard_setting_delete`) | 🔓 | ✅ | ✅ | 🔗 |
| Toggle table status (`perm_idcard_setting_status`) | 🔓 | ✅ | ✅ | 🔗 |
| Create group (`perm_idcard_group_create`) | 🔓 | ✅ | ✅ | 🔗 |
| Delete group (`perm_idcard_group_delete`) | 🔓 | ✅ | ✅ | 🔗 |

### ID Card List (Tab Visibility) Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Pending list (`perm_idcard_pending_list`) | 🔓 | ✅ | ✅ | 🔗 |
| Verified list (`perm_idcard_verified_list`) | 🔓 | ✅ | ✅ | 🔗 |
| Pool list (`perm_idcard_pool_list`) | 🔓 | ✅ | ✅ | 🔗 |
| Approved list (`perm_idcard_approved_list`) | 🔓 | ✅ | ✅ | 🔗 |
| Download list (`perm_idcard_download_list`) | 🔓 | ✅ | ✅ | 🔗 |
| Reprint list (`perm_idcard_reprint_list`) | 🔓 | ✅ | ✅ | 🔗 |

### ID Card Action Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Add card (`perm_idcard_add`) | 🔓 | ✅ | ✅ | 🔗 |
| Edit card (`perm_idcard_edit`) | 🔓 | ✅ | ✅ | 🔗 |
| Delete card (`perm_idcard_delete`) | 🔓 | ✅ | ✅ | 🔗 |
| View card info (`perm_idcard_info`) | 🔓 | ✅ | ✅ | 🔗 |
| Approve card (`perm_idcard_approve`) | 🔓 | ✅ | ✅ | 🔗 |
| Verify card (`perm_idcard_verify`) | 🔓 | ✅ | ✅ | 🔗 |
| Show created date (`perm_idcard_created_at`) | 🔓 | ✅ | ✅ | 🔗 |
| Show updated date (`perm_idcard_updated_at`) | 🔓 | ✅ | ✅ | 🔗 |
| Delete from pool (`perm_idcard_delete_from_pool`) | 🔓 | ✅ | ✅ | 🔗 |
| Retrieve from pool (`perm_idcard_retrieve`) | 🔓 | ✅ | ✅ | 🔗 |
| Upgrade all classes (`perm_idcard_upgrade_all`) | 🔓 | ✅ | ✅ | 🔗 |

### Bulk & Reupload Permissions (Admin Only)

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Bulk upload (`perm_idcard_bulk_upload`) | 🔓 | ✅ | ⛔ | ⛔ |
| Bulk download (`perm_idcard_bulk_download`) | 🔓 | ✅ | ⛔ | ⛔ |
| Bulk reupload (`perm_idcard_bulk_reupload`) | 🔓 | ✅ | ⛔ | ⛔ |
| Delete all cards (`perm_delete_all_idcard`) | 🔓 | ✅ | ⛔ | ⛔ |
| Reupload image (`perm_reupload_idcard_image`) | 🔓 | ✅ | ⛔ | ⛔ |

### Website & Mobile Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| View website content (`perm_website_view`) | 🔓 | ✅ | — | — |
| Add website content (`perm_website_add`) | 🔓 | ✅ | — | — |
| Edit website content (`perm_website_edit`) | 🔓 | ✅ | — | — |
| Delete website content (`perm_website_delete`) | 🔓 | ✅ | — | — |
| Publish website (`perm_website_publish`) | 🔓 | ✅ | — | — |
| Mobile app access (`perm_mobile_app`) | 🔓 | ✅ | ✅ | 🔗 |

> **Note:** Website permissions only exist on the Staff model. Client/Client Staff roles do not have website management capabilities.

---

## Middleware Stack

Middleware executes in order for every request. Custom middleware enforces security, performance monitoring, and session management.

| # | Middleware | Source | Purpose |
|---|-----------|--------|---------|
| 1 | `SubdomainRoutingMiddleware` | core | Routes by `Host` header: website domain → `urls_website`, panel domain → `urls_panel`. Strips `/panel/` prefix for backward compat. |
| 2 | `SecurityMiddleware` | Django | Standard HTTPS redirects, HSTS headers |
| 3 | `WhiteNoiseMiddleware` | whitenoise | Serves static files with content-hash cache busting |
| 4 | `SessionMiddleware` | Django | Session management |
| 5 | `CommonMiddleware` | Django | URL normalization, `Content-Length` header |
| 6 | `CsrfViewMiddleware` | Django | CSRF protection for POST/PUT/DELETE |
| 7 | `AuthenticationMiddleware` | Django | Associates `request.user` from session |
| 8 | `MessageMiddleware` | Django | Flash messages (placed before custom middleware) |
| 9 | `RequestTimingMiddleware` | core | Logs request duration via `Server-Timing` header. Warns on >1.5s requests, >50 queries, >0.1s individual queries. |
| 10 | `PermissionValidationMiddleware` | core | Re-fetches user from DB every 10s to detect deactivation. Forces logout if user inactive, client suspended, or staff reassigned. Annotates `request.user_scope`. |
| 11 | `SessionIdleTimeoutMiddleware` | core | Auto-logout after configurable idle timeout (default 30 days). Handles both browser and AJAX/HTMX requests. |
| 12 | `SecurityHeadersMiddleware` | core | Adds `Permissions-Policy`, `Cache-Control: no-store` for panel pages, `X-Robots-Tag: noindex` on panel subdomain. |
| 13 | `WebsiteOfflineMiddleware` | core | Returns 503 offline page when `WebsiteStatus` is `draft`. Only affects public routes — admin, static, media, API bypass. |
| 14 | `XFrameOptionsMiddleware` | Django | Clickjacking protection (`X-Frame-Options: DENY`) |

---

## Services Architecture

All business logic resides in the service layer (`core/services/`). Views are ultra-thin — they parse the request, call a service, and return the response. No model mutations ever occur in view files.

### Service Modules

| Service | File | Responsibility |
|---------|------|----------------|
| **PermissionService** | `permission_service.py` | **Single authority** for all permission checks. Role identification, `has()` method, client scoping, context generation, decorators. |
| **IDCardService** | `idcard_service.py` | **Single authority** for IDCard/IDCardTable mutations. CRUD, search, field upgrades, default-group provisioning. |
| **WorkflowService** | `workflow_service.py` | **Single authority** for card status transitions. Enforces transition matrix, validates mandatory fields, checks image presence. |
| **ReprintWorkflowService** | `workflow_service.py` | Status transitions for reprint cards — parallel workflow service. |
| **ClientService** | `client_service.py` | Client CRUD, serialization, image folder management. |
| **StaffService** | `staff_service.py` | Staff CRUD for both admin_staff and client_staff, permission management. |
| **NotificationService** | `notification_service.py` | Create/broadcast/target notifications, read tracking, optional email alerts. |
| **ActivityService** | `activity_service.py` | Non-blocking audit logging. 30+ action types. Role-filtered queries. |
| **BackgroundWorker** | `background_worker.py` | Singleton `ThreadPoolExecutor` (max_workers=1). Task routing, timeout, cleanup. |
| **UserProfileService** | `user_profile_service.py` | Profile updates, password changes, validation. |
| **ExportService** | `exports/services.py` | Export orchestration — delegates to PDF, Excel, Word, ZIP modules. |
| **ImageService** | `mediafiles/services/` | Image upload, thumbnail generation, optimization. |

### ServiceResult Pattern

All services return a standardized `ServiceResult` dataclass:

```python
@dataclass
class ServiceResult:
    success: bool       # Whether the operation succeeded
    message: str        # Human-readable message
    data: dict = None   # Payload (optional)
    errors: dict = None # Validation errors (optional)
```

---

## Background Task System

Designed for **1 GB RAM VPS** — uses a single-threaded worker to prevent memory exhaustion.

### Architecture

```
User Request → Create BackgroundTask (DB) → BackgroundWorker Queue
                                                    │
                                              Single Thread
                                                    │
                                    ┌───────────────┼───────────────┐
                                    ▼               ▼               ▼
                              Bulk Upload     Export (PDF/     Reupload
                              Processor       XLSX/DOCX/ZIP)  Processor
                                    │               │               │
                                    ▼               ▼               ▼
                              Disk-Based Processing (never in-memory)
                                    │               │               │
                                    ▼               ▼               ▼
                              Update Progress → Mark Complete → Cleanup
```

### Task Types & Handlers

| Type | Handler | Max Rows | Description |
|------|---------|----------|-------------|
| `bulk_upload` | `process_bulk_upload()` | 5,000 | XLSX + ZIP, batch size 100, RAM threshold for small ZIPs |
| `reupload_images` | `process_reupload_images()` | — | ZIP image matching, one image at a time |
| `export_zip` | `process_export_zip()` | 5,000 | Image ZIP export with ZIP_STORED |
| `export_pdf` | `process_export_pdf()` | 5,000 | PDF table with thumbnails |
| `export_docx` | `process_export_docx()` | 5,000 | Word document with images |
| `export_excel` | `process_export_excel()` | 5,000 | XLSX data export |

### Safeguards

| Safeguard | Detail |
|-----------|--------|
| **1 active task per user** | Checked atomically via `select_for_update()` |
| **System queue limit** | Max 10 pending/processing tasks system-wide |
| **Failsafe timeout** | 30 minutes — tasks exceeding this auto-fail |
| **Stale cleanup** | Tasks pending/processing >24h marked as failed |
| **Result cleanup** | Completed tasks >7 days purged with files |
| **Orphaned temp files** | Cleaned after every task completion |

### Status Flow

```
pending → processing → completed
                    └→ failed
                    └→ cancelled
```

---

## Notification System

Multi-channel notification system supporting broadcast and targeted delivery.

### User-Facing API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/notifications/list/` | List notifications (paginated, unread filter) |
| `GET` | `/api/notifications/unread-count/` | Badge count for navbar |
| `POST` | `/api/notifications/<id>/read/` | Mark single as read |
| `POST` | `/api/notifications/mark-all-read/` | Mark all as read |

### Admin API (Super Admin Only)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/notifications/admin/list/` | List all notifications for management |
| `POST` | `/api/notifications/admin/create/` | Create + broadcast notification |
| `DELETE` | `/api/notifications/admin/<id>/delete/` | Delete/deactivate notification |
| `GET` | `/api/notifications/admin/target-users/` | Get users by role for picker |

### Notification Properties

| Property | Options |
|----------|---------|
| **Priority** | low, normal, high, urgent |
| **Category** | general, announcement, update, maintenance, alert |
| **Target** | all, super_admin, admin_staff, client, client_staff, selected (specific users) |
| **Email Alert** | Optional — sent via background thread |

### Dashboard Integration

- **Notification bar** on all dashboards — shows 5 most recent with unread count badge
- **Notifications page** (`/notifications/`) — full list with pagination and mark-all-read
- Click-to-mark-read behavior

---

## Activity Logging & Audit Trail

Non-blocking, append-only audit logging covering 30+ action types.

### Action Types

| Category | Actions Logged |
|----------|---------------|
| **Authentication** | login, logout |
| **Client Management** | client_create, client_update, client_delete, client_status_change |
| **Staff Management** | staff_create, staff_update, staff_delete, staff_status_change |
| **Card Operations** | card_create, card_status_change (single & bulk), image_upload |
| **Bulk Operations** | card_bulk_upload, card_bulk_delete, card_bulk_upgrade |
| **Website** | website_update |
| **Settings** | settings_update |

### Role-Based Filtering

| Role | What They See |
|------|---------------|
| **Super Admin** | All activity |
| **Admin Staff** | Their own + assigned client activities |
| **Client** | Own activity + their staff activity (admin names hidden as "System") |
| **Client Staff** | Only their own activities |

### Log Entry Contents

Each entry records: user, action type, description, target model/ID/name, IP address, timestamp, icon class, and color for dashboard rendering.

### API

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `GET` | `/api/activity-logs/` | Paginated, searchable, filterable by action type |

---

## Export System

### Export Formats

| Module | Format | Content | Key Features |
|--------|--------|---------|-------------|
| `pdf.py` | PDF | Text + images | Landscape A4, dynamic column widths (via `column_spec.py`), thumbnails, repeating header/footer, UPPERCASE text, 1cm margins |
| `excel.py` | XLSX | Text only | Auto-sized columns, frozen header row, consistent formatting |
| `word.py` | DOCX | Text + images | Landscape A4, institution header, branded footer, 7 entries/page, image borders |
| `zip.py` | ZIP | Images only | Separate ZIP per image field, Base64 output for JS downloads, sanitized filenames |

### Column Intelligence

`column_spec.py` is the **single source of truth** for column sizing across all formats. It recognizes **90+ field-name variations** common in Indian ID card, school, and HR systems — automatically determining:

- Min/preferred/max character widths
- Wrap behavior
- Text alignment
- PDF percentage / Word centimeters / HTML Tailwind classes

### Export Safety

| Control | Detail |
|---------|--------|
| **Permission** | `perm_idcard_bulk_download` required |
| **Status guard** | Clients blocked from exporting approved/download cards |
| **Row limit** | Max 5,000 card IDs per request |
| **Scope** | Client scoping enforced via `PermissionService.can_access_client()` |
| **Templates** | Custom `ExportTemplate` support for footer instructions |

---

## Face Cropper Engine

A **standalone FastAPI application** (compiled to Windows EXE via PyInstaller) for automatic passport/ID photo cropping.

### Overview

| Property | Value |
|----------|-------|
| **Name** | AdarshCropper / Passport Engine |
| **Tech** | FastAPI + PyInstaller |
| **Runs as** | Windows background service via NSSM |
| **Address** | `127.0.0.1:4765` |
| **Auth** | `X-ENGINE-KEY` header |

### Engine API

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/status` | Version check |
| `GET` | `/health` | Memory + uptime health probe |
| `POST` | `/process-zip` | Batch crop from ZIP upload |
| `POST` | `/process-folder` | Batch crop from folder path |

### Integration with Admin Panel

- **Cropper page** compares installed version vs latest `CropperRelease`
- **CI/CD webhook** (`/api/cropper/release-webhook/`) auto-creates release records
- **Proxy APIs** in Django — browser talks to Django, Django proxies to engine (avoids CORS):
  - `/api/engine/status/` — check engine status
  - `/api/engine/process-folder/` — trigger folder processing
  - `/api/engine/preview/` — preview cropped image
  - `/api/engine/serve-image/` — serve processed image
  - `/api/engine/save-edited/` — save manual edits
  - `/api/engine/delete-image/` — delete image

### Deployment

- Installs to `C:\Program Files\PassportEngine\`
- Auto-starts on boot, auto-restarts on crash (5s delay)
- Rotating log files (5 MB, 3 backups)

---

## URL Structure & Routing

### Subdomain Routing

The application supports **two subdomains** via `SubdomainRoutingMiddleware`:

| Subdomain | URL Config | Purpose |
|-----------|------------|---------|
| `www.adarshbhopal.in` | `config.urls_website` | Public website only |
| `panel.adarshbhopal.in` | `config.urls_panel` | Admin panel + PWA + APIs |

In local development, both URL configs merge into `config.urls` for single-domain access.

### Panel URL Map

| URL Prefix | App | Description |
|------------|-----|-------------|
| `/` | core | Dashboard, staff/client management, ID card views |
| `/auth/` | accounts | Login, logout, OTP verification |
| `/client/` | client | Client dashboard, staff management |
| `/staff/` | staff | Admin staff management |
| `/print/` | cardprint | Card printing 3-step workflow |
| `/reprint/` | reprintcard | Card reprinting 4-step workflow |
| `/exports/` | exports | Export download endpoints |
| `/images/` | mediafiles | Protected media serving |
| `/website/` | website | Website content admin |
| `/work/` | workflows | Workflow management |
| `/app/` | PWA | Progressive web app (mobile) |
| `/notifications/` | core | Notifications page (all users) |
| `/manage-panel/` | core | System administration (super admin) |
| `/settings/` | core | User settings & profile |
| `/admin/` | Django | Built-in Django admin |

### Key API Endpoints

| Category | Endpoints | Count |
|----------|-----------|-------|
| Authentication | login, logout, check-email, forgot-password, verify-otp, reset-password | 6 |
| Client CRUD | create, get, update, delete, toggle-status, staff, set-temp-password | 7 |
| Staff CRUD | create, get, update, delete, toggle-status, set-temp-password | 6 |
| ID Card Table | list, create, get, update, delete, toggle-status, create-from-xlsx | 7 |
| ID Card | list, get, create, update, update-field, delete, status, bulk-status, bulk-delete, bulk-upload, search, filter-options, all-ids, reupload | 14 |
| Notifications | list, unread-count, mark-read, mark-all-read, admin-list, admin-create, admin-delete, target-users | 8 |
| Export | download-xlsx, download-pdf, download-pdf-async, download-docx, download-all, export-images, export-status | 7 |
| Background Tasks | status, download, cancel, list, active, create-bulk-upload, create-reupload, create-export | 8 |
| Profile | get, update, change-password, upload-image, remove-image | 5 |
| Engine | status, process-folder, preview, serve-image, save-edited, delete-image | 6 |
| Settings | export-settings, export-templates CRUD, activity-logs | 6 |
| **Total** | | **80+** |

---

## PWA — Mobile App

Progressive Web App for mobile access, enforcing `perm_mobile_app` permission.

### Features

| Feature | Description |
|---------|-------------|
| Home dashboard | Real card counts + recent activity |
| Client list | For admin roles |
| Table picker | Select by status |
| Card list | Per table/status with search |
| Card detail | Individual card view |
| Camera capture | Photograph directly from mobile |
| Notifications | In-app notification center |
| Profile | User profile management |
| Staff management | CRUD (for admin roles) |
| Groups | ID card group overview |
| Search | Cross-table search |

### Access Control

- All 4 roles supported
- `perm_mobile_app` enforced (super admin always passes)
- Desktop users see a block page
- Login redirect preserves `?next=/panel/app/`

---

## Public Website

### Content Sections

| Section | Model | Description |
|---------|-------|-------------|
| Hero Slider | `HeroImage` | Full-width image slider with per-slide titles |
| Products | `Feature` | "Why Choose Us" cards with FontAwesome icons |
| Portfolio | `PortfolioCategory` + `PortfolioItem` | Categorized gallery (9 defaults: ID Cards, Lanyards, Certificates, Marksheets, Fee Cards, Invitations, Visiting Cards, Brochures, Others) |
| Trusted Clients | `TrustedClient` | Logo carousel for social proof |
| Testimonials | `Testimonial` | Star-rated customer reviews |
| FAQ | `FAQ` | Collapsible question-answer pairs |
| Reels | `Reel` | Short video showcases |
| Contact | `ContactSubmission` | AJAX form with admin notification |
| Business Info | `BusinessDetails` | Site name, tagline, contact details, social media, SEO |

### SEO Features

- `robots.txt` — crawl instructions
- `sitemap.xml` — XML sitemap generation
- Structured data (JSON-LD)
- Meta tags (title, description, keywords)
- Open Graph / Twitter Card tags
- `X-Robots-Tag: noindex` on panel subdomain

### Maintenance Mode

`WebsiteStatus` singleton — toggle between **Live** and **Draft**. Draft mode shows 503 maintenance page. Admin panel, static files, media, and API routes always bypass.

---

## Email System

All emails are sent asynchronously via background threads to prevent request blocking.

### Email Types

| Email | Trigger | Format |
|-------|---------|--------|
| **OTP Verification** | Password reset request | Branded HTML — gradient header, large OTP code box, security notice, branded footer |
| **Welcome Email** | Account creation | Branded HTML — welcome message with login link |
| **Password Changed** | Password change | Branded HTML — security alert notification |
| **Contact Auto-Reply** | Contact form submission | HTML with exponential retry backoff |

### Infrastructure

- `send_html_email_async()` — dispatches HTML email via `threading.Thread`
- `send_mail_async()` — dispatches plain text email via background thread
- Non-blocking — email failures never break the main request
- Retry with exponential backoff for contact form emails (1min → 10min → 1hr → 24hr)

---

## Setup & Installation

### Prerequisites

- Python 3.11+
- Node.js 18+ (for Tailwind CSS CLI)
- SQLite (development) or PostgreSQL (production)

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd "Adarsh FInal Deploye"

# Create virtual environment
python -m venv venv
source venv/bin/activate        # Linux/Mac
.\venv\Scripts\Activate.ps1     # Windows PowerShell

# Install Python dependencies
pip install -r requirements.txt

# Install Node.js dependencies (Tailwind CSS)
npm install

# Create environment configuration
cp .env.example .env
# Edit .env with your SECRET_KEY and other settings

# Run database migrations
python manage.py migrate

# Create superuser account
python manage.py createsuperuser

# Build Tailwind CSS
npx @tailwindcss/cli -i tailwind-input.css -o static/css/tailwind.css

# Collect static files
python manage.py collectstatic

# Start development server
python manage.py runserver
```

### Post-Setup

1. Login at `http://localhost:8000/panel/` with your superuser account
2. Create clients (organizations) from the Admin Panel
3. Create admin staff and assign to clients
4. Clients can create groups and tables for ID card management
5. Upload ID card data via individual entry or bulk XLSX + ZIP

---

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SECRET_KEY` | Django secret key | **Yes** | — |
| `DEBUG` | Debug mode (`True`/`False`) | No | `False` |
| `ALLOWED_HOSTS` | Comma-separated hostnames | **Yes (prod)** | `*` in DEBUG |
| `DATABASE_URL` | Database connection URL | No | SQLite (dev) |
| `WEBSITE_DOMAIN` | Public website domain (e.g., `www.adarshbhopal.in`) | No | — |
| `PANEL_DOMAIN` | Admin panel domain (e.g., `panel.adarshbhopal.in`) | No | — |
| `WEBSITE_URL` | Full website URL with protocol | No | Auto from WEBSITE_DOMAIN |
| `PANEL_URL` | Full panel URL with protocol | No | Auto from PANEL_DOMAIN |
| `EMAIL_HOST` | SMTP server hostname | No | — |
| `EMAIL_PORT` | SMTP port | No | 587 |
| `EMAIL_HOST_USER` | SMTP username | No | — |
| `EMAIL_HOST_PASSWORD` | SMTP password | No | — |
| `DEFAULT_FROM_EMAIL` | Sender email address | No | — |

Generate a secret key with:
```bash
python -c "from django.core.management.utils import get_random_secret_key; print(get_random_secret_key())"
```

---

## Deployment

### Target Environment

- **1 GB RAM VPS** (Ubuntu 22.04+ / Debian 12+)
- 2 GB swap recommended
- Nginx reverse proxy
- Gunicorn WSGI server (systemd managed)

### Step-by-Step

1. **Setup swap** (2 GB) — see `deployment/setup_swap_example.sh`
2. **Install system packages**: `python3.11`, `python3.11-venv`, `nginx`, `certbot`
3. **Clone repository** and setup virtualenv
4. **Install dependencies**: `pip install -r requirements.txt`
5. **Configure `.env`** with production settings
6. **Run migrations**: `python manage.py migrate`
7. **Collect static**: `python manage.py collectstatic`
8. **Configure Nginx** — see `deployment/nginx_example.conf` or `deployment/nginx_subdomain_example.conf`
9. **Configure Gunicorn** service — see `deployment/gunicorn_example.service`
10. **Setup cron** for cleanup — see `deployment/cron_cleanup_example.txt`
11. **SSL certificates**: `certbot --nginx -d yourdomain.com -d panel.yourdomain.com`
12. **Start services**: `sudo systemctl enable --now gunicorn nginx`

### Gunicorn Configuration

```python
# deployment/gunicorn.conf_example.py
workers = 2              # 1 GB RAM = 2 workers max
worker_class = 'sync'    # Sync workers (no async needed)
bind = 'unix:/tmp/gunicorn.sock'
timeout = 120            # Long timeout for exports
max_requests = 500       # Worker recycling
max_requests_jitter = 50
```

See [`deployment/README.md`](deployment/README.md) for comprehensive deployment instructions.

---

## License

Proprietary — All rights reserved. Unauthorized copying, distribution, or modification of this software is strictly prohibited.
