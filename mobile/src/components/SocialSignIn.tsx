import { useState } from "react";
import { Text, View } from "react-native";
import { useRouter } from "expo-router";
import Svg, { Path, Rect } from "react-native-svg";
import { KeyRound } from "lucide-react-native";
import { useAuth, type OAuthProvider } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { getErrorMessage } from "../api/errors";
import { passkeysSupported, signInWithPasskey } from "../lib/passkeys";
import { Button, ErrorText } from "./ui";

function GoogleMark() {
  return (
    <Svg width={17} height={17} viewBox="0 0 48 48">
      <Path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <Path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <Path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <Path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 38.9 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </Svg>
  );
}

function MicrosoftMark() {
  return (
    <Svg width={15} height={15} viewBox="0 0 21 21">
      <Rect x={1} y={1} width={9} height={9} fill="#F25022" />
      <Rect x={11} y={1} width={9} height={9} fill="#7FBA00" />
      <Rect x={1} y={11} width={9} height={9} fill="#00A4EF" />
      <Rect x={11} y={11} width={9} height={9} fill="#FFB900" />
    </Svg>
  );
}

/** "Continue with Google / Microsoft / passkey" — shared by the sign-in and sign-up screens. */
export function SocialSignIn() {
  const { signInWithOAuth, completeSignIn } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const [busy, setBusy] = useState<OAuthProvider | "passkey" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: OAuthProvider | "passkey") {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "passkey") {
        const tokens = await signInWithPasskey();
        await completeSignIn(tokens.accessToken, tokens.refreshToken);
      } else if (!(await signInWithOAuth(kind))) {
        return; // cancelled
      }
      router.replace("/");
    } catch (err) {
      setError(getErrorMessage(err, "Sign-in failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
        <Text style={{ color: colors.inkSubtle, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 }}>OR CONTINUE WITH</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: colors.line }} />
      </View>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button title="Google" variant="secondary" icon={<GoogleMark />} loading={busy === "google"} disabled={busy !== null} onPress={() => run("google")} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Microsoft" variant="secondary" icon={<MicrosoftMark />} loading={busy === "microsoft"} disabled={busy !== null} onPress={() => run("microsoft")} />
        </View>
      </View>
      {passkeysSupported() && (
        <Button
          title="Sign in with a passkey"
          variant="outline"
          icon={<KeyRound size={16} color={colors.ink} />}
          loading={busy === "passkey"}
          disabled={busy !== null}
          onPress={() => run("passkey")}
        />
      )}
      <ErrorText>{error}</ErrorText>
    </View>
  );
}
