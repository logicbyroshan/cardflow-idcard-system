# Adarsh ID Panel: Desktop Integration & Printing APIs

This document details the backend APIs, authentication methods, synchronization routes, and security controls designed for desktop print client integrations.

---

## 1. Authentication & API Keys

Desktop print clients (installed on local printing machines) bypass user login flows using decentralized API keys.

### Desktop API Keys
- Managed in `apps/desktop_sync`.
- An organization can define multiple keys (e.g. `Office PC Key`, `Print Room Key 1`, `Backup Print Key`).
- **Storage**: Keys are stored as SHA-256 hashes (`key_hash`) inside the database. The plain key is only visible to the user during creation.
- **Request Headers**:
  Clients authenticate by passing the plain API key in the custom header:
  `X-Desktop-Api-Key: <plain_api_key_value>`

---

## 2. Integration API Directory

All desktop sync APIs are grouped under `/api/v1/desktop/`:

### A. Sync Card Datasets
* **Endpoint**: `GET /api/v1/desktop/sync/`
* **Filters**: Supports filtering by table ID.
* **Response**: Returns a collection of cards marked as `APPROVED` but not yet printed.
  ```json
  [
    {
      "id": "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3",
      "data": {
        "student_name": "John Doe",
        "roll_number": "STUD-2026-001"
      },
      "photo_url": "https://storage.adarshid.com/media/photos/john_doe.jpg"
    }
  ]
  ```

### B. Image Fetching API
* **Endpoint**: `GET /api/v1/desktop/media/<media_id>/`
* **Response**: Directly streams the binary image data for high-performance offline caching.

### C. Confirm Printing Completions
* **Endpoint**: `POST /api/v1/desktop/print-complete/`
* **Request Payload**:
  ```json
  {
    "card_ids": [
      "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3"
    ]
  }
  ```
* **Side Effect**: Instantly shifts the target cards to the `DOWNLOADED` state, recording the print station's log ID.

---

## 3. Security & Rate Limiting Rules

1. **Access Logs**: Every API request is logged in the `DesktopAccessLog` table, tracking IP address, User Agent, key ID, and action performed.
2. **Tenant Isolation**: Keys are bound to an Organization. A key can only query, stream, or update cards belonging to its parent organization.
3. **Throttling**: The endpoint enforces a strict rate limit of `300 requests per minute` (`DesktopRateThrottle`) to prevent client bugs from overloading the server.
