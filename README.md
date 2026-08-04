# CardFlow ID Cards - Management Platform

A production-grade, end-to-end ID card operations and management platform designed for schools, colleges, institutions, and enterprise organizations.

This platform covers the full ID card operational lifecycle:

- **Client & Staff Onboarding**: Multi-tier organization & user access management.
- **Dynamic ID Card Schema Design**: Configurable card templates, dynamic fields, and school branding.
- **Card Data Entry & Ingestion**: Real-time web portal, React SPA interface, and bulk CSV/Excel ingestion.
- **Image & Media Normalization**: Automated image upload, bulk ZIP matching, face-cropping, and media management.
- **Print & Reprint Workflows**: Status-driven verification, reprint approval queues, and batch tracking.
- **Export Engine**: High-performance PDF grid rendering, Excel, Word (DOCX), and ZIP media packaging.
- **Mobile Application**: Native Android / iOS PWA and React Native mobile client.

Live Domains:
- **Control Panel**: [https://panel.adarshbhopal.in](https://panel.adarshbhopal.in)

Version Source of Truth:
- `VERSION.txt`: `v4.19.01`

---

## Table of Contents

1. [Platform Highlights & Recent Updates](#platform-highlights--recent-updates)
2. [Tech Stack](#tech-stack)
3. [Architecture Overview](#architecture-overview)
4. [Repository & Directory Structure](#repository--directory-structure)
5. [Django Apps & Core Modules](#django-apps--core-modules)
6. [Frontend & Mobile Applications](#frontend--mobile-applications)
7. [Documentation Index](#documentation-index)
8. [Setup & Local Development](#setup--local-development)
9. [Build & Deployment Pipelines](#build--deployment-pipelines)
10. [License](#license)

---

## Platform Highlights & Recent Updates

### 1) Workspace & Asset Cleanup (August 2026)
- **Asset Consolidation**: Cleaned up unreferenced loose root images and Vite template boilerplate.
- **Design Source Archive**: Archived raw vector CorelDraw logo source files under [`docs/assets/design_sources/`](file:///e:/E/CardFlow/docs/assets/design_sources/).
- **Documentation Reorganization**: Moved engineering audit and CAB review documents into [`docs/audit_reports/`](file:///e:/E/CardFlow/docs/audit_reports/).

### 2) Multi-Image Bulk Upload & Semantic Matching Engine
- **Semantic Matching**: Supports multi-field headers (`SIGNATURE`, `FATHER`, `MOTHER`, `QR`, `PHOTO`).
- **ZIP Isolation**: Prevents filename collision across multiple uploaded archives (e.g. `1.jpg` in Photo ZIP vs Signature ZIP).
- **Default Multi-Field Fallback**: Automatically targets all image fields when `target_field` is omitted during bulk reuploads.

### 3) Mobile Biometrics & Icon Standardization
- **Native SVG Icon Infrastructure**: 100% SVG icon rendering eliminating Android startup crashes (`fontFamily` error).
- **Target SDK 35 Compliance**: Updated Android project specs and dependencies for Google Play compliance.
- **Real-Time Camera Biometrics**: Color-coded optical scan indicators for face presence and sunglasses detection.

### 4) Production Performance & Migration Hardening
- **Dynamic Field Redis Caching**: Redis cache TTL layer for card search drop-down filters (`SELECT DISTINCT`).
- **PostgreSQL Compatibility Merges**: Hardened migration dependencies for production schema stability.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Backend** | Django 5.2.12, Python 3.11+ | Core REST APIs, models, and administrative backend |
| **Frontend Web SPA** | React 18, Vite, Vanilla CSS + Tailwind | Modern control panel UI & client portal |
| **Mobile App** | React Native / Expo, Android Shell | Mobile companion app for card data & photo capture |
| **Database** | PostgreSQL (Prod), SQLite (Dev) | Relational card data & client schemas |
| **Cache & Realtime** | Redis, Django Channels | Session storage, rate limiting, WebSockets |
| **Background Tasks** | Celery, Redis Task Queue | Asynchronous bulk processing & media conversion |
| **Image & Face Engine**| OpenCV, Pillow, PyInstaller Service | Image validation, face cropping, media processing |
| **Export Pipelines** | ReportLab, WeasyPrint, openpyxl, python-docx | PDF card grids, XLSX spreadsheets, Word documents |
| **Server & WSGI** | Gunicorn + Nginx + WhiteNoise | Production application delivery |

---

## Architecture Overview

Request Flow Topology:

```text
[ Client Browser / Mobile App ]
             │
             ▼
      [ Nginx Reverse Proxy ]
             │
      ┌──────┴──────────────────────────┐
      ▼                                 ▼
[ Gunicorn (Django WSGI) ]     [ Daphne / Channels (ASGI) ]
      │                                 │
      ├─────────────────────────────────┤
      ▼                                 ▼
[ PostgreSQL DB ]                [ Redis Cache & Task Broker ]
                                        │
                                        ▼
                                [ Celery Worker Task Engine ]
```

---

## Repository & Directory Structure

```text
CardFlow/
├── README.md               # Main repository documentation & guide
├── VERSION.txt             # Primary system version marker (v4.19.01)
├── manage.py               # Django CLI management script
├── requirements.txt        # Backend python dependencies
├── package.json            # Node.js dependencies & scripts
│
├── frontend/               # React 18 + Vite Web Application SPA
│   ├── src/                # Components, views, assets, and styling
│   └── public/             # Static public assets & brand icons
│
├── android_app/            # Mobile application codebase (Expo / React Native)
│
├── docs/                   # System documentation & guidelines
│   ├── audit_reports/      # Production audits, security reviews & CAB backlogs
│   ├── assets/             # Brand resources & raw design sources (.cdr)
│   └── VERSION_LOG.md      # Detailed platform & mobile change log
│
├── core/                   # Core business logic, base models, & middleware
├── accounts/               # User authentication, profiles, & sessions
├── client/                 # Client portal & organization management
├── staff/                  # Staff role management & permissions
├── operators/              # Operator workflows & client assignments
├── assistants/             # Assistant role portals & group permissions
├── idcards/                # Card schemas, data entry, & status engine
├── reprintcard/            # Card reprint verification & processing queues
├── panel/                  # System admin control panel & backup tools
├── stats/                  # System health monitoring & telemetry
├── exports/                # Export engine (PDF, Excel, DOCX, ZIP)
├── mobile_api/             # REST endpoints for mobile application
├── desktop_app/            # Desktop PWA API, tokens & WebSocket listeners
├── web_app/                # Public landing API & key integrations
│
├── static/                 # Collected static assets
├── media/                  # Media uploads & card attachments
└── config/                 # Django settings, URL routing, WSGI, ASGI, & Celery config
```

---

## Django Apps & Core Modules

* **`core`**: Base models, custom DB routers, middleware, and common service helpers.
* **`accounts`**: User authentication, password rules, OTP validation, and device sessions.
* **`client`**: Client directory, dynamic custom fields, school onboarding, and client scope control.
* **`idcards`**: Core card database models, filtering, batch status updates, and lifecycle transitions.
* **`reprintcard`**: Reprint requests, batch submission queues, and print verification tracking.
* **`exports`**: Heavy generator engines for multi-card PDF printing grids, Excel sheets, and Word documents.
* **`panel`**: Super-admin management dashboard, tenant statistics, database backup/restore utilities.
* **`mobile_api`**: Token-based REST API powering the Android and iOS companion apps.

---

## Frontend & Mobile Applications

### 1. React Web SPA (`frontend/`)
Built with React 18, Vite, and custom design system CSS:
- Dynamic dashboard widgets & client selector.
- Card data grid with inline editing, batch status updates, and search filters.
- Panel view for super-administrators and feature toggle controls.

### 2. Mobile App (`android_app/`)
Built with React Native and Expo:
- Role-aware interface for operators and staff in the field.
- Integrated camera mode with real-time biometric face detection overlays.
- Offline data caching & background image queue synchronization.

---

## Documentation Index

Detailed documentation files are available in the [`docs/`](file:///e:/E/CardFlow/docs/) directory:

- [**Version Log**](file:///e:/E/CardFlow/docs/VERSION_LOG.md): Comprehensive release history.
- [**Versioning Guidelines**](file:///e:/E/CardFlow/docs/VERSIONING_GUIDELINES.md): Standard versioning protocols.
- [**Redis Production Guide**](file:///e:/E/CardFlow/docs/enable-redis-for-production.md): Redis deployment and configuration.
- [**Card Generation Guide**](file:///e:/E/CardFlow/docs/generate-card-step2.md): Card mail-merge and export workflow documentation.
- [**Testing Lanes**](file:///e:/E/CardFlow/docs/testing-lanes.md): Test suite organization and execution rules.
- [**Web API Reference**](file:///e:/E/CardFlow/docs/web_api_reference.md): Public web API endpoint documentation.

### Audit & Security Reports ([`docs/audit_reports/`](file:///e:/E/CardFlow/docs/audit_reports/))
- [**Production Audit Report**](file:///e:/E/CardFlow/docs/audit_reports/PROJECT_AUDIT.md): Comprehensive Django production audit.
- [**Engineering Code Review**](file:///e:/E/CardFlow/docs/audit_reports/PROJECT_CODE_REVIEW.md): Deep-dive code review and refactoring guidance.
- [**Verified Findings**](file:///e:/E/CardFlow/docs/audit_reports/PROJECT_VERIFIED_FINDINGS.md): Security and performance findings matrix.
- [**Engineering Change Backlog**](file:///e:/E/CardFlow/docs/audit_reports/PROJECT_CHANGE_BACKLOG.md): Change Advisory Board deployment backlog.

---

## Setup & Local Development

### Backend Setup (Django)

1. **Create & activate virtual environment**:
   ```bash
   python -m venv venv
   # On Windows:
   .\venv\Scripts\activate
   ```

2. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env` and configure local database/secret keys:
   ```bash
   cp .env.example .env
   ```

4. **Run Migrations & Start Server**:
   ```bash
   python manage.py migrate
   python manage.py runserver
   ```

### Frontend Setup (React SPA)

1. **Navigate to frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install Node dependencies**:
   ```bash
   npm install
   ```

3. **Start Development Server**:
   ```bash
   npm run dev
   ```

---

## Build & Deployment Pipelines

### Building Frontend Assets
To compile the production distribution bundle for the web application:
```bash
cd frontend
npm run build
```

### Running Test Suite
Execute Django test cases:
```bash
python manage.py test
```

---

## License

All rights reserved. Property of Adarsh ID Cards / CardFlow Platform.
- Mobile upload timeout hardening for 3-image updates.
- Dashboard caching/runtime optimization improvements.
- Mobile action overlay and image upload regression fixes.

```bash
git log --oneline
```

---

## License

Proprietary. All rights reserved.

Unauthorized copying, distribution, or modification is prohibited.
