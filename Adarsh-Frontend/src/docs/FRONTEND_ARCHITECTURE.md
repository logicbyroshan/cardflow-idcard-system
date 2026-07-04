# Frontend Architecture

This document defines the architecture of the Adarsh ID Management Platform Frontend.

## 1. Feature-Based Architecture
The project is organized in a scalable, domain-driven structure:
* **app**: Global configuration, providers, and routers.
* **components**: Reusable presentation components (UI, layout, forms, etc.).
* **features**: Domain-specific logic, pages, components, and hooks (e.g., showcase, clients, reprint).
* **services**: Infrastructure interfaces (API client, storage, auth wrappers).
* **stores**: Global Zustand state stores.

## 2. Strict Type Safety
We enforce TypeScript strict mode:
* No `any` type allowances.
* Strict null checks.
* Type assertions are avoided in favor of type guard functions.

## 3. Data Fetching & Caching (TanStack Query)
* Caching policies are tailored for dense operations dashboards.
* `refetchOnWindowFocus` is disabled globally to prevent page jittering during active grid scanning.
* Queries are shared via hooks inside feature folders.

## 4. Error Handling Framework
1. **ErrorBoundary**: Catches React render cycle failures and displays a full-page crash screen.
2. **ApiErrorMapper**: Translates Axios HTTP exception responses into standard, user-friendly `ApiError` shapes.
3. **Form Errors**: Handled using `react-hook-form` and schema validations in `zod`.

## 5. Axios Client Setup
* Located in `src/services/api/axiosInstance.ts`.
* Automatic JWT header injection.
* Automates session logout on `401 Unauthorized`.
