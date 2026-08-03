# Health & Management

## Endpoints
- `/api/v1/health/`: Returns 200 OK. Used by load balancers.
- `/api/v1/health/ready/`: Deep check. Validates PostgreSQL connection and Redis SET/GET capabilities.

## Management Commands
Executed via `python manage.py <command>`:
- `cleanup_exports`: Purges temporary ZIP/PDFs older than 7 days.
- `cleanup_imports`: Cleans staging directories.
- `repair_thumbnails`: Detects missing mediafiles and regenerates.
- `rebuild_search_indexes`: Syncs DB state to search infra.
- `sync_storage`: Migrates local objects to R2/MinIO.\n