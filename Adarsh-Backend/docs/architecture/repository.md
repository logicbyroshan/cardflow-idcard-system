# Repository Handbook

## Complete Folder Structure
```
backend/
├── api/             # API version routing and health checks
├── apps/            # Domain boundaries
├── commands/        # Root level system maintenance commands
├── config/          # Django configuration (settings, urls)
├── contracts/       # Protocol definitions for external services
├── docs/            # You are here
├── infrastructure/  # Concrete implementations of contracts (cache, storage)
├── integrations/    # Third-party service clients (email, whatsapp)
├── scripts/         # Shell scripts for deployment and setup
├── shared/          # Cross-cutting concerns (mixins, utils, exceptions)
├── tests/           # Root test configuration and factories
└── workers/         # Celery app, queues, routes, beat config
```

### Folder Rules
- `apps/`: Must only contain business domains. Do not place cross-cutting tools here.
- `shared/`: Must NOT import from `apps/`. This is for true utilities only.
- `contracts/`: Must only contain Python `Protocols` or Abstract Base Classes. No implementation logic.
- `infrastructure/`: Implements `contracts/`.
- `config/`: Contains ONLY configuration. No business logic.

## Project Conventions
- **Naming**: Use `snake_case` for modules/functions, `PascalCase` for classes.
- **Dependency Rules**: Domain A cannot directly import Domain B's Repository. Domain A must use Domain B's Service or Selector.
- **DTO Patterns**: Return `dataclasses` or typed dicts from Selectors when raw ORM models expose too much data.\n