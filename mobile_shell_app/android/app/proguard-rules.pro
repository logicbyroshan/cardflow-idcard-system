# Add project specific ProGuard rules here.
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# ── Capacitor ──────────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-dontwarn com.getcapacitor.**

# Keep Capacitor plugin classes (auto-discovered via reflection)
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }

# ── App ────────────────────────────────────────────────────
-keep class in.adarshbhopal.panel1804.** { *; }

# ── Cordova bridge (used by capacitor-cordova-android-plugins) ──
-keep class org.apache.cordova.** { *; }
-dontwarn org.apache.cordova.**

# ── Google Play Services / Firebase (push notifications) ──
-keep class com.google.firebase.** { *; }
-dontwarn com.google.firebase.**
-keep class com.google.android.gms.** { *; }
-dontwarn com.google.android.gms.**

# Preserve line numbers for crash stack traces
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
