package in.adarshbhopal.panel1804;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import androidx.annotation.NonNull;

import com.getcapacitor.BridgeActivity;

/**
 * Main entry point for the Adarsh Admin Android app.
 *
 * Goes beyond a bare WebView shell by adding:
 *   - Native connectivity monitoring via ConnectivityManager
 *   - Edge-to-edge display for modern Android
 *   - Lifecycle-aware WebView management
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "AdarshMain";
    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        registerNativeNetworkMonitor();
        applyEdgeToEdgeDisplay();

        Log.i(TAG, "Adarsh Admin started — build " + BuildConfig.VERSION_CODE
                + " (" + BuildConfig.VERSION_NAME + ")");
    }

    // ──────────────────────────────────────────────────────────────
    // Native connectivity monitoring
    // ──────────────────────────────────────────────────────────────

    /**
     * Registers an Android-native network callback that dispatches
     * 'native:network' CustomEvents into the WebView. This is faster
     * and more reliable than navigator.onLine, especially on
     * low-end devices and when switching between Wi-Fi and mobile data.
     */
    private void registerNativeNetworkMonitor() {
        connectivityManager = (ConnectivityManager)
                getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;

        NetworkRequest request = new NetworkRequest.Builder()
                .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                .build();

        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(@NonNull Network network) {
                dispatchNetworkEvent(true);
            }

            @Override
            public void onLost(@NonNull Network network) {
                dispatchNetworkEvent(false);
            }

            @Override
            public void onCapabilitiesChanged(@NonNull Network network,
                                              @NonNull NetworkCapabilities caps) {
                boolean validated = caps.hasCapability(
                        NetworkCapabilities.NET_CAPABILITY_VALIDATED);
                dispatchNetworkEvent(validated);
            }
        };

        try {
            connectivityManager.registerNetworkCallback(request, networkCallback);
        } catch (Exception e) {
            Log.w(TAG, "Failed to register network callback", e);
        }
    }

    /**
     * Pushes a native:network event into the WebView JS context.
     */
    private void dispatchNetworkEvent(boolean connected) {
        runOnUiThread(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    String js = "window.dispatchEvent(new CustomEvent('native:network',"
                            + "{detail:{connected:" + connected + "}}));";
                    getBridge().eval(js, null);
                }
            } catch (Exception e) {
                Log.w(TAG, "dispatchNetworkEvent failed", e);
            }
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Edge-to-edge display
    // ──────────────────────────────────────────────────────────────

    /**
     * On Android 11+ (API 30), enables edge-to-edge rendering so the
     * WebView content can extend behind the status bar and navigation
     * bar, matching the immersive feel of native apps.
     */
    private void applyEdgeToEdgeDisplay() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                View decorView = getWindow().getDecorView();
                WindowInsetsController controller = decorView.getWindowInsetsController();
                if (controller != null) {
                    controller.setSystemBarsAppearance(
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS,
                            WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    );
                }
            } catch (Exception e) {
                Log.w(TAG, "Edge-to-edge setup failed", e);
            }
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Lifecycle
    // ──────────────────────────────────────────────────────────────

    @Override
    protected void onResume() {
        super.onResume();
        Log.d(TAG, "onResume — WebView active");
    }

    @Override
    protected void onPause() {
        super.onPause();
        Log.d(TAG, "onPause — WebView backgrounded");
    }

    @Override
    protected void onDestroy() {
        // Unregister network callback to prevent leaks
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (Exception e) {
                Log.w(TAG, "Failed to unregister network callback", e);
            }
        }
        super.onDestroy();
    }
}