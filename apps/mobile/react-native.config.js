// Firebase (App Check with Play Integrity) is Android-only for now. ios/ is a committed native project, so an Expo
// config plugin cannot add Firebase to it, and the Firebase iOS pods need `use_frameworks! :linkage => :static`, which
// has not been tried against this app's other native modules. Until an iOS Firebase app (GoogleService-Info.plist) and
// App Attest are set up and that build is proven, the pods are kept out of iOS autolinking; src/lib/app-check.ts
// returns no token on iOS, and the server's check (apps/web/src/lib/app-check/verify.ts) is in monitor mode.
module.exports = {
  dependencies: {
    "@react-native-firebase/app": { platforms: { ios: null } },
    "@react-native-firebase/app-check": { platforms: { ios: null } },
  },
};
