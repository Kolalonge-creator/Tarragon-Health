import "react-native-gesture-handler";
import { registerRootComponent } from "expo";

import { installCrashReporting } from "./src/lib/crash-reporting";
import Root from "./src/root";

// S88a: JS crash reporter, dormant unless EXPO_PUBLIC_SENTRY_DSN is set. Installed before anything else renders.
installCrashReporting();

registerRootComponent(Root);
