// Expo reads app.json first and hands it to this function as `config`; everything that depends on
// how a build is distributed is decided here, from environment variables set by the build scripts
// (see scripts/release.mjs at the repo root):
//
//   APP_CHANNEL=direct (default)  The APK published on the website. It updates itself, so it keeps the
//                                 package name and signing key existing installs already have.
//   APP_CHANNEL=play              The Google Play build: no self-updater and no permission to install
//                                 packages (Play forbids both), signed with your upload key.
//   ANDROID_PLAY_PACKAGE          Package name of the Play build (permanent once published).
//   APP_SMS=off                   Leave out recording transactions from bank SMS (and its permissions).
//
// Signing the Play build reads ANDROID_UPLOAD_KEYSTORE, ANDROID_UPLOAD_KEYSTORE_PASSWORD,
// ANDROID_UPLOAD_KEY_ALIAS and ANDROID_UPLOAD_KEY_PASSWORD at build time; see plugins/withReleaseSigning.js.

const DEFAULT_PLAY_PACKAGE = "in.abishek.familyfinance";

// Permissions Expo's template or libraries add that this app never uses — and that Google Play
// reviews flag (drawing over other apps) or that are pointless on modern Android (shared storage).
const UNUSED_PERMISSIONS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];
const INSTALL_PACKAGES = "android.permission.REQUEST_INSTALL_PACKAGES";
const SMS_PERMISSIONS = ["android.permission.READ_SMS", "android.permission.RECEIVE_SMS"];

module.exports = ({ config }) => {
  const channel = process.env.APP_CHANNEL === "play" ? "play" : "direct";
  const play = channel === "play";
  const sms = process.env.APP_SMS !== "off";

  const blockedPermissions = [...UNUSED_PERMISSIONS, ...(play ? [INSTALL_PACKAGES] : []), ...(sms ? [] : SMS_PERMISSIONS)];
  const permissions = (config.android?.permissions ?? []).filter((p) => !blockedPermissions.includes(p));

  return {
    ...config,
    android: {
      ...config.android,
      package: play ? process.env.ANDROID_PLAY_PACKAGE?.trim() || DEFAULT_PLAY_PACKAGE : config.android.package,
      permissions,
      blockedPermissions,
    },
    plugins: [...(config.plugins ?? []), ...(play ? ["./plugins/withReleaseSigning"] : [])],
    extra: { ...config.extra, distribution: channel, sms },
  };
};
