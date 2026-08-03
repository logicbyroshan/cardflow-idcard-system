# Authentication System Documentation

This document describes the production-ready Authentication module implemented for the **Adarsh ID Card Management Platform**.

## 1. Directory Structure

All authentication-related modules are isolated in a self-contained feature folder under `src/features/auth/`:

```text
src/features/auth/
├── components/          # Reusable UI elements (e.g. OtpInput)
├── pages/               # Flow screen components (LoginPage, OtpPage, etc.)
├── hooks/               # Custom lifecycle hooks (e.g. useAuth)
├── services/            # Axios API client handlers interfacing with Django
├── types/               # Type and interface definitions
├── schemas/             # Form input schemas using Zod validation
├── store/               # Zustand state store with selective persistence
├── utils/               # JWT token decoders and utilities
└── tests/               # Unit, integration, and UI flow tests
```

---

## 2. Supported Flows & Routing Paths

We support the exact layout steps matching the current production interface, using `<AuthLayout>` wrapper structures and nested routing paths:

| Path | Screen Flow | Backend Endpoints Called |
| :--- | :--- | :--- |
| `/auth/login` | **Step 1:** Identity Verification (Email/Username/Phone)<br>**Step 2:** Password entry (visibility toggle & user card header) | None (Local format check)<br>`POST /api/v1/auth/login/` |
| `/auth/otp` | **Step 3:** 6-digit OTP verification (auto focus, copy-paste, countdown timer, resend) | `POST /api/v1/auth/forgot-password/` (for resending OTP tokens) |
| `/auth/forgot-password` | **Flow 4:** Reset password identity request | `POST /api/v1/auth/forgot-password/` |
| `/auth/reset-password` | **Flow 4:** Verification code entry and new password input | `POST /api/v1/auth/reset-password/` |

### Parent Wrapper: `/auth`
The parent route renders the centered visual layout (`AuthLayout`) and mounts nested pages into an `<Outlet />` element.

---

## 3. Form Validation Schemas (Zod + React Hook Form)

All forms utilize centralized schemas configured in `src/features/auth/schemas/index.ts`:

- **Identity Form**: Requires the input to be at least 3 characters and match a valid format (standard email regex, digits-only phone numbers, or alphanumeric usernames).
- **Password Form**: Enforces non-empty values.
- **OTP Form**: Enforces exactly 6 numeric digits.
- **Reset Password Form**: Enforces matching new credentials (`confirm_password === new_password`).

---

## 4. Zustand Store & Persistence

The store (`useAuthStore`) manages the session state using selective persist configuration.
- **Persisted Attributes (in LocalStorage)**: `user` profile, `token` (JWT access), `refreshToken`, and `isAuthenticated` boolean.
- **Transient Attributes**: `identity` string, loading states (`authStatus`, `otpStatus`), and validation errors.

```typescript
// Persist configuration extract
{
  name: 'adarsh-auth-storage',
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    user: state.user,
    token: state.token,
    refreshToken: state.refreshToken,
    isAuthenticated: state.isAuthenticated,
  }),
}
```

---

## 5. JWT Decoders and User Role Inference

Because the Django REST framework SimpleJWT token response only returns `{ access, refresh }` without an explicit user profile, the frontend parses user profiles directly from the JWT token:

1. **Custom Base64 Decoder**: Splices and parses the middle segment (payload claims) of the JWT token string securely.
2. **Fallback Context Identification**: If custom claims (like `role` or `username`) are not found inside the payload (such as standard dev environments), the service infers user roles and usernames based on the login identifier inputted by the user (e.g., matching the sub-string `admin` to the `'admin'` role).

---

## 6. Route Shielding (AuthGuard)

The global route gate (`AuthGuard`) shields all interior business interfaces (`/dashboard`, `/management`, `/settings`, etc.). If an unauthenticated user attempts to visit any page inside the `/` path, they are immediately redirected to `/auth/login`.

---

## 7. Development Mode & Server Ports

In local development, the Django API runs on `http://localhost:8000/api/v1`.
- A frontend configuration file `.env` specifies `VITE_API_URL=http://localhost:8000/api/v1` to link the axios instances directly to the Django server.
- Standard mock bypass accounts remain fully operational in showcase environments for layout evaluation.
