# Adarsh ID Panel: API Reference Manual

This document details all backend API endpoints, including routing, methods, authentication scopes, request/response payloads, and common error responses.

---

## 1. Authentication Endpoints

### POST `/api/v1/auth/token/`
* **Purpose**: Authenticates a user and returns JWT credentials.
* **Permission**: AllowAny
* **Request Payload**:
  ```json
  {
    "username": "operator_test",
    "password": "securepassword123"
  }
  ```
* **Response Payload (200 OK)**:
  ```json
  {
    "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
* **Common Error Codes**:
  - `401 Unauthorized`: Invalid credentials.

### POST `/api/v1/auth/token/refresh/`
* **Purpose**: Refreshes expired access tokens.
* **Permission**: AllowAny
* **Request Payload**:
  ```json
  {
    "refresh": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```
* **Response Payload (200 OK)**:
  ```json
  {
    "access": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
  ```

---

## 2. Dynamic Tables & Cards

### GET `/api/v1/tables/`
* **Purpose**: List dynamic tables in the authenticated user's organization.
* **Permission**: IsAuthenticated (Client, Operator, Assistant)
* **Response Payload (200 OK)**:
  ```json
  [
    {
      "id": "4a5c68b7-1c60-4965-9f5b-df8a21199a5e",
      "name": "Students 2026",
      "organization": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "created_at": "2026-06-06T12:00:00Z"
    }
  ]
  ```

### POST `/api/v1/cards/`
* **Purpose**: Creates a single card instance.
* **Permission**: IsAuthenticated (Client, Operator, Assistant)
* **Request Payload**:
  ```json
  {
    "table": "4a5c68b7-1c60-4965-9f5b-df8a21199a5e",
    "data": {
      "student_name": "John Doe",
      "roll_number": "STUD-2026-001",
      "department": "Computer Science"
    }
  }
  ```
* **Response Payload (201 Created)**:
  ```json
  {
    "id": "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3",
    "table": "4a5c68b7-1c60-4965-9f5b-df8a21199a5e",
    "data": {
      "student_name": "John Doe",
      "roll_number": "STUD-2026-001",
      "department": "Computer Science"
    },
    "status": "PENDING",
    "created_at": "2026-06-06T12:15:30Z"
  }
  ```

---

## 3. Sandbox Sandbox Engine

### POST `/api/v1/sandbox/session/start/`
* **Purpose**: Initiates a virtual copy-on-write Sandbox environment.
* **Permission**: IsAuthenticated (Client)
* **Request Payload**:
  ```json
  {
    "device_id": "office-pc-chrome"
  }
  ```
* **Response Payload (201 Created)**:
  ```json
  {
    "id": "893c5d7a-1294-4d8e-be25-1e35d21a221f",
    "token": "sb_token_value_here",
    "is_active": true,
    "expires_at": "2026-06-06T14:43:00Z"
  }
  ```

### GET `/api/v1/sandbox/cards/`
* **Purpose**: Retrieves virtualized card views merged with sandbox changes.
* **Permission**: IsAuthenticated + active Sandbox Token header
* **Headers**: `X-Sandbox-Token: sb_token_value_here`
* **Response Payload (200 OK)**:
  ```json
  [
    {
      "id": "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3",
      "data": {
        "student_name": "John Doe (Sandbox Edit)",
        "roll_number": "STUD-2026-001",
        "department": "Computer Science"
      },
      "status": "VERIFIED"
    }
  ]
  ```

---

## 4. Pro Platform Administration

### POST `/api/v1/pro/impersonate/start/`
* **Purpose**: Silently logs in and acts as a target client or operator.
* **Permission**: IsAuthenticated + PRO_USER role
* **Request Payload**:
  ```json
  {
    "target_user_id": "2d8f9c1e-5819-482a-a9f8-b3d9c72e21b2",
    "reason": "Debugging batch import issue on behalf of tenant."
  }
  ```
* **Response Payload (200 OK)**:
  ```json
  {
    "session_id": "118df2b4-51e2-4c9b-8e9a-7c8588bd9a8d",
    "token": "impersonated_jwt_access_token_here"
  }
  ```

### POST `/api/v1/pro/maintenance/enable/`
* **Purpose**: Puts the entire platform or a specific organization into Maintenance.
* **Permission**: IsAuthenticated + PRO_USER role
* **Request Payload**:
  ```json
  {
    "scope": "GLOBAL",
    "message": "Scheduled database engine upgrades."
  }
  ```
* **Response Payload (200 OK)**:
  ```json
  {
    "id": "493d8e57-a8b2-4d7e-9f33-1ea8c73b22de",
    "scope": "GLOBAL",
    "message": "Scheduled database engine upgrades.",
    "is_active": true
  }
  ```

---

## 5. Desktop Sync Print Station Integration

### GET `/api/v1/desktop/sync/`
* **Purpose**: Sync approved card datasets to print engines.
* **Permission**: API Key Authentication (valid DesktopApiKey header)
* **Headers**: `X-Desktop-Api-Key: office_pc_printing_key_value`
* **Response Payload (200 OK)**:
  ```json
  [
    {
      "id": "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3",
      "student_name": "John Doe",
      "roll_number": "STUD-2026-001",
      "photo_url": "https://storage.adarshid.com/media/photos/john_doe.jpg"
    }
  ]
  ```

### POST `/api/v1/desktop/print-complete/`
* **Purpose**: Confirm print success and transition cards to `DOWNLOADED` state.
* **Permission**: API Key Authentication
* **Request Payload**:
  ```json
  {
    "card_ids": [
      "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3"
    ]
  }
  ```
* **Response Payload (200 OK)**:
  ```json
  {
    "status": "success",
    "updated_count": 1
  }
  ```

---

## 6. System Diagnostics & Operations

### GET `/api/v1/health/`
* **Purpose**: Aggregated backend liveness and readiness probe.
* **Permission**: AllowAny
* **Response Payload (200 OK)**:
  ```json
  {
    "status": "ok",
    "latency_ms": 12.5,
    "services": {
      "database": {
        "status": "ok",
        "latency_ms": 1.2,
        "details": {
          "connection": "ok",
          "read": "ok",
          "write": "ok"
        }
      },
      "redis": {
        "status": "ok",
        "latency_ms": 0.8
      },
      "celery": {
        "status": "ok",
        "details": {
          "worker_alive": "ok",
          "task_execution": "ok"
        }
      },
      "storage": {
        "status": "ok",
        "details": {
          "write": "ok",
          "read": "ok",
          "delete": "ok"
        }
      }
    }
  }
  ```

### GET `/api/v1/operations/dashboard/`
* **Purpose**: Infrastructure management metrics and scheduler state checks.
* **Permission**: IsAuthenticated + PRO_USER role
* **Response Payload (200 OK)**:
  ```json
  {
    "backup_status": {
      "total": 12,
      "completed": 11,
      "failed": 1
    },
    "last_verification": {
      "status": "success",
      "verification_time": "2026-06-06T12:00:00Z",
      "file_name": "backup_platform_38df1.zip"
    },
    "disk_usage": {
      "total_space": 107374182400,
      "free_space": 85899345920,
      "used_space": 21474836480,
      "percent_free": 80.0,
      "growth_rate_bytes_per_sec": 124.5
    },
    "memory_usage": {
      "total_memory": 17179869184,
      "available_memory": 12884901888,
      "used_memory": 4294967296,
      "percent_used": 25.0
    },
    "migration_status": {
      "status": "healthy",
      "errors": []
    }
  }
  ```

---

## 7. Notifications Endpoints

### GET `/api/v1/notifications/unread-count/`
* **Purpose**: Returns the count of unread notifications for the user.
* **Permission**: IsAuthenticated
* **Response Payload (200 OK)**:
  ```json
  {
    "unread_count": 5
  }
  ```

### POST `/api/v1/notifications/mark-all-read/`
* **Purpose**: Marks all active notifications for the current user as Read.
* **Permission**: IsAuthenticated
* **Response Payload (200 OK)**:
  ```json
  {
    "status": "success",
    "marked_count": 5
  }
  ```

---

## 8. Reprint Request Management Endpoints

### GET `/api/v1/reprints/requests/`
* **Purpose**: Lists reprint requests. Clients see their organization's requests; operators/admins see all assigned requests.
* **Permission**: IsAuthenticated
* **Response Payload (200 OK)**:
  ```json
  [
    {
      "id": "7b7a69b7-1c60-4965-9f5b-df8a21199a5e",
      "card_id": "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3",
      "status": "REQUESTED",
      "requested_by": "client_username",
      "draft_data": {
        "student_name": "Corrected John Doe"
      },
      "created_at": "2026-06-08T12:00:00Z"
    }
  ]
  ```

### POST `/api/v1/reprints/requests/`
* **Purpose**: Creates a new reprint request for a DOWNLOADED card.
* **Permission**: IsAuthenticated (Client, Assistant)
* **Request Payload**:
  ```json
  {
    "card_id": "e8e6d2b5-bd8a-4934-be57-9f448b11c6d3",
    "draft_data": {
      "student_name": "Corrected John Doe"
    },
    "draft_media_changes": {}
  }
  ```
* **Response Payload (201 Created)**:
  ```json
  {
    "id": "7b7a69b7-1c60-4965-9f5b-df8a21199a5e",
    "status": "REQUESTED"
  }
  ```

### POST `/api/v1/reprints/requests/{id}/approve/`
* **Purpose**: Approves a reprint request and immediately updates the card's active details and increments counters.
* **Permission**: IsAuthenticated (Operator, Admin, Pro User)
* **Response Payload (200 OK)**:
  ```json
  {
    "id": "7b7a69b7-1c60-4965-9f5b-df8a21199a5e",
    "status": "CONFIRMED"
  }
  ```

### GET `/api/v1/reprints/desktop/`
* **Purpose**: Scopes and retrieves confirmed reprints for desktop printing clients.
* **Permission**: Desktop API Key Authentication (`X-Desktop-Key`)
* **Response Payload (200 OK)**:
  ```json
  {
    "count": 1,
    "results": [
      {
        "id": "7b7a69b7-1c60-4965-9f5b-df8a21199a5e",
        "card_display_id": "CARD-001",
        "draft_data": {
          "student_name": "Corrected John Doe"
        }
      }
    ]
  }
  ```
