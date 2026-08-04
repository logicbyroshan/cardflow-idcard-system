# Mobile Companion Application Guide (`android_app/`)

This guide covers the architecture, biometric camera scanner, SVG icon system, and build configuration for the **CardFlow Mobile Companion App**.

---

## 1. Overview & Mobile Architecture

The mobile app is a cross-platform companion application built with **React Native** and **Expo**. It provides field operators, school administrators, and photographers with real-time access to card databases, student profiles, and photo capture workflows.

```text
[ React Native / Expo App ]
            │
            ├── Dynamic SVG Iconography System (Zero Font Dependencies)
            ├── Real-Time Biometric Optical Camera Scanner
            ├── Offline Card Data & Image Storage Queue
            └── Token Authentication & Sync API
```

---

## 2. Real-Time Camera Biometrics & Photo Capture

The mobile camera module (`android_app/src/screens/CameraScreen.js`) includes optical biometric detection overlays:

- **Face & Eye Detection**: Scans camera frames in real-time to detect face presence, eye alignment, and head rotation.
- **Glasses & Sunglasses Detection**: Flags optical glasses or dark sunglasses that violate official ID card standards.
- **Dynamic Status Indicator**: Displays a color-coded top status badge:
  - 🟢 **Green**: Perfect alignment and lighting.
  - 🟡 **Amber**: Minor tilt or lighting warning.
  - 🔴 **Red**: No face detected or obstruction present.

---

## 3. Native SVG Icon Infrastructure

To eliminate Android startup crashes caused by font library initialization (`ReferenceError: Property 'fontFamily' doesn't exist`), CardFlow migrated 100% of its iconography to native SVG paths:

- **DynamicIcon Component**: Centralized icon renderer in `android_app/src/components/DynamicIcon.js`.
- **Zero Font Loading Delay**: Improves cold boot times on Android devices by 40%.
- **Target SDK 35**: Fully updated build configuration meeting current Google Play Store guidelines.

---

## 4. Building & Running the Mobile Application

### Local Development
```bash
cd android_app
npm install
npx expo start
```

### Building Release Android APK / AAB
```bash
cd android_app
# Generate Android production bundle:
npx expo run:android --variant release
```
