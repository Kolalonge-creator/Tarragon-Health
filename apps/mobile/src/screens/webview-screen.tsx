import "react-native-url-polyfill/auto";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import { isPlatformUrl, PLATFORM_URL } from "@/lib/platform-url";
import { colors, spacing } from "@/ui/theme";
import { PrimaryButton } from "@/ui/components";

interface WebViewScreenProps {
  /** Path on the platform to open, e.g. "/patient/care". */
  path: string;
}

/**
 * Embeds one section of the full web platform inline in the native shell —
 * the "[WEBVIEW]" screens from docs/MOBILE_APP_SPEC.md. The native shell
 * never re-implements these; every web deploy updates them with zero
 * app-store release.
 *
 * Known gap: this WebView has its own cookie jar, separate from the native
 * Supabase session used for the rest of the app. The first time a signed-in
 * patient opens a WebView section, the platform's own auth gate will ask
 * them to sign in again inside the WebView (same as the app's previous
 * all-web "Home" tab already required) — cookies then persist across future
 * opens. A shared-session bridge is future work, not attempted here.
 */
export function WebViewScreen({ path }: WebViewScreenProps) {
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [failed, setFailed] = useState(false);

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
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          alignItems: "center",
          padding: spacing.screen,
          gap: 12,
          backgroundColor: colors.background,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "600", color: colors.ink }}>
          Couldn&apos;t reach TarragonHealth
        </Text>
        <Text style={{ textAlign: "center", color: colors.muted }}>
          Check your connection and try again.
        </Text>
        <PrimaryButton title="Retry" onPress={() => setFailed(false)} />
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ uri: `${PLATFORM_URL}${path}` }}
      onNavigationStateChange={handleNavigationStateChange}
      onError={() => setFailed(true)}
      onShouldStartLoadWithRequest={(request) => {
        if (isPlatformUrl(request.url)) return true;
        void Linking.openURL(request.url);
        return false;
      }}
      startInLoadingState
      renderLoading={() => (
        <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
          <ActivityIndicator size="large" color={colors.brand} />
        </View>
      )}
      allowsBackForwardNavigationGestures
      domStorageEnabled
      sharedCookiesEnabled
      style={{ flex: 1 }}
    />
  );
}
