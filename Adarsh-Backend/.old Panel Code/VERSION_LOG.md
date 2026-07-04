# Adarsh Platform Version Log

| Date | Platform Version | Mobile Version | Mobile Build | Key Changes |
| :--- | :--- | :--- | :--- | :--- |
| **2026-05-30** | **v4.18.2** | **1.0.56** | **56** | **Phase 2 app bug fixes: designation field layout fix, search query reset on tab switch, in-place client updates, flat list keyboard persistent tap, admin client status tabs pre-selection** |
| **2026-05-22** | **v4.18.2** | **1.0.45** | **45** | **Fix: Reprint download CSRF refresh + retry; Pro Features admin UI fetch fixes; session keepalive URL handling; rebuild dist assets** |
| **2026-05-11** | **v3.20.0** | **1.0.45** | **45** | **Google Play API 35 Requirement Fix** |
| 2026-05-11 | v3.20.0 | 1.0.44 | 44 | SVG Icon Stabilization, Crash Fix, Release Signing |
| 2026-05-08 | v3.19.0 | 1.0.43 | 43 | Role-based UI logic and initial native build |

## Current Stable Release (v4.18.2 / 1.0.56)

### Mobile App (1.0.56)
- **API 35 Target**: Updated `targetSdkVersion` to 35 to meet the latest Google Play Store requirements.
- **Centralized Iconography**: Migrated from `@expo/vector-icons` fonts to native SVG paths in `Icons.js`.
- **Stability**: Fixed Android startup crash (`ReferenceError: fontFamily`).
- **Resilience**: Added 5-second splash timeout and global error boundaries.
- **Signing**: Configured with production `release.keystore` from May 8th.
- **Phase 2 fixes**: Included layout fixes for designation field, keyboard persist on lists, clear search on tab changes, and in-place client/card status updates.

### Backend (v4.18.2)
- **Reprint Workflow**: Confirmed-list retrieve action is wired and visible, with backend transition handling verified.
- **UI/Release**: Rebuilt dist assets and aligned the release log with the 4.18.2 deployment.
- **Approved List Actions**: Restored `Download Images` and `Download Word` on the approved list action bar for bulk-download users.

## Next Steps
- [ ] Complete Google Play Store upload of `app-release.aab` (v56).
- [ ] Verify internal testing track performance on target devices (Vivo V27 Pro).
- [ ] Monitor backend API logs for any version mismatches.
