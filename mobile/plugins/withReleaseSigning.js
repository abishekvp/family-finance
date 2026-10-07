const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Signs release builds with your Google Play upload key instead of the template's debug keystore
 * (which Play refuses, and which is the same public file in every React Native project).
 *
 * The key's location and passwords are read from the environment when Gradle runs, so they are never
 * written into the generated android/ folder:
 *
 *   ANDROID_UPLOAD_KEYSTORE           path to the .jks / .keystore file
 *   ANDROID_UPLOAD_KEYSTORE_PASSWORD  its store password
 *   ANDROID_UPLOAD_KEY_ALIAS          the key's alias
 *   ANDROID_UPLOAD_KEY_PASSWORD       the key's password (often the same as the store password)
 *
 * The build stops with a clear message when they're missing, rather than quietly producing a bundle
 * Play would reject. Only applied to the Play channel (see app.config.js); the website's APK keeps
 * the key existing installs were signed with, so in-app updates keep working for them.
 */
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let gradle = cfg.modResults.contents;
    if (gradle.includes("signingConfigs.upload")) return cfg;

    const uploadConfig = `signingConfigs {
        upload {
            def keystorePath = System.getenv("ANDROID_UPLOAD_KEYSTORE")
            if (keystorePath) {
                storeFile file(keystorePath)
                storePassword System.getenv("ANDROID_UPLOAD_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_UPLOAD_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_UPLOAD_KEY_PASSWORD") ?: System.getenv("ANDROID_UPLOAD_KEYSTORE_PASSWORD")
            }
        }`;
    if (!/signingConfigs\s*\{/.test(gradle)) throw new Error("withReleaseSigning: no signingConfigs block in app/build.gradle");
    gradle = gradle.replace(/signingConfigs\s*\{/, uploadConfig);

    const releaseSigning = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseSigning.test(gradle)) throw new Error("withReleaseSigning: couldn't find the release build type's signing config");
    gradle = gradle.replace(releaseSigning, "$1signingConfig signingConfigs.upload");

    // Checked only when a release task actually runs, so debug builds of this project still work.
    gradle += `
// Added by plugins/withReleaseSigning.js
gradle.taskGraph.whenReady { graph ->
    if (graph.allTasks.any { it.name.toLowerCase().contains("release") } && !System.getenv("ANDROID_UPLOAD_KEYSTORE")) {
        throw new GradleException("Set ANDROID_UPLOAD_KEYSTORE (and its passwords) to sign the Play build with your upload key.")
    }
}
`;

    cfg.modResults.contents = gradle;
    return cfg;
  });
};
