# Realtime & State Handling

## Presence Tracking
Handled purely in Redis to avoid DB churn. 
- Keys: `adarsh:presence:user:{user_id}` with a 60s TTL.
- Updated via heartbeat API.

## Optimistic Locking
- To prevent race conditions when two assistants edit the same Card, the Card model contains a `version` field.
- The `CardRepository` enforces `UPDATE ... WHERE id=X AND version=Y`. If 0 rows updated, a `ConflictException` is thrown.\n