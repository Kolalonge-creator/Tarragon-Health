// S88a: this import MUST stay first. It installs the JS crash reporter (dormant unless EXPO_PUBLIC_SENTRY_DSN is set)
// before any other module, including the app root, is evaluated. ES imports are hoisted, so a call placed after the
// imports would run too late to see a crash during module evaluation. crash-install.test.ts enforces this order.
import "./src/lib/crash-install";

import "react-native-gesture-handler";
import { registerRootComponent } from "expo";

import Root from "./src/root";

registerRootComponent(Root);
