const { withMainActivity } = require("@expo/config-plugins");

/**
 * react-native-health-connect's own app.plugin.js only patches
 * AndroidManifest.xml (the permissions-rationale intent-filter) — unlike
 * @kingstinct/react-native-healthkit's iOS plugin, it does NOT inject the
 * MainActivity.onCreate hookup its own README says is required:
 * `HealthConnectPermissionDelegate.setPermissionDelegate(this)`. Without it,
 * the permission-request activity-result contract never resolves and
 * requestPermission() hangs. This plugin closes that gap the same way the
 * HealthKit plugin closes the AppDelegate gap on iOS — regex-patched so it
 * survives a fresh `expo prebuild`, not a hand-edit to the generated file.
 */
module.exports = function withHealthConnectMainActivity(config) {
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== "kt") {
      // Expo's default template is Kotlin; a Java MainActivity would need
      // its own patch, but this project has never used one.
      return config;
    }

    let contents = config.modResults.contents;
    if (contents.includes("HealthConnectPermissionDelegate")) {
      return config;
    }

    // Expo's default template already imports Bundle (onCreate's own
    // signature needs it) — adding a second import of the same name is a
    // Kotlin compile error ("Conflicting import: imported name 'Bundle' is
    // ambiguous"), not a harmless no-op like a duplicate import would be in
    // most languages.
    const bundleImportLine = /^import android\.os\.Bundle$/m.test(contents)
      ? ""
      : "import android.os.Bundle\n";

    contents = contents.replace(
      /^(package .+\n)/m,
      `$1\n${bundleImportLine}import dev.matinzd.healthconnect.permissions.HealthConnectPermissionDelegate\n`
    );

    if (/override fun onCreate\(savedInstanceState: Bundle\?\)/.test(contents)) {
      contents = contents.replace(
        /(override fun onCreate\(savedInstanceState: Bundle\?\)\s*\{\n)/,
        `$1    HealthConnectPermissionDelegate.setPermissionDelegate(this)\n`
      );
    } else {
      contents = contents.replace(
        /(class MainActivity\s*:\s*ReactActivity\(\)\s*\{\n)/,
        `$1\n  override fun onCreate(savedInstanceState: Bundle?) {\n    super.onCreate(savedInstanceState)\n    HealthConnectPermissionDelegate.setPermissionDelegate(this)\n  }\n`
      );
    }

    config.modResults.contents = contents;
    return config;
  });
};
