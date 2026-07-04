# Architecture Handbook

## Complete System Architecture

```mermaid
graph TD
    Client[Client Browser / Apps] --> Nginx[Nginx Reverse Proxy]
    Nginx --> Gunicorn[Gunicorn / Django WSGI]
    
    subgraph Django Core
        API[API Layer / Controllers]
        Policies[Policy Layer / AuthZ]
        Services[Service Layer / Business Logic]
        Selectors[Selector Layer / Reads]
        Repos[Repository Layer / Writes]
        Events[Event Bus]
    end
    
    Gunicorn --> API
    API --> Policies
    Policies --> Services
    Services --> Selectors
    Services --> Repos
    Services --> Events
    
    Selectors --> Postgres[(PostgreSQL)]
    Repos --> Postgres
    
    Events --> CeleryWorker[Celery Workers]
    CeleryWorker --> RedisBroker[(Redis Broker/Cache)]
    Services --> RedisBroker
    
    CeleryWorker --> Contracts[Storage Contracts]
    Contracts --> Storage[Local / R2 / MinIO]
```

## Layer Explanations
1. **API Layer**: Receives HTTP requests. Validates inputs using DRF serializers/schemas. 
2. **Policy Layer**: Enforces access control before executing business logic. (e.g., `CanEditCardPolicy`).
3. **Service Layer**: The heart of the application. No database queries exist here; it orchestrates Repositories and Selectors.
4. **Repository Layer**: The ONLY layer allowed to mutate database state (`.save()`, `.create()`, `.update()`).
5. **Selector Layer**: The ONLY layer allowed to read from the database (`.filter()`, `.get()`). Returns ORM instances or DTOs.
6. **Infrastructure/Contracts**: Wraps third-party integrations (Storage, AWS, MinIO, Email) into interchangeable interfaces.\n