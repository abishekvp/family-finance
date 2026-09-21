const { withAppBuildGradle } = require("@expo/config-plugins");

/**
 * Windows only: this checkout's path plus CMake/ninja's out-of-tree object file suffix for
 * react-native-gesture-handler/rnscreens/rnsvg codegen can exceed Windows' 260-character path
 * limit, failing native builds with "Filename longer than 260 characters" / "ninja: error:
 * Stat(...)". Redirects the CMake staging directory to a short, fixed path outside the repo so
 * the total path length stays well under the limit.
 *
 * `android/` is generated and gitignored, so this has to be a plugin: editing the generated
 * app/build.gradle directly would be wiped by the next `expo prebuild`.
 */
module.exports = function withCmakeShortPath(config) {
  if (process.platform !== "win32") return config;

  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.contents.includes("buildStagingDirectory")) return cfg;
    cfg.modResults.contents = cfg.modResults.contents.replace(
      "android {\n",
      `android {\n    externalNativeBuild {\n        cmake {\n            buildStagingDirectory "\${System.getProperty('user.home')}/ffcxx"\n        }\n    }\n\n`
    );
    return cfg;
  });
};
