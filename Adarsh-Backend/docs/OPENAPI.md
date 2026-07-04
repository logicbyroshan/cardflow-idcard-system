# Adarsh ID Panel: OpenAPI, Swagger & Postman Configurations

This document explains how to view the API schema, set up Swagger UI, and generate/import Postman collections for integration testing.

---

## 1. Schema Generation

The API schema is generated automatically from Django REST Framework views and serializers using `drf-spectacular`.

### Generate OpenAPI YAML Schema File
To compile a fresh schema file from the codebase:
```bash
python manage.py spectacular --file schema.yml
```
This produces `schema.yml` in the root workspace directory.

---

## 2. Swagger UI Setup

To run a local interactive Swagger documentation server:

1. **Verify Spectacular Installation**:
   Ensure `drf-spectacular` is registered in `INSTALLED_APPS` (configured in `base.py`).
2. **Access URLs**:
   The interactive API views are exposed at:
   - **Swagger UI**: `/api/schema/swagger-ui/`
   - **ReDoc UI**: `/api/schema/redoc/`
   - **Raw JSON Schema**: `/api/schema/`
3. **Local Server Execution**:
   Start the development server:
   ```bash
   python manage.py runserver
   ```
   Navigate to `http://127.0.0.1:8000/api/schema/swagger-ui/` in your web browser.

---

## 3. Postman Collection Integration

Postman supports importing OpenAPI yml files directly to generate structured endpoint collections.

### Steps to Import:
1. Open the Postman application.
2. Click the **Import** button in the upper-left workspace header.
3. Select the `schema.yml` file generated in the project root.
4. Postman will auto-detect the OpenAPI 3.0 specification.
5. Choose **Link as API** or **Import as a Collection**.
6. Postman will generate a complete collection of folders organized by API groups (Auth, Cards, Tables, Sandbox, Desktop, Operations) containing ready-to-run HTTP requests with variable placeholders.

### Configuring Environments in Postman:
Configure a new Postman Environment containing the following variables:
- `baseUrl`: `http://127.0.0.1:8000` (for local development)
- `authToken`: JWT token returned from `/api/v1/auth/token/`
- `desktopApiKey`: Token for desktop synchronize authentication header `X-Desktop-Api-Key`
- `sandboxToken`: Token for sandbox header `X-Sandbox-Token`
