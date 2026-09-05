import "react-native-url-polyfill/auto";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, Linking, Platform, Text, View } from "react-native";
import { WebView } from "react-native-webview";
import type { WebViewNavigation } from "react-native-webview";
import { isPlatformUrl, PLATFORM_URL } from "@/lib/platform-url";
import { supabase } from "@/lib/supabase";
import { colors, spacing } from "@/ui/theme";
import { PrimaryButton } from "@/ui/components";

interface WebViewScreenProps {
  /** Path on the platform to open, e.g. "/patient/care". */
  path: string;
}

/** Appended to the WebView's User-Agent. The web app looks for exactly this
 * token to decide it is embedded — keep it in sync with
 * apps/web/src/lib/embedded-webview.ts. */
const EMBEDDED_UA_TOKEN = "TarragonHealthApp";

/**
 * Embeds one section of the full web platform inline in the native shell —
 * the "[WEBVIEW]" screens from docs/MOBILE_APP_SPEC.md. The native shell
 * never re-implements these; every web deploy updates them with zero
 * app-store release.
 *
 * This WebView has its own cookie jar, separate from the native Supabase
 * session used for the rest of the app. Rather than showing the platform's
 * own login page to an already-signed-in patient, the initial load is
 * routed through /auth/mobile-bridge with the native session's tokens in the
 * URL fragment (never sent to a server, unlike a query string) — that page
 * calls setSession() to establish a cookie-backed web session, then
 * continues to `path`. See
 * apps/web/src/app/auth/mobile-bridge/mobile-bridge-gate.tsx for the other
 * half. sharedCookiesEnabled means the resulting cookie is then reused by
 * future WebView opens without going through the bridge again.
 */
export function WebViewScreen({ path }: WebViewScreenProps) {
  const webViewRef = useRef<WebView>(null);
  const canGoBackRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        const session = data.session;
        if (!session) {
          // Not expected on an authenticated screen, but falls back to the
          // platform's own login page rather than a dead WebView.
          setUri(`${PLATFORM_URL}${path}`);
          return;
        }
        const fragment = new URLSearchParams({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          next: path,
        });
        setUri(`${PLATFORM_URL}/auth/mobile-bridge#${fragment.toString()}`);
      })
      .catch(() => {
        // Same fallback as the no-session case: the platform's own login
        // page beats a spinner that never resolves.
        if (!cancelled) setUri(`${PLATFORM_URL}${path}`);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

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

  if (!uri) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.brand} />
      </View>
    );
  }

  return (
    <WebView
      ref={webViewRef}
      source={{ uri }}
      onNavigationStateChange={handleNavigationStateChange}
      onError={() => setFailed(true)}
      onShouldStartLoadWithRequest={(request) => {
        if (isPlatformUrl(request.url)) return true;
        // Only ordinary web links leave the shell for the system browser.
        // Anything else (intent:, javascript:, file:, custom schemes) is
        // dropped rather than handed to Linking, where a page-controlled
        // scheme could open arbitrary apps.
        if (request.url.startsWith("https:")) {
          void Linking.openURL(request.url).catch(() => {});
        }
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
      // Tells the platform it is being rendered inside the native shell, so
      // it drops its own sidebar, header and bottom tab bar and renders the
      // page content alone. Without it the patient saw the app's chrome and
      // the web app's chrome stacked — two "TarragonHealth" headers and two
      // identical bottom tab bars on one screen. A User-Agent suffix rather
      // than a query parameter because it survives every in-WebView
      // navigation automatically; the web side reads it server-side in
      // (dashboard)/layout.tsx.
      applicationNameForUserAgent={EMBEDDED_UA_TOKEN}
      style={{ flex: 1 }}
    />
  );
}
