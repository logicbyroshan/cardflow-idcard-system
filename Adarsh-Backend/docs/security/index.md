# Security Handbook

- **Authentication**: Stateless JWT via `rest_framework_simplejwt`. Tokens expire in 60m.
- **Authorization**: Enforced via custom `Policy` classes invoked in services.
- **Tenant Isolation**: Handled via `.filter(organization=request.user.organization)` in all base Selectors.
- **Rate Limiting**: 
  - `AnonRateThrottle`: 100/day
  - `UserRateThrottle`: 1000/day
- **Upload Restrictions**: 
  - Max 10MB memory size.
  - Files are streamed to Storage via Contracts to prevent memory overflow.
  - Image validation strips EXIF data using Pillow.\n