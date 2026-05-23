# Mobile App Release & Signing Guide

## Prerequisites

- Android SDK and build tools installed
- Java 17 JDK
- Gradle wrapper in `android_app/android/`
- `release.keystore` file in `android_app/android/app/`
- Google Play Console account with app registered

---

## Step-by-Step Release Process

### 1. Verify Versions
```bash
# Backend version
cat VERSION.txt
# Expected: v3.19.0 (or higher)

# Mobile app version (versionCode and versionName)
cat android_app/app.json | grep -E '"version"|"versionCode"'
# Expected: versionCode=43, version="1.0.43"
```

### 2. Clean and Build Release AAB
```bash
cd android_app/android

# Clean previous builds
./gradlew clean

# Build signed release AAB
./gradlew bundleRelease
```

**Output Location**:
```
android_app/android/app/build/outputs/bundle/release/app-release.aab
```

### 3. Verify Signing
```bash
# Extract signing certificate from AAB
cd ../..
mkdir -p tmp_verify
jar xf android_app/android/app/build/outputs/bundle/release/app-release.aab META-INF/*.RSA META-INF/*.MF

# Print certificate details
keytool -printcert -file META-INF/*.RSA 2>&1 | grep -E 'Owner|Issuer|SHA1'
```

**Expected SHA1**: `2B:42:90:80:77:8A:27:71:3B:5D:0F:22:96:69:AF:8C:AD:05:00:34`

### 4. Upload to Google Play Console

1. Go to [Google Play Console](https://play.console.google.com)
2. Select "Adarsh ID Cards" app
3. Navigate to **Release** → **Production** (or Internal Testing first)
4. Click **Create new release**
5. Upload the AAB file from step 2
6. Fill in release notes and confirm signing certificate matches step 3
7. Review and publish

### 5. Monitor Post-Release (48 hours minimum)

Track metrics in Play Console:
- **Crash-Free Sessions**: Should stay > 99%
- **ANR Rate**: Should stay < 0.5%
- **Install errors**: Should be 0%

If issues detected:
1. Halt rollout immediately
2. Increment versionCode in `app.json`
3. Fix bug in mobile code
4. Rebuild and retest
5. Upload new AAB

---

## Keystore File Location & Backup

The project uses a secure, local-only layout for signing artifacts. These files MUST NOT be committed to Git.

| Purpose | Path (local, not committed) |
|---------|----------------------------|
| Primary keystore | `secrets/keystore/release.keystore` |
| Upload certificate (PEM) | `secrets/pem/upload_certificate.pem` |
| Config | `android_app/android/keystore.properties` (points to secrets) |

**Keystore Details**:
- Format: JKS
- Alias: `adarshrelease`
- Validity: 10,000 days
- Key Algorithm: RSA 2048-bit
- SHA1: `2B:42:90:80:77:8A:27:71:3B:5D:0F:22:96:69:AF:8C:AD:05:00:34`

Important: The `secrets/` directory is listed in `.gitignore`. Keep an off-machine backup (external drive or secure cloud key vault) for long-term storage.

---

## Troubleshooting

### Build Fails: "Keystore not found"
```
Solution: Ensure android_app/android/keystore.properties exists and paths are correct.
```

### Build Fails: "Keystore password incorrect"
```
Solution: Verify keystore.properties has correct storePassword and keyPassword.
Default: AdarshRelease2026!
```

### AAB Signature Mismatch with Play Console
```
Solution: Ensure you're using the correct release.keystore. 
Verify SHA1 matches the value on Play Console "App signing" page.
If mismatch, contact Play Console support for key rotation request.
```

### Gradle Build Timeout
```
Solution: Increase timeout in gradle.properties:
org.gradle.jvmargs=-Xmx4096m
```

---

## Version Bumping

When releasing a new version:

1. **Update Mobile Version**:
   ```json
   // android_app/app.json
   {
     "expo": {
       "version": "1.0.44",  // ← Bump here
       "android": {
         "versionCode": 44    // ← Increment by 1 each time
       }
     }
   }
   ```

2. **Update Backend Version** (if applicable):
   ```bash
   # VERSION.txt
   echo "v3.20.0" > VERSION.txt
   ```

3. **Commit**:
   ```bash
   git add android_app/app.json VERSION.txt
   git commit -m "Bump version: mobile 1.0.44, backend v3.20.0"
   git tag v3.20.0
   git push origin main --tags
   ```

---

## API Compatibility Matrix

| Backend Version | Mobile Version | Status |
|-----------------|----------------|--------|
| v3.19.0         | 1.0.43         | Current |
| v3.20.0         | 1.0.44+        | Next |

---

## ⚠️ CRITICAL SAFETY NOTES

### Never Delete `android_app/`
This directory contains all mobile app source code, build configuration, signing setup, and release credentials. Deleting it will:
- Break all Android builds and Play Store uploads
- Lose access to release signing keys
- Require full git recovery and re-setup

If deleted: `git checkout HEAD -- android_app/`

### Backup Keystore
The `release.keystore` is critical. Keep these copies:
1. `android_app/android/app/release.keystore` (primary)
2. `android_app/android_backup/release.keystore` (backup)
3. External secure storage (cloud/external drive for long-term)

---

**Last Updated**: May 8, 2026  
**Maintained By**: Adarsh Dev Team  
**Status**: Production Ready
