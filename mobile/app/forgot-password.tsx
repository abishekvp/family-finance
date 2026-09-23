import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { api } from "../src/api/client";
import { getErrorMessage } from "../src/api/errors";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { Button, ErrorText, Field, Input, SuccessText } from "../src/components/ui";
import { Logo } from "../src/components/Logo";

export default function ForgotPassword() {
  const { completeSignIn } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState(params.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/password/forgot", { email: email.trim() });
      setStep("reset");
      setNotice(`If an account exists for ${email.trim()}, we've emailed it a 6-digit code.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to send the code"));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post("/auth/password/reset", { email: email.trim(), code, password });
      await completeSignIn(res.data.accessToken, res.data.refreshToken);
      router.replace("/");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to reset your password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }} keyboardShouldPersistTaps="handled">
          <Logo size={56} style={{ alignSelf: "center", marginBottom: 24 }} />
          <Text style={{ fontSize: 24, fontWeight: "900", color: colors.ink, textAlign: "center" }}>
            {step === "email" ? "Forgot your password?" : "Choose a new password"}
          </Text>
          <Text style={{ color: colors.inkMuted, textAlign: "center", marginTop: 6, marginBottom: 28 }}>
            {step === "email"
              ? "Enter your account email and we'll send you a code."
              : "Enter the code from your email and pick a new password. You'll be signed out on other devices."}
          </Text>

          {step === "email" ? (
            <View style={{ gap: 16 }}>
              <Field label="Email">
                <Input autoCapitalize="none" autoFocus keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
              </Field>
              <ErrorText>{error}</ErrorText>
              <Button title="Send reset code" size="lg" loading={busy} disabled={!email.trim()} onPress={sendCode} />
            </View>
          ) : (
            <View style={{ gap: 16 }}>
              <SuccessText>{notice}</SuccessText>
              <Field label="6-digit code">
                <Input
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={6}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/\D/g, ""))}
                  placeholder="123456"
                  style={{ letterSpacing: 6 }}
                />
              </Field>
              <Field label="New password" hint="At least 8 characters.">
                <Input secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} />
              </Field>
              <ErrorText>{error}</ErrorText>
              <Button title="Reset password and sign in" size="lg" loading={busy} disabled={code.length !== 6 || password.length < 8} onPress={reset} />
              <Pressable onPress={sendCode} disabled={busy} style={{ alignSelf: "center", padding: 8 }}>
                <Text style={{ color: colors.brand600, fontWeight: "700", fontSize: 13 }}>Send a new code</Text>
              </Pressable>
            </View>
          )}

          <Pressable onPress={() => router.back()} style={{ alignSelf: "center", marginTop: 24, padding: 8 }}>
            <Text style={{ color: colors.inkMuted }}>
              Remembered it? <Text style={{ color: colors.brand600, fontWeight: "700" }}>Back to sign in</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
