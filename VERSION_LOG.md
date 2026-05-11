# Adarsh Platform Version Log

| Date | Platform Version | Mobile Version | Mobile Build | Key Changes |
| :--- | :--- | :--- | :--- | :--- |
| **2026-05-11** | **v3.20.0** | **1.0.45** | **45** | **Google Play API 35 Requirement Fix** |
| 2026-05-11 | v3.20.0 | 1.0.44 | 44 | SVG Icon Stabilization, Crash Fix, Release Signing |
| 2026-05-08 | v3.19.0 | 1.0.43 | 43 | Role-based UI logic and initial native build |

## Current Release Candidate (v3.20.0 / 1.0.45)

### Mobile App (1.0.45)
- **API 35 Target**: Updated `targetSdkVersion` to 35 to meet the latest Google Play Store requirements.
- **Centralized Iconography**: Migrated from `@expo/vector-icons` fonts to native SVG paths in `Icons.js`.
- **Stability**: Fixed Android startup crash (`ReferenceError: fontFamily`).
- **Resilience**: Added 5-second splash timeout and global error boundaries.
- **Signing**: Configured with production `release.keystore` from May 8th.

### Backend (v3.20.0)
- **API Support**: Standardized `/api/mobile/` endpoints for the new icon architecture.
- **Migrations**: Included merged migrations for schema consistency.

## Next Steps
- [ ] Complete Google Play Store upload of `app-release.aab` (v44).
- [ ] Verify internal testing track performance on target devices (Vivo V27 Pro).
- [ ] Monitor backend API logs for any version mismatches.
