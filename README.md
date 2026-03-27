# Adarsh ID Cards — Management Platform

A production-grade, full-stack Django application for professional ID card design, printing, and management. Built for schools, colleges, and organizations to manage bulk ID card workflows end-to-end — from data upload to final print-ready output.

> **Live:** [adarshbhopal.in](https://adarshbhopal.in) (website) · [panel.adarshbhopal.in](https://panel.adarshbhopal.in) (admin)
> **Version:** v1.18.0

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
12. [Image & Media Processing Pipeline](#image--media-processing-pipeline)
13. [Notification System](#notification-system)
14. [Activity Logging & Audit Trail](#activity-logging--audit-trail)
15. [Export System](#export-system)
16. [Face Cropper Engine](#face-cropper-engine)
17. [URL Structure & Routing](#url-structure--routing)
18. [PWA — Mobile App](#pwa--mobile-app)
19. [Public Website](#public-website)
20. [Email System](#email-system)
21. [Setup & Installation](#setup--installation)
22. [Management Commands](#management-commands)
23. [Environment Variables](#environment-variables)
24. [Deployment](#deployment)
25. [Changelog](#changelog)
26. [License](#license)

---

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Backend** | Django 5.2.10, Python 3.11+ | Core application framework |
| **Database** | SQLite (dev) / PostgreSQL (prod) | Data storage via Django ORM |
| **Frontend** | Tailwind CSS 4, Alpine.js, vanilla JS | Responsive UI with reactive components |
| **Interactivity** | HTMX | Server-rendered partial updates without SPA overhead |
| **PDF Generation** | ReportLab, xhtml2pdf | ID card & table PDF exports |
| **Excel** | openpyxl, xlrd | XLSX import/export |
| **Word** | python-docx | DOCX document generation |
| **Digital Signing** | pyHanko | PDF digital signatures |
| **Image Processing** | Pillow | Resize, crop, watermark, WebP conversion, size compression |
| **Video Processing** | ffmpeg (subprocess) | H.264 compression, scale, re-encode for web delivery |
| **Static Files** | WhiteNoise | Production-ready static serving with cache busting |
| **PWA** | Service Worker, Web App Manifest | Installable mobile app experience |
| **Deployment** | Gunicorn, Nginx, systemd | Production WSGI serving |
| **Environment** | python-dotenv | Secure configuration via `.env` |
| **Face Cropping** | FastAPI + PyInstaller (separate service) | Automatic passport photo cropping |

---

## Architecture Overview

```
+---------------------------------------------------------------------+
|                        NGINX (Reverse Proxy)                        |
|                   SSL termination · Static files                    |
+-------------+-----------------------------------+-------------------+
|  Website    |         Panel Subdomain           |   PWA (/app/)     |
|  Subdomain  |   panel.adarshbhopal.in           |                   |
|  (public)   |                                   |                   |
+------+------+-----------------+-----------------+------+------------+
       |                        |                         |
       v                        v                         v
+--------------+  +--------------------------+  +--------------------+
|  Website     |  |     Admin Panel          |  |   Mobile PWA       |
|  URL Config  |  |     URL Config           |  |   (Alpine.js)      |
|  (public     |  |  +---------------------+  |  |                    |
|   landing,   |  |  |   Django Views      |  |  |  Camera capture,   |
|   portfolio, |  |  |  (ultra-thin)       |  |  |  card list,        |
|   contact)   |  |  |       |             |  |  |  status changes,   |
|              |  |  |       v             |  |  |  website manage    |
|              |  |  |  Service Layer      |  |  |                    |
|              |  |  |  +---------------+  |  |  |                    |
|              |  |  |  | Permission    |  |  |  |                    |
|              |  |  |  | Service       |  |  |  |                    |
|              |  |  |  +---------------+  |  |  |                    |
|              |  |  |  | IDCard        |  |  |  |                    |
|              |  |  |  | Service       |  |  |  |                    |
|              |  |  |  +---------------+  |  |  |                    |
|              |  |  |  | Workflow      |  |  |  |                    |
|              |  |  |  | Service       |  |  |  |                    |
|              |  |  |  +---------------+  |  |  |                    |
|              |  |  |  | Export        |  |  |  |                    |
|              |  |  |  | Service       |  |  |  |                    |
|              |  |  |  +---------------+  |  |  |                    |
|              |  |  |  | Media         |  |  |  |                    |
|              |  |  |  | Pipeline      |  |  |  |                    |
|              |  |  |  +---------------+  |  |  |                    |
|              |  |  |  | Background    |  |  |  |                    |
|              |  |  |  | Worker (2*)   |  |  |  |                    |
|              |  |  |  +-------+-------+  |  |  |                    |
|              |  |  |          |          |  |  |                    |
|              |  |  |          v          |  |  |                    |
|              |  |  |    Django ORM       |  |  |                    |
|              |  |  +---------------------+  |  |                    |
+--------------+  +--------------------------+  +--------------------+
                              |
                              v
                  +----------------------+
                  |   SQLite / PostgreSQL |
                  +----------------------+

                  +----------------------+
                  |   Face Cropper       |
                  |   (FastAPI @ :4765)  |
                  |   Local Windows Svc  |
                  +----------------------+
```

### Design Principles

1. **Ultra-Thin Views** — Views only parse requests, call services, and return responses. No model mutations (`.save()`, `.create()`, `.delete()`) in view files.
2. **Service Layer Authority** — All business logic lives in service classes under `core/services/` and app-level `services.py`. Each service is the single authority for its domain.
3. **Permission-First** — Every API and page view checks permissions via `PermissionService` before any operation. Decorators enforce role requirements.
4. **Memory-Conscious** — Designed for 1 GB RAM VPS. Background worker defaults to 2 threads (configurable 1-4) with heavy-task semaphore throttling. Files processed from disk, never fully loaded into memory.
5. **Audit Everything** — `ActivityService` logs 30+ action types. All sensitive operations recorded with IP, user, and timestamp.
6. **Shared Service Layer (Desktop + Mobile)** — PWA mobile API endpoints route through the same service classes as the desktop panel. No duplicate logic exists between the two interfaces.

`*` default worker count is 2 (`BACKGROUND_WORKER_MAX_WORKERS`), bounded to 1-4.

### Request Flow

```
Browser -> Nginx -> Gunicorn -> SubdomainRoutingMiddleware
                                    |
                    +---------------+---------------+
                    v                               v
             Website URLs                    Panel URLs
                    |                               |
                    v                               v
            PermissionValidation            PermissionValidation
            Middleware                      Middleware
                    |                               |
                    v                               v
              View Function                  View Function
                    |                               |
                    v                               v
             Template Render               Service Layer
                                                |
                                    +-----------+-----------+
                                    v           v           v
                              Permission   Workflow    Activity
                              Service      Service     Service
                                    |           |           |
                                    v           v           v
                                        Django ORM
                                            |
                                            v
                                        Database
```

---

## Project Structure

```
Adarsh Admin New/
|-- accounts/                  # Authentication app
|   |-- models.py              #   (no custom models -- uses core.User)
|   |-- services.py            #   OTP, login, password reset logic
|   |-- rate_limit.py          #   IP-based rate limiting
|   |-- services_profile.py    #   Profile image / settings helpers
|   |-- views.py               #   Login, logout, OTP views
|   +-- urls.py                #   Auth URL patterns
|
|-- cardprint/                 # Card printing workflow app
|   |-- models.py              #   (no custom models -- uses core.IDCard)
|   |-- services.py            #   Print workflow: send to print, finalize, pool
|   |-- views.py               #   3-step print pages + APIs
|   +-- urls.py                #   Print URL patterns
|
|-- client/                    # Client organization management app
|   |-- models.py              #   Client model (org/school profile + perms)
|   |-- services.py            #   Client dashboard, staff ops, image upload
|   |-- services_access.py     #   Access-scoping helpers
|   |-- services_card.py       #   Card-level helpers for client scope
|   |-- services_client_core.py#   Core client CRUD
|   |-- services_dashboard.py  #   Dashboard stat queries
|   |-- services_image.py      #   Image handling for client profile
|   |-- services_staff.py      #   Client staff management
|   |-- views.py               #   Client CRUD pages + APIs
|   |-- views_api.py           #   REST API endpoints
|   |-- views_decorators.py    #   Permission decorators
|   |-- views_pages.py         #   HTML page views
|   |-- views_shared_pages.py  #   Shared page fragments
|   +-- urls.py                #   Client URL patterns
|
|-- config/                    # Django project configuration
|   |-- settings.py            #   All settings (env-driven, production-ready)
|   |-- urls.py                #   Root URL config (local dev -- both site + panel)
|   |-- urls_website.py        #   Website-only URL config (subdomain)
|   |-- urls_panel.py          #   Panel-only URL config (subdomain)
|   |-- wsgi.py                #   WSGI application entry point
|   +-- asgi.py                #   ASGI application entry point
|
|-- core/                      # Central app -- models, permissions, base views
|   |-- models.py              #   Re-exports: User, Notification, ActivityLog, etc.
|   |-- middleware.py          #   9 custom middleware classes
|   |-- context_processors.py  #   Permission injection into all templates
|   |-- services/              #   Business logic layer (15+ service modules)
|   |   |-- permission_service.py    # Single authority for all permission checks
|   |   |-- idcard_service.py        # IDCard CRUD, search, field management
|   |   |-- workflow_service.py      # Status transitions (print + reprint)
|   |   |-- client_service.py        # Client CRUD
|   |   |-- staff_service.py         # Staff CRUD
|   |   |-- notification_service.py  # Notification broadcast + targeting
|   |   |-- activity_service.py      # Audit trail logging
|   |   |-- background_worker.py     # Singleton ThreadPoolExecutor
|   |   |-- bulk_upload_service.py   # XLSX + ZIP import
|   |   |-- bulk_upload_processor.py # Memory-efficient bulk processing
|   |   |-- reupload_processor.py    # Image reupload from ZIP
|   |   |-- export_processor.py      # Background export handlers
|   |   |-- user_profile_service.py  # Profile management
|   |   |-- task_cleanup.py          # Stale task & file cleanup
|   |   +-- base.py                  # ServiceResult dataclass
|   |-- views/                 #   Split view modules
|   |   |-- base.py            #     Dashboard, staff/client mgmt, settings
|   |   |-- auth.py            #     Login/logout/OTP/password reset
|   |   |-- idcard_api.py      #     IDCard CRUD APIs (30+ endpoints)
|   |   |-- notification_api.py#     Notification list/read/create APIs
|   |   |-- engine_api.py      #     Face Cropper proxy APIs
|   |   |-- cropper_api.py     #     Cropper version/webhook APIs
|   |   +-- task_api.py        #     Background task status/cancel APIs
|   |-- utils/                 #   Utility modules
|   |   |-- htmx.py            #     HTMX detection and partial rendering
|   |   |-- threaded_email.py  #     Async email sending (background thread)
|   |   +-- image_helpers.py   #     Image manipulation utilities
|   |-- templatetags/          #   Custom template filters
|   |   +-- custom_filters.py  #     humanize_header, wrap_header, etc.
|   |-- management/            #   Custom management commands
|   +-- migrations/            #   Database migration files
|
|-- exports/                   # Export generation app
|   |-- pdf.py                 #   PDF table export (ReportLab + xhtml2pdf)
|   |-- excel.py               #   XLSX export (openpyxl)
|   |-- word.py                #   DOCX export (python-docx)
|   |-- zip.py                 #   ZIP image bundling
|   |-- column_spec.py         #   Column sizing intelligence (90+ field patterns)
|   |-- services.py            #   Export orchestration (read-only)
|   |-- tasks.py               #   Background export task creation
|   +-- urls.py                #   Export URL patterns
|
|-- idcards/                   # ID card app (models + routing)
|   |-- models.py              #   IDCardGroup, IDCardTable, IDCard models
|   +-- urls.py                #   ID card URL patterns
|
|-- mediafiles/                # Protected media management app
|   |-- models.py              #   CardMedia, ImageProcessingLog
|   |-- services/              #   Image upload, thumbnail, optimization
|   |-- constants.py           #   Max sizes, allowed formats
|   +-- urls.py                #   Media URL patterns
|
|-- mobile_app/                # PWA mobile-specific app
|   |-- views.py               #   All PWA page views + API endpoints (40+)
|   +-- urls.py                #   Mobile URL patterns (35+ routes)
|
|-- reprintcard/               # Card reprinting workflow app
|   |-- models.py              #   (no custom models -- uses core.IDCard)
|   |-- services.py            #   Reprint workflow: request, confirm, download
|   |-- views.py               #   4-step reprint pages + APIs
|   +-- urls.py                #   Reprint URL patterns
|
|-- staff/                     # Admin staff management app
|   |-- models.py              #   Staff model (profile + perms + assignments)
|   +-- urls.py                #   Staff URL patterns
|
|-- website/                   # Public website app
|   |-- models.py              #   10+ content models (hero, portfolio, FAQ, etc.)
|   |-- services.py            #   Website content CRUD service classes
|   |-- watermark.py           #   Image watermarking, WebP conversion, video compression
|   |-- views.py               #   Landing, portfolio, contact, sitemap
|   +-- urls.py                #   Public URL patterns
|
|-- PWA/                       # PWA static assets
|   |-- static/                #   Service worker, manifest, offline assets
|   +-- templates/             #   (mobile templates live in templates/mobile_app/)
|
|-- Face Cropper/              # Standalone face cropping engine
|   |-- main.py                #   FastAPI application
|   |-- passport_engine_core/  #   Image processing module
|   |-- installer/             #   InnoSetup installer scripts
|   +-- DEPLOYMENT.md          #   Engine deployment guide
|
|-- templates/                 # Django HTML templates
|   |-- base.html              #   Base template (shared layout)
|   |-- dashboard/             #   Role-specific dashboards
|   |-- mobile_app/            #   Mobile PWA templates (15 pages + 15 partials)
|   |   |-- base.html          #     PWA base layout
|   |   |-- home.html          #     Role-aware dashboard
|   |   |-- clients_list.html  #     Client list (admin: "Active Clients", admin_staff: "Assigned Clients")
|   |   |-- groups.html        #     Client group browser
|   |   |-- table_picker.html  #     Status-based table selector
|   |   |-- list_page.html     #     Card list with search + bulk actions
|   |   |-- card_detail.html   #     Individual card view
|   |   |-- camera.html        #     Camera photo capture
|   |   |-- notifications.html #     In-app notification center
|   |   |-- profile.html       #     User profile management
|   |   |-- staff_manage.html  #     Staff CRUD (admin roles)
|   |   |-- search.html        #     Cross-table search
|   |   |-- settings.html      #     App settings
|   |   |-- no_access.html     #     Permission denied page
|   |   |-- website_manage.html#     Portfolio + Reels management (admin/staff)
|   |   +-- partials/
|   |       |-- navbar.html
|   |       |-- bottom_nav.html          # Role-aware: client_staff sees Profile not Staff
|   |       |-- hamburger_drawer.html
|   |       |-- list_top_section.html    # Status tabs gated by perm flags
|   |       |-- list_table.html
|   |       |-- list_bottom_bar.html
|   |       |-- list_filter_panel.html
|   |       |-- list_toast.html
|   |       |-- searchbar.html
|   |       |-- hero_carousel.html
|   |       |-- add_form_sheet.html
|   |       |-- actions_pending.html     # Perm-gated action buttons per status
|   |       |-- actions_verified.html
|   |       |-- actions_pool.html
|   |       |-- actions_approved.html
|   |       +-- actions_download.html
|   |-- partials/              #   Reusable template partials (desktop)
|   |-- components/            #   UI components (toast, modal, etc.)
|   +-- ...                    #   Page templates
|
|-- static/                    # Static assets (source)
|   |-- css/                   #   Stylesheets (Tailwind + custom)
|   |-- js/                    #   JavaScript modules
|   |-- assets/                #   Images, fonts, favicon
|   +-- vendor/                #   Third-party libraries
|
|-- deployment/                # Production deployment configs
|   |-- nginx_example.conf           #   Nginx single-domain config
|   |-- nginx_subdomain_example.conf #   Nginx subdomain config
|   |-- gunicorn_example.service     #   Systemd service file
|   |-- gunicorn.conf_example.py     #   Gunicorn worker config
|   |-- setup_swap_example.sh        #   Swap file setup script
|   |-- cron_cleanup_example.txt     #   Cron for periodic cleanup tasks
|   +-- README.md              #   Deployment instructions
|
|-- manage.py                  # Django management CLI
|-- requirements.txt           # Python dependencies
|-- package.json               # Node.js (Tailwind CSS CLI)
|-- tailwind-input.css         # Tailwind CSS input file
|-- VERSION.txt                # Current version (v1.18.0)
+-- db.sqlite3                 # Development database
```

---

## Django Apps

| App | Purpose | Has Models? |
|-----|---------|-------------|
| `core` | Central hub — User model, permissions, middleware, context processors, base views, all services | Yes (User, Notification, ActivityLog, BackgroundTask, SystemSettings, ExportTemplate, CropperRelease) |
| `accounts` | Authentication — login, OTP verification, password reset, rate limiting, session management | No (uses core.User) |
| `client` | Client organization CRUD — company/school profiles, client staff management, group settings | Yes (Client) |
| `staff` | Admin staff management — role assignment, client assignment, permissions | Yes (Staff) |
| `idcards` | Data models for ID card workflow — groups, tables, cards | Yes (IDCardGroup, IDCardTable, IDCard) |
| `cardprint` | Card printing workflow — 3-step: Print List → Finalized → Pool | No (uses idcard models) |
| `reprintcard` | Card reprinting workflow — 4-step: Requested → Confirmed → Downloaded → Pool | No (uses idcard models) |
| `exports` | Multi-format export engine — PDF, XLSX, DOCX, ZIP generation | No (uses idcard models) |
| `mediafiles` | Protected media file management — image upload, thumbnails, optimization | Yes (CardMedia, ImageProcessingLog) |
| `mobile_app` | PWA mobile app — all mobile views and API endpoints | No (proxy to service layer) |
| `panel` | Panel monitoring, backup, and notification management endpoints/views | No (uses core + shared models) |
| `website` | Public-facing website — landing page, portfolio, testimonials, FAQ, contact, SEO | Yes (10+ content models) |

---

## Data Models

### Core Domain Models

```
+-----------------+     +-----------------+     +-----------------+
|      User       |     |     Client      |     |     Staff       |
|  -------------- |     |  -------------- |     |  -------------- |
|  role (enum)    |<----+  user (1:1)     |     |  user (1:1)     |
|  email          |     |  name           |     |  client (FK)    |
|  phone          |     |  address/city   |     |  assigned_      |
|  is_active      |     |  status         |     |    clients      |
|                 |<----+  image_folder   |     |  assigned_      |
|                 |     |  32 perm_*flags |     |    groups       |
+-----------------+     +--------+--------+     |  37 perm_*flags |
                                 |              +-----------------+
                   +-------------+-------------+
                   v                           v
         +-----------------+        +-----------------+
         |   IDCardGroup   |        |    CardMedia    |
         |  -------------- |        |  -------------- |
         |  client (FK)    |        |  card (FK)      |
         |  name           |        |  field_name     |
         |                 |        |  image file     |
         +--------+--------+        |  thumbnail      |
                  |                 +-----------------+
                  v
         +-----------------+
         |   IDCardTable   |
         |  -------------- |
         |  group (FK)     |
         |  name           |
         |  fields (JSON)  |<-- [{name, type, order}]
         |  max 20 fields  |
         +--------+--------+
                  |                 Field Types:
                  v                 ----------------
         +-----------------+        text, email, class,
         |     IDCard      |        section, photo,
         |  -------------- |        mother_photo,
         |  table (FK)     |        father_photo,
         |  field_data(JSON)|       barcode, qr_code,
         |  status (enum)  |        signature
         |  created_by     |
         |  updated_by     |
         +-----------------+

Status Workflow:
  pending -> verified -> pool -> approved -> download
                                                |
                                                v
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
| **PortfolioItem** | Gallery items — every upload processed to WebP, compressed below 500 KB, text-watermarked |
| **TrustedClient** | Logo carousel for social proof |
| **Testimonial** | Customer reviews with star ratings |
| **FAQ** | Frequently asked questions |
| **Reel** | Short video showcases — compressed via ffmpeg to H.264 below 10 MB; thumbnail logo-watermarked |
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

### Bulk Operations (Permission-Gated)
- **Bulk Upload** — XLSX + ZIP import (up to 5,000 rows, batch size 100)
- **Bulk Download** — Export as PDF, XLSX, DOCX, or ZIP with images
- **Bulk Reupload** — Replace all images via ZIP file
- **Bulk Delete** — Super-admin-only destructive delete-all operation (with verification code)
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
- **Real-time stats** — Pending, verified, approved, downloaded card counts (global aggregate for admins; client-scoped for clients)
- **Recent activity feed** — role-filtered, card-based activity showing name, status, and timestamp
- **Notification bar** — in-app notifications with unread badge
- **Global search** — search across ID cards from any page
- **Manage Panel** — system administration with tabs:
  - Notifications management (create/broadcast)
  - Download Templates (export template CRUD)
  - Log History (searchable/filterable activity logs)
  - System Info (version, health, configuration)

### Public Website
- **Landing page** — hero slider, product carousel, features section
- **Portfolio gallery** — categorized gallery; all images stored as WebP, compressed below 500 KB, watermarked
- **Testimonials** — customer reviews with star ratings
- **FAQ section** — collapsible Q&A
- **Contact form** — AJAX submission with email automation
- **Reels section** — short H.264 video showcases (below 10 MB, thumbnail watermarked)
- **SEO optimized** — robots.txt, sitemap.xml, structured data, meta tags
- **Maintenance mode** — toggle website offline with 503 page

### Progressive Web App (Mobile)
- **Installable** — service worker + web app manifest
- **Camera capture** — take photos directly from mobile
- **Card management** — view, add, edit, status change on mobile
- **Staff management** — create, edit, toggle, delete staff from mobile
- **Group overview** — browse client groups and tables
- **Website content management** — upload portfolio images by category and reels (admin/staff only)
- **Role-based UI** — all 4 roles fully supported with appropriate access controls
- **Perm-gated status tabs** — Pending/Verified/Approved/Download tabs only visible when role has the matching permission
- **Offline support** — cached pages for offline access

---

## User Roles & Permissions

### Role Hierarchy

```
+-------------------------------------------------+
|                 SUPER ADMIN                     |
|  Full access to everything. Always passes all  |
|  permission checks. Manages the entire system. |
+-------------------------------------------------+
|               ADMIN STAFF                       |
|  Scoped to assigned clients only. Has granular |
|  per-feature toggles. Website management.      |
|  Can perform bulk operations and exports.      |
+-------------------------------------------------+
|                  PRO USER                       |
|  Single privileged account with super-admin     |
|  powers used for owner-level operations and     |
|  impersonation workflows.                       |
+-------------------------------------------------+
|                 CLIENT                          |
|  Organization/school owner. Manages their own  |
|  groups, tables, and cards. Can delegate       |
|  permissions to their client staff.            |
|  Bulk actions are toggle-gated per client.     |
+-------------------------------------------------+
|              CLIENT STAFF                       |
|  Delegated access from parent client.          |
|  Double-gated: staff perm AND client perm      |
|  must both be True. Most restricted role.      |
|  Can only do what both staff + parent allow.   |
+-------------------------------------------------+
```

### Permission Resolution

| Role | How Permissions Are Checked |
|------|----------------------------|
| **Super Admin** | Always `True` — bypasses all permission checks |
| **Admin Staff** | `staff_profile.<perm>` must be `True`. If a client is specified, staff must also be assigned to that client. |
| **Client** | `client_profile.<perm>` must be `True`. Client status must be `active`. |
| **Client Staff** | **Double-gated**: `staff_profile.<perm> AND client.<perm>` must both be `True`. Client status must be `active`. |

### Blocked Permissions (Always Denied for Clients)

These permissions are **always denied** for Client and Client Staff roles at the service level, regardless of database flags:

| Permission | Description |
|------------|-------------|
| `perm_delete_all_idcard` | Delete all cards in a table |
| `perm_reupload_idcard_image` | Reupload individual card image |
| `perm_confirmed_list` | Reprint confirmed queue list (admin staff only) |
| `perm_print_list` | Print queue list (admin staff only) |
| `perm_finalized_list` | Print finalized queue list (admin staff only) |
| `perm_website_view / add / edit / delete / publish` | Website content management (staff-side only) |

### Mobile Bottom Navigation (Role-Based)

The PWA bottom navigation bar adapts based on role:

| Nav Item | Super Admin | Admin Staff | Client | Client Staff |
|----------|:-----------:|:-----------:|:------:|:------------:|
| Home | Yes | Yes | Yes | Yes |
| Cards | Yes | Yes | Yes | Yes |
| Camera | Yes | Yes | Yes | Yes |
| Staff | Yes | Yes | Yes | **Profile instead** |
| More | Yes | Yes | Yes | Yes |

`client_staff` users see **Profile** in place of **Staff** — they cannot manage staff.

---

## Permission Matrix

### Legend
- **Yes** = Available (can be toggled on/off per user)
- **No** = Not available for that role in current permission service rules
- **Always** = Always granted (super admin bypass)
- **Inherited** = Double-gated from parent client
- **—** = Not applicable to this role

### ID Card Client & Settings Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| View client list (`perm_idcard_client_list`) | Always | Yes | Yes | Inherited |
| View settings (`perm_idcard_setting_list`) | Always | Yes | Yes | Inherited |
| Add table (`perm_idcard_setting_add`) | Always | Yes | Yes | Inherited |
| Edit table (`perm_idcard_setting_edit`) | Always | Yes | Yes | Inherited |
| Delete table (`perm_idcard_setting_delete`) | Always | Yes | Yes | Inherited |
| Toggle table status (`perm_idcard_setting_status`) | Always | Yes | Yes | Inherited |

### ID Card List (Tab Visibility) Permissions

These permissions gate which **status tabs** are visible and clickable in both the desktop panel and the mobile PWA. Without the permission, the tab renders as plain non-clickable text.

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Pending list (`perm_idcard_pending_list`) | Always | Yes | Yes | Inherited |
| Verified list (`perm_idcard_verified_list`) | Always | Yes | Yes | Inherited |
| Pool list (`perm_idcard_pool_list`) | Always | Yes | Yes | Inherited |
| Approved list (`perm_idcard_approved_list`) | Always | Yes | Yes | Inherited |
| Download list (`perm_idcard_download_list`) | Always | Yes | Yes | Inherited |
| Reprint list (`perm_idcard_reprint_list`) | Always | Yes | Yes | Inherited |

> Clients with `perm_idcard_approved_list` or `perm_idcard_download_list` see those tabs but get **view-only** mode — action buttons are hidden.

### ID Card Action Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Add card (`perm_idcard_add`) | Always | Yes | Yes | Inherited |
| Edit card (`perm_idcard_edit`) | Always | Yes | Yes | Inherited |
| Delete card (`perm_idcard_delete`) | Always | Yes | Yes | Inherited |
| View card info (`perm_idcard_info`) | Always | Yes | Yes | Inherited |
| Approve card (`perm_idcard_approve`) | Always | Yes | Yes | Inherited |
| Verify card (`perm_idcard_verify`) | Always | Yes | Yes | Inherited |
| Show created date (`perm_idcard_created_at`) | Always | Yes | Yes | Inherited |
| Show updated date (`perm_idcard_updated_at`) | Always | Yes | Yes | Inherited |
| Delete from pool (`perm_idcard_delete_from_pool`) | Always | Yes | Yes | Inherited |
| Retrieve from pool (`perm_idcard_retrieve`) | Always | Yes | Yes | Inherited |
| Upgrade all classes (`perm_idcard_upgrade_all`) | Always | Yes | Yes | Inherited |

### Bulk & Reupload Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Bulk upload (`perm_idcard_bulk_upload`) | Always | Yes | Yes | Inherited |
| Bulk download (`perm_idcard_bulk_download`) | Always | Yes | Yes | Inherited |
| Bulk reupload (`perm_idcard_bulk_reupload`) | Always | Yes | Yes | Inherited |
| Delete all cards (`perm_delete_all_idcard`) | Always | No | No | No |
| Reupload image (`perm_reupload_idcard_image`) | Always | Always | No | No |

### Print Queue Permissions (Staff Side)

These are available only for staff-side workflows:

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| Confirmed list (`perm_confirmed_list`) | Always | Yes | No | No |
| Print list (`perm_print_list`) | Always | Yes | No | No |
| Finalized list (`perm_finalized_list`) | Always | Yes | No | No |

### Website & Mobile Permissions

| Permission | Super Admin | Admin Staff | Client | Client Staff |
|------------|:-----------:|:-----------:|:------:|:------------:|
| View website content (`perm_website_view`) | Always | Yes | — | — |
| Add website content (`perm_website_add`) | Always | Yes | — | — |
| Edit website content (`perm_website_edit`) | Always | Yes | — | — |
| Delete website content (`perm_website_delete`) | Always | Yes | — | — |
| Publish website (`perm_website_publish`) | Always | Yes | — | — |
| Mobile app access (`perm_mobile_app`) | Always | Yes | Yes | Inherited |

Website permissions only exist on the Staff model. Client/Client Staff roles cannot manage website content.

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
| 8 | `MessageMiddleware` | Django | Flash messages |
| 9 | `RequestTimingMiddleware` | core | Logs request duration via `Server-Timing` header. Warns on >1.5s requests, >50 queries, >0.1s individual queries. |
| 10 | `PanelEntryGateMiddleware` | core | Optional panel-entry gate for anonymous users via short-lived signed token flow. |
| 11 | `PermissionValidationMiddleware` | core | Re-fetches user from DB on interval (60s default) to detect deactivation/reassignment. Annotates `request.user_scope`. |
| 12 | `SessionIdleTimeoutMiddleware` | core | Auto-logout on idle timeout (default 7 days) plus absolute max age (default 30 days). |
| 13 | `SecurityHeadersMiddleware` | core | Adds CSP, `Permissions-Policy`, panel cache hardening, and `X-Robots-Tag: noindex` on panel domain. |
| 14 | `MaintenanceModeMiddleware` | core | Blocks panel routes for non-super-admin users when system maintenance mode is enabled. |
| 15 | `WebsiteOfflineMiddleware` | core | Returns 503 offline page when `WebsiteStatus` is `draft`; bypasses panel/admin/static/media/API routes. |
| 16 | `XFrameOptionsMiddleware` | Django | Clickjacking protection (`X-Frame-Options: DENY`) |

---

## Services Architecture

All business logic resides in the service layer. Views are ultra-thin — they parse the request, call a service, and return the response. No model mutations ever occur in view files.

### Service Modules

| Service | File | Responsibility |
|---------|------|----------------|
| **PermissionService** | `core/services/permission_service.py` | Single authority for all permission checks. Role identification, `has()` method, client scoping, context generation, decorators. |
| **IDCardService** | `core/services/idcard_service.py` | Single authority for IDCard/IDCardTable mutations. CRUD, search, field upgrades, default-group provisioning. |
| **WorkflowService** | `core/services/workflow_service.py` | Single authority for card status transitions. Enforces transition matrix, validates mandatory fields, checks image presence. |
| **ReprintWorkflowService** | `core/services/workflow_service.py` | Status transitions for reprint cards — parallel workflow service. |
| **ClientService** | `core/services/client_service.py` | Client CRUD, serialization, image folder management. |
| **StaffService** | `core/services/staff_service.py` | Staff CRUD for both admin_staff and client_staff, permission management. |
| **NotificationService** | `core/services/notification_service.py` | Create/broadcast/target notifications, read tracking, optional email alerts. |
| **ActivityService** | `core/services/activity_service.py` | Non-blocking audit logging. 30+ action types. Role-filtered queries. |
| **BackgroundWorker** | `core/services/background_worker.py` | Singleton `ThreadPoolExecutor` (default `max_workers=2`, env-bounded 1-4) with heavy-task semaphore throttling. |
| **UserProfileService** | `core/services/user_profile_service.py` | Profile updates, password changes, validation. |
| **ExportService** | `exports/services.py` | Export orchestration — delegates to PDF, Excel, Word, ZIP modules. |
| **ImageService** | `mediafiles/services/` | Image upload, thumbnail generation, optimization. |
| **PortfolioItemService** | `website/services.py` | Portfolio item CRUD — applies full media pipeline on every save (watermark → WebP → compress below 500 KB). |
| **ReelService** | `website/services.py` | Reel CRUD — applies video compression (ffmpeg H.264 below 10 MB) + thumbnail logo watermark on every save. |

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

Designed for **1 GB RAM VPS** — uses a bounded thread pool (default 2 workers, configurable 1-4) with heavy-task throttling.

### Architecture

```
User Request --> Create BackgroundTask (DB) --> BackgroundWorker Queue
                                                      |
                                         Worker Pool (default 2)
                                                      |
                                  +-----------------+-+---------------+
                                  v                 v                 v
                            Bulk Upload       Export (PDF/       Reupload
                            Processor         XLSX/DOCX/ZIP)    Processor
                                  |                 |                 |
                                  v                 v                 v
                            Disk-Based Processing (never in-memory)
                                  |                 |                 |
                                  v                 v                 v
                            Update Progress --> Mark Complete --> Cleanup
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
| **Heavy-task throttle** | Bounded semaphore (`BACKGROUND_HEAVY_TASK_CONCURRENCY`) limits RAM-heavy jobs |
| **Failsafe timeout** | 30 minutes — tasks exceeding this auto-fail |
| **Stale cleanup** | Tasks pending/processing >24h marked as failed |
| **Result cleanup** | Completed tasks >7 days purged with files |
| **Orphaned temp files** | Cleaned after every task completion |

### Status Flow

```
pending -> processing -> completed
                      -> failed
                      -> cancelled
```

---

## Image & Media Processing Pipeline

All portfolio images and reels pass through a unified media processing pipeline defined in `website/watermark.py`. The **same pipeline is shared by the desktop admin panel and the mobile PWA** — mobile uploads route through `PortfolioItemService` and `ReelService`, not directly to the database.

### Portfolio Image Pipeline

Every portfolio image — uploaded via the desktop panel or the mobile PWA — goes through this exact sequence:

```
Raw Upload (any size, any format)
        |
        v
apply_text_watermark()
  · Tile "ADARSH ID CARDS" text across image
  · Semi-transparent, diagonal, rotated
        |
        v
Convert to WebP
  · Smaller than JPEG/PNG at equivalent quality
  · Supports transparency
        |
        v
Progressive Quality Reduction  (target <= 500 KB)
  · Quality: 85 -> 80 -> 75 -> ... -> 15  (step -5)
  · Stops as soon as file size <= 500 KB
        |
        v
Fallback Resize  (if still > 500 KB)
  · Scale image to 70% of original dimensions
  · Retry at quality 60 -> 40 -> 20
        |
        v
Saved as .webp  (guaranteed <= 500 KB)
```

**Function:** `process_portfolio_image(file_obj, max_kb=500) -> ContentFile`
**Called by:** `PortfolioItemService.create()`, `PortfolioItemService.update()`

### Reel Video Pipeline

Every reel video — uploaded via the desktop panel or the mobile PWA — goes through this sequence:

```
Raw Video Upload (any size, any codec)
        |
        v
Size Check
  · If already <= 10 MB --> skip compression
        |
        v
ffmpeg Availability Check
  · If ffmpeg not installed --> skip, log warning
        |
        v
ffprobe Duration Probe
  · Needed to calculate target bitrate
        |
        v
Target Bitrate Calculation
  · target_kbps = (10 MB x 8 / duration) / 1000 - 64  (64 reserved for audio)
  · Minimum 200 kbps video bitrate enforced
        |
        v
ffmpeg Re-encode
  · Codec: H.264 (libx264), AAC 64k audio
  · Max resolution: 1280x720 (scale down if larger, preserve smaller)
  · Preset: fast  (good encode speed, reasonable quality)
  · movflags faststart  (metadata at start for streaming)
        |
        v
Output Size Verification
  · If compressed < original --> use compressed
  · Otherwise --> keep original
        |
        v
Saved as .mp4  (target <= 10 MB)
```

**Function:** `compress_video_file(file_obj, max_bytes=10*1024*1024) -> ContentFile`
**Called by:** `ReelService.create()`, `ReelService.update()`

### Reel Thumbnail Pipeline

```
Thumbnail Image --> apply_logo_watermark() --> Saved
```

The Adarsh logo is composited onto the thumbnail at a fixed corner position.

### Watermark Module Reference (`website/watermark.py`)

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `apply_text_watermark(file_obj)` | Any image | ContentFile | Tiled semi-transparent text watermark |
| `apply_logo_watermark(file_obj)` | Any image | ContentFile | Logo composite onto thumbnail |
| `process_portfolio_image(file_obj, max_kb=500)` | Any image | ContentFile (.webp) | Full pipeline: watermark → WebP → compress |
| `compress_video_file(file_obj, max_bytes=10MB)` | Any video | ContentFile (.mp4) | ffmpeg H.264 re-encode to size target |

### Desktop vs Mobile — Identical Pipeline

```
Desktop upload  --> PortfolioItemService.create() --> pipeline --> saved
Mobile upload   --> api_portfolio_upload()
                      --> PortfolioItemService.create() --> pipeline --> saved

Same service. Same result. No duplicate code.
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

---

## Export System

### Export Formats

| Module | Format | Content | Key Features |
|--------|--------|---------|-------------|
| `pdf.py` | PDF | Text + images | Landscape A4, dynamic column widths (via `column_spec.py`), thumbnails, repeating header/footer, UPPERCASE text, 1cm margins |
| `excel.py` | XLSX | Text only | Auto-sized columns, frozen header row, consistent formatting |
| `word.py` | DOCX | Text + images | Landscape A4, institution header, branded footer, 7 entries/page, image borders |
| `zip.py` | ZIP | Images only | Separate ZIP per image field, Base64 for JS downloads, sanitized filenames |

### Column Intelligence

`column_spec.py` is the **single source of truth** for column sizing across all formats. It recognizes **90+ field-name variations** common in Indian ID card, school, and HR systems — automatically determining min/preferred/max character widths, wrap behavior, text alignment, PDF percentage, Word centimeters, and HTML Tailwind classes.

### Export Safety

| Control | Detail |
|---------|--------|
| **Permission** | `perm_idcard_bulk_download` required |
| **Format guard** | Client/client_staff users are restricted to PDF exports (non-PDF formats are staff/admin-side) |
| **Status guard** | Client/client_staff users are blocked from approved/download exports for non-PDF flows and blocked from download-all |
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
- **Django proxy APIs** — browser talks to Django, Django proxies to engine (avoids CORS):
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
| `/work/` | idcards | ID card workflow management |
| `/app/` | mobile_app | Progressive web app (mobile) |
| `/notifications/` | core | Notifications page (all users) |
| `/manage-panel/` | core | System administration (super admin) |
| `/settings/` | core | User settings & profile |
| `/admin/` | Django | Built-in Django admin |

### Key API Endpoints (80+)

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

---

## PWA — Mobile App

Progressive Web App for mobile access at `/app/`, enforcing `perm_mobile_app` permission.

### Pages

| Page | Template | Description |
|------|----------|-------------|
| **Home** | `home.html` | Role-aware dashboard — card stats + recent activity + client groups |
| **Client List** | `clients_list.html` | Client browser (admin: "Active Clients"; admin_staff: "Assigned Clients") |
| **Client Groups** | `groups.html` | Browse groups and tables within a client |
| **Table Picker** | `table_picker.html` | Select a table by status |
| **Card List** | `list_page.html` | Cards in a table — search, filter, bulk actions, column toggle |
| **Card Detail** | `card_detail.html` | Individual card view with all field data |
| **Camera** | `camera.html` | Live camera capture for direct photo upload |
| **Notifications** | `notifications.html` | Full notification list with mark-read |
| **Profile** | `profile.html` | User profile management |
| **Staff Manage** | `staff_manage.html` | Staff CRUD (super_admin, admin_staff, client roles) |
| **Groups Overview** | `groups.html` | Top-level group navigation for client/client_staff |
| **Search** | `search.html` | Cross-table full-text search |
| **Settings** | `settings.html` | App settings and preferences |
| **Website Manage** | `website_manage.html` | Portfolio + Reels management (admin/staff only) |
| **No Access** | `no_access.html` | Permission denied block page |

### Home Dashboard — Role-Aware Behavior

| Section | Super Admin / Admin Staff | Client / Client Staff |
|---------|---------------------------|-----------------------|
| **Stats cards** | Global aggregate counts across all clients | Scoped to own client only |
| **Recent activity** | Latest 10 cards across all clients | Latest 10 cards for own client |
| **Block 2 header** | "Recent Client Updates" + link to clients list | "My Groups" + link to groups overview |
| **Block 2 arrow link** | Links to that client's group detail | Links to groups overview |
| **Expandable sub-rows** | Shows table names per client | Hidden (no tables list) |

### Card List — Status Tabs

The status tab bar renders conditionally based on permissions:

| Tab | Condition to show as link |
|-----|--------------------------|
| Pending | `perm_idcard_pending_list` is True |
| Verified | `perm_idcard_verified_list` is True |
| Pool | `perm_idcard_pool_list` is True |
| Approved | `perm_idcard_approved_list` is True |
| Download | `perm_idcard_download_list` is True |

Without the permission, the tab renders as plain text. Clients on Approved/Download tabs see cards in view-only mode — the action bar is hidden.

### Action Sheets (Per Status)

| Partial | Status | Available Actions |
|---------|--------|------------------|
| `actions_pending.html` | pending | Verify (if perm), Delete (if perm), Camera (if perm) |
| `actions_verified.html` | verified | Approve (if perm), Delete (if perm), Camera (if perm) |
| `actions_pool.html` | pool | Retrieve (if perm), Delete from pool (if perm) |
| `actions_approved.html` | approved | Admin: full actions; Client: view-only |
| `actions_download.html` | download | Admin: full actions; Client: view-only |

### Website Management Page (Mobile)

Available to **super_admin** and **admin_staff** with `perm_website_add`.

**Portfolio Tab:**
- Category grid — tap any category to expand its upload sheet
- Upload multiple images from camera or gallery (bulk select supported)
- Preview strip shows pending images before submission
- POST to `/app/api/website/portfolio/upload/` — routes through `PortfolioItemService`
- Full pipeline applied: text watermark → WebP → compressed below 500 KB

**Reels Tab:**
- Scrollable grid of existing reels
- FAB opens the add-reel sheet
- Enter title, record or pick video from gallery, optionally set thumbnail image
- POST to `/app/api/website/reel/upload/` — routes through `ReelService`
- Video compressed via ffmpeg to H.264 below 10 MB; thumbnail logo-watermarked

### Mobile API Endpoints (all under `/app/api/`)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| `POST` | `card/<id>/status/` | Change single card status |
| `GET` | `card/<id>/detail/` | Fetch card field data |
| `DELETE` | `card/<id>/delete/` | Delete a card |
| `GET` | `table/<id>/cards/` | Load cards for a table |
| `POST` | `table/<id>/bulk-status/` | Bulk status change |
| `POST` | `table/<id>/upload-photo/` | Upload photo for a card |
| `POST` | `table/<id>/card/add/` | Create a new card |
| `PUT` | `table/<id>/card/<card_id>/update/` | Update card fields |
| `POST` | `table/<id>/update-fields/` | Reorder / rename table columns |
| `GET` | `staff/` | List staff (scoped) |
| `POST` | `staff/create/` | Create staff member |
| `PUT` | `staff/<id>/update/` | Update staff member |
| `POST` | `staff/<id>/toggle/` | Toggle staff active/inactive |
| `DELETE` | `staff/<id>/delete/` | Delete staff member |
| `POST` | `profile/update/` | Update user profile |
| `GET` | `search/` | Full-text cross-table search |
| `POST` | `client/<id>/toggle/` | Toggle client active/inactive |
| `DELETE` | `client/<id>/delete/` | Delete client |
| `POST` | `website/portfolio/upload/` | Upload portfolio images (batch, per category) |
| `POST` | `website/reel/upload/` | Upload a reel video + thumbnail |

### Access Control

| Check | Detail |
|-------|--------|
| `perm_mobile_app` | Enforced on every page and API endpoint |
| Desktop block | Non-mobile user-agent sees a redirect block page |
| Login redirect | Preserves `?next=/panel/app/` after login |
| Role guards | Staff Manage, Website Manage, Clients List require appropriate role/perm |
| Action button gates | Every action button checks its specific permission before rendering |

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
| Reels | `Reel` | Short video showcases (H.264, below 10 MB) |
| Contact | `ContactSubmission` | AJAX form with admin notification and auto-reply |
| Business Info | `BusinessDetails` | Site name, tagline, contact details, social media, SEO meta |

### Media Storage Guarantees

| Asset | Format | Max Size | Processing Applied |
|-------|--------|----------|--------------------|
| Portfolio images | WebP | 500 KB | Text watermark → WebP conversion → progressive quality compression |
| Reel videos | MP4 (H.264) | 10 MB | ffmpeg re-encode, max 1280×720, AAC 64k audio, faststart |
| Reel thumbnails | JPEG/PNG | — | Logo watermark composite |
| Hero images | Original | — | None (admin-managed directly) |

### SEO Features

- `robots.txt` — crawl instructions
- `sitemap.xml` — XML sitemap
- Structured data (JSON-LD)
- Meta tags (title, description, keywords)
- Open Graph / Twitter Card tags
- `X-Robots-Tag: noindex` injected on panel subdomain

### Maintenance Mode

`WebsiteStatus` singleton — toggle between **Live** and **Draft**. Draft returns a 503 maintenance page. Admin panel, static files, media, and API routes bypass this check.

---

## Email System

All emails sent asynchronously via background threads.

### Email Types

| Email | Trigger | Format |
|-------|---------|--------|
| **OTP Verification** | Password reset request | Branded HTML — gradient header, large OTP code box, security notice |
| **Welcome Email** | Account creation | Branded HTML — welcome message with login link |
| **Password Changed** | Password change | Branded HTML — security alert notification |
| **Contact Auto-Reply** | Contact form submission | HTML with exponential retry backoff |

### Infrastructure

- `send_html_email_async()` — dispatches HTML email via `threading.Thread`
- `send_mail_async()` — dispatches plain text email via background thread
- Non-blocking — email failures never break the main request
- Retry with exponential backoff for contact form emails (1 min → 10 min → 1 hr → 24 hr)

---

## Setup & Installation

### Prerequisites

- Python 3.11+
- Node.js 18+ (for Tailwind CSS CLI)
- SQLite (development) or PostgreSQL (production)
- ffmpeg (optional — enables video compression for reels; graceful fallback if missing)

### Quick Start

```bash
# Clone the repository
git clone <repository-url>
cd "Adarsh Admin New"

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

### Optional: ffmpeg for Video Compression

```bash
# Ubuntu / Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg

# Windows — download from https://ffmpeg.org/download.html and add to PATH
```

Without ffmpeg, video uploads work but are stored at original size (no compression applied). A warning is written to the log.

---

## Management Commands

Custom commands live under `core/management/commands/`.

| Command | Purpose | Example |
|---------|---------|---------|
| `create_pro_user` | Creates the single allowed `pro_user` account | `python manage.py create_pro_user --email owner@example.com --password StrongPass123` |
| `sanitize_field_data` | Cleans non-Latin-1 characters from all `IDCard.field_data` text values (dry-run by default) | `python manage.py sanitize_field_data --apply` |
| `fix_dob_format` | Converts digit-only DOB values (`DDMMYYYY` / `DDMMYY`) to slash format | `python manage.py fix_dob_format --apply --client-id 7` |
| `convert_thumbs_to_webp` | Migrates old `.jpg/.jpeg` thumbnails in thumbs folders to `.webp` | `python manage.py convert_thumbs_to_webp --apply --quality 85` |
| `revert_kg_dash_for_client` | Reverts `KG1/KG2` class values to `KG-I/KG-II` for one client | `python manage.py revert_kg_dash_for_client --client-id 123 --apply` |

---

## Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `SECRET_KEY` | Django secret key | **Yes** | — |
| `DEBUG` | Debug mode (`True`/`False`) | No | `False` |
| `ALLOWED_HOSTS` | Comma-separated hostnames | **Yes (prod)** | `*` in DEBUG |
| `DATABASE_URL` | Database connection URL | No | SQLite (dev) |
| `WEBSITE_DOMAIN` | Public website domain | No | — |
| `PANEL_DOMAIN` | Admin panel domain | No | — |
| `WEBSITE_URL` | Full website URL with protocol | No | Auto from WEBSITE_DOMAIN |
| `PANEL_URL` | Full panel URL with protocol | No | Auto from PANEL_DOMAIN |
| `CSRF_TRUSTED_ORIGINS` | Comma-separated trusted origins for CSRF | No | Auto-extends from panel/website domains |
| `SESSION_COOKIE_DOMAIN` | Shared cookie domain for subdomains | No | unset |
| `CSRF_COOKIE_DOMAIN` | CSRF cookie domain (should match session domain for subdomains) | No | inherits `SESSION_COOKIE_DOMAIN` |
| `SESSION_IDLE_TIMEOUT` | Idle session timeout in seconds | No | `604800` (7 days) |
| `SESSION_ABSOLUTE_MAX_AGE` | Absolute session lifetime in seconds | No | `2592000` (30 days) |
| `SESSION_FINGERPRINT_ENABLED` | Browser fingerprint binding for sessions | No | `true` in prod, `false` in debug |
| `SESSION_FINGERPRINT_INCLUDE_IP` | Include coarse IP in session fingerprint | No | `false` |
| `MEDIA_USE_XACCEL` | Use Nginx `X-Accel-Redirect` for protected media | No | `false` |
| `BACKGROUND_WORKER_MAX_WORKERS` | Background worker pool size (bounded) | No | `2` (range 1-4) |
| `BACKGROUND_HEAVY_TASK_CONCURRENCY` | Heavy task concurrency cap | No | `1` |
| `REDIS_URL` | Redis cache URL for shared locks/rate limiting | **Yes (prod)** | LocMemCache fallback (dev only) |
| `REDIS_DB` | Redis database number | No | `1` |
| `EMAIL_HOST` | SMTP server hostname | No | — |
| `EMAIL_PORT` | SMTP port | No | 587 |
| `EMAIL_USE_TLS` | Use TLS for SMTP | No | `True` |
| `EMAIL_HOST_USER` | SMTP username | No | — |
| `EMAIL_HOST_PASSWORD` | SMTP password | No | — |
| `DEFAULT_FROM_EMAIL` | Sender email address | No | — |
| `CONTACT_FORM_RECIPIENT` | Recipient for website contact submissions | No | — |
| `SITE_URL` | Base URL used in email links | No | `http://localhost:8000` |
| `APP_VERSION` | Optional app version override when `VERSION.txt` is unavailable | No | auto (VERSION.txt/git/fallback) |
| `TIME_ZONE` | Django timezone | No | `Asia/Kolkata` |
| `SLOW_REQUEST_THRESHOLD` | Slow request warning threshold (seconds) | No | `1.5` |
| `QUERY_COUNT_THRESHOLD` | Excessive query warning threshold per request | No | `50` |
| `SLOW_QUERY_THRESHOLD` | Slow SQL warning threshold (seconds) | No | `0.1` |
| `LOG_TO_FILE` | Enable rotating file handlers under `logs/` | No | `false` |
| `SECURE_SSL_REDIRECT` | Force HTTPS redirect in production | No | `True` |

Generate a secret key:
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
2. **Install system packages**: `python3.11`, `python3.11-venv`, `nginx`, `certbot`, `ffmpeg`
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

### CI/CD Workflows

- `ci.yml` — self-hosted CI: checks, migrations, bundle build, collectstatic test, and full test run.
- `cd.yml` — manual production deploy with rollback checks (`DEPLOY` confirmation required).
- `quick-deploy.yml` — manual hotfix deploy path (skips full CI test cycle).
- `build-cropper.yml` — tagged Windows build/release pipeline for the standalone Face Cropper engine.

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

## Changelog

### v1.18.0 (Current)

- Version source of truth is `VERSION.txt` (`v1.18.0`).
- Middleware stack now includes `PanelEntryGateMiddleware` and `MaintenanceModeMiddleware` in the active chain.
- Background worker uses bounded thread-pool concurrency with heavy-task throttling.
- Permission model reflects current rules: client/client_staff are blocked from delete-all and single-image reupload, while bulk permissions remain toggle-driven.
- Protected media serving now enforces normalized paths, ownership checks, and optional `X-Accel-Redirect` handoff.

### Recent Main-Branch Updates (Unreleased)

**Image & Video Processing Pipeline**
- Portfolio images now go through a unified pipeline on every upload (desktop + mobile): text watermark → convert to WebP → progressive quality compression to target below 500 KB with fallback resize
- Reel videos compressed via ffmpeg subprocess to H.264/AAC below 10 MB, max 1280×720, with `movflags faststart` for streaming; graceful fallback if ffmpeg is not installed
- Reel thumbnails now receive logo watermark on every create and update

**Mobile PWA — Service Layer Parity**
- `api_portfolio_upload` now delegates to `PortfolioItemService.create()` instead of creating `PortfolioItem` directly — mobile uploads are now identical to desktop uploads
- `api_reel_upload` now delegates to `ReelService.create()` instead of creating `Reel` directly — same compression and watermark pipeline applied on mobile

**Mobile PWA — Permission Audit (6 fixes)**
- Admin home stats now show global aggregate counts across all clients (previously showed first-client only)
- Recent activity feed rebuilt to use card-based format (name, status, status_display, updated_at) matching the template's expected data shape
- Home Block 2 now visible to all 4 roles: admins see "Recent Client Updates" with client list link; clients/client_staff see "My Groups" with groups overview link
- Pending and Verified status tabs in card list now gated by `perm_idcard_pending_list` / `perm_idcard_verified_list` — tabs without permission render as plain text
- `client_staff` users now see **Profile** link in the bottom navigation instead of **Staff** (they cannot manage staff)
- Clients list page header now shows "Assigned Clients" for admin_staff and "Active Clients" for super_admin

**Mobile PWA — Website Manage Page**
- New `website_manage.html` page for managing portfolio and reels from mobile
- Portfolio tab: category grid with per-category upload sheet, camera/gallery input, multi-image preview strip, bulk upload
- Reels tab: scrollable reel grid, FAB to add new reel, title + video + optional thumbnail, full pipeline applied on upload
- Accessible to super_admin and admin_staff only (`perm_website_add` required)

### v2.17.x and earlier

See git log for previous changes.

---

## License

Proprietary — All rights reserved. Unauthorized copying, distribution, or modification of this software is strictly prohibited.
