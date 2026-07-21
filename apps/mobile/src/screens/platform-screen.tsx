import "react-native-url-polyfill/auto";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Button, Linking, Platform, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";

/**
 * The full patient/staff platform, rendered from the live web deployment —
 * the native app never re-implements platform features, so every web deploy
 * updates this screen with zero app-store release. Only the device layer
 * (BLE pairing/sync) is native, because the web can't reach Bluetooth.
 *
 * Opens on /login: proxy.ts bounces an authenticated session straight to its
 * role home, so returning users land on their dashboard.
 */
const PLATFORM_URL =
  process.env.EXPO_PUBLIC_PLATFORM_URL ?? "https://tarragon-health-web.vercel.app";

const PLATFORM_HOST = new URL(PLATFORM_URL).host;

function isPlatformUrl(url: string): boolean {
  try {
    const { host, protocol } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    // Allow the platform host plus Paystack/Stripe hosted checkout, which the
    // subscription flow redirects through and back.
    return (
      host === PLATFORM_HOST ||
      host.endsWith(".paystack.com") ||
      host === "checkout.stripe.com"
    );
  } catch {
    return false;
  }
}

export function PlatformScreen() {
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [failed, setFailed] = useState(false);

  // Android hardware back navigates the WebView history before exiting.
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (canGoBackRef.current) {
        webViewRef.current?.goBack();
        return true;
      }
      return false;
    });
    return () => subscription.remove();
  }, []);

  const handleNavigationStateChange = useCallback((navState: WebViewNavigation) => {
    canGoBackRef.current = navState.canGoBack;
  }, []);

  if (failed) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 12 }}>
        <Text style={{ fontSize: 18, fontWeight: "600" }}>Couldn&apos;t reach TarragonHealth</Text>
        <Text style={{ textAlign: "center", color: "#555" }}>
          Check your connection and try again.
        </Text>
        <Button title="Retry" onPress={() => setFailed(false)} />
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: `${PLATFORM_URL}/login` }}
      onNavigationStateChange={handleNavigationStateChange}
      onError={() => setFailed(true)}
      onShouldStartLoadWithRequest={(request) => {
        if (isPlatformUrl(request.url)) return true;
        // Anything off-platform (support links, partner sites) opens in the
        // system browser instead of hijacking the shell.
        void Linking.openURL(request.url);
        return false;
      }}
      startInLoadingState
      renderLoading={() => (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#0E7C52" />
        </View>
      )}
      allowsBackForwardNavigationGestures
      domStorageEnabled
      sharedCookiesEnabled
      style={{ flex: 1 }}
    />
  );
}
