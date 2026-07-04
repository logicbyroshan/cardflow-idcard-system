# Folder Structure Reference

Below is the directory architecture for the Adarsh Frontend project. All future modules must follow this structure.

```
Adarsh-Frontend/
│
├── src/
│   ├── app/                    # Global App Configuration
│   │   ├── router/             # React Router tree definitions
│   │   ├── providers/          # Query, State & Toast Providers
│   │   ├── layouts/            # Base dashboard layouts (AppLayout)
│   │   ├── guards/             # Authentication & session guards
│   │   ├── config/             # Environment variables mapping
│   │   └── initialization/     # Application boot tasks
│   │
│   ├── assets/                 # Icons, SVG assets, and static logos
│   │
│   ├── components/             # Reusable Presentation Components
│   │   ├── ui/                 # Wrapped shadcn primitives
│   │   ├── layout/             # Sidebar, Topbar, Content containers
│   │   ├── feedback/           # Loaders, Skeletons, Error boundaries
│   │   ├── navigation/         # Page navigation triggers
│   │   ├── forms/              # Reusable Form hook wrappers
│   │   └── data-display/       # Base tables, Pagination, Toolbar
│   │
│   ├── features/               # Domain-driven features (e.g. Clients, Showcase)
│   │   └── showcase/
│   │       ├── components/     # Feature components
│   │       ├── hooks/          # Custom query hooks
│   │       └── pages/          # Showcase view page
│   │
│   ├── hooks/                  # Global shared react hooks
│   │
│   ├── services/               # Infrastructure integrations
│   │   ├── api/                # Axios instance & interceptors
│   │   ├── auth/               # Session login/logout actions
│   │   ├── storage/            # LocalStorage handlers
│   │   └── notifications/      # Notifications gateway
│   │
│   ├── stores/                 # Zustand global stores (Auth, Theme, Layout)
│   │
│   ├── types/                  # Global TypeScript typings
│   │
│   ├── constants/              # System constants (statuses.ts)
│   │
│   ├── utils/                  # Styling & helper utilities (cn.ts)
│   │
│   ├── styles/                 # Tailwind CSS & Google fonts imports
│   │
│   └── docs/                   # Architecture & Design documentation
```
