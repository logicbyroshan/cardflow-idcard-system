# Android App Signing Key Fix

## Current Issue
- **Play Store Expected**: SHA1: `73:33:B5:9B:F5:A3:78:BF:18:E4:1C:78:BC:CB:6C:B1:07:CF:3A:DA`
- **Old/Current Used**: SHA1: `46:62:99:35:26:A6:48:C6:AA:70:58:FB:AA:81:8B:AD:43:2C:2C:34`
- **New Generated**: SHA1: `F4:BD:0E:DF:08:43:C8:70:E0:D0:E8:55:EF:A0:07:A2:93:52:2A:90`

## Solution Steps

### Option 1: Play App Signing is ENABLED (Recommended)
If "Play App Signing" is enabled in Google Play Console:

1. Go to Google Play Console → Select App → Setup → App Signing
2. Check if "App Signing by Google Play" is ON
3. If enabled, the expected fingerprint (73:33:B5:9B...) is Google's managed key
4. You can use ANY upload key to upload the AAB
5. **Action**: Use the new generated key `F4:BD:0E:DF...` to upload the AAB - Google will accept it

**Steps:**
```bash
# The new keystore is ready at:
# adarsh_native_app/android/release.keystore
# With fingerprint: F4:BD:0E:DF:08:43:C8:70:E0:D0:E8:55:EF:A0:07:A2:93:52:2A:90

# Build and upload the AAB
cd adarsh_native_app/android
./gradlew.bat bundleRelease
# Upload: app/build/outputs/bundle/release/app-release.aab
```

### Option 2: Play App Signing is DISABLED
If "App Signing by Google Play" is OFF in Play Console:

1. You MUST use the original key with fingerprint `73:33:B5:9B...`
2. This key must be found/recovered from:
   - Original development machine
   - Backup/archive location
   - Secure storage/password manager
   - Team member who originally created the key

**If the original key is lost:**
- You cannot update the app with a new key (Play Store won't allow it)
- You must enable "Play App Signing" in Play Console to recover
- Or create a new app listing (last resort)

## Current Status
✅ Old keystores backed up (renamed to `.keystore.old`)
✅ New keystore generated at: `adarsh_native_app/android/release.keystore`
✅ Fingerprint: `F4:BD:0E:DF:08:43:C8:70:E0:D0:E8:55:EF:A0:07:A2:93:52:2A:90`
✅ Build configuration ready

## Next Steps

1. **Check Play Console Settings:**
   - Go to: Google Play Console → Your App → Setup → App Signing
   - Screenshot if "App Signing by Google Play" is ON/OFF

2. **If Play App Signing is ON:**
   - Proceed to upload the new AAB with the new key
   - Google will automatically re-sign it

3. **If Play App Signing is OFF:**
   - Provide the original keystore file with fingerprint `73:33:B5:9B...`
   - Or enable Play App Signing in Play Console

## File Locations
- **Current Release Key**: `adarsh_native_app/android/release.keystore`
- **Backup of Old Key**: `adarsh_native_app/android/release.keystore.old` (fingerprint: 46:62:99:35...)
- **Key Config**: `adarsh_native_app/android/keystore.properties`
