/**
 * S88a: side-effect-only module. `index.js` imports this FIRST, before react-native-gesture-handler, expo and the app
 * root. ES imports are hoisted and evaluated in order, so importing it first installs the global error handler before the
 * rest of the app's module graph evaluates, and a crash while that graph loads is reported too. Keep it tiny: it must not
 * import anything from the app (a test checks crash-reporting.ts's import list too).
 */
import { installCrashReporting } from "./crash-reporting";

installCrashReporting();
