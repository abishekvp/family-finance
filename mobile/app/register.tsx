import { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { getErrorMessage } from "../src/api/errors";
import { Button, ErrorText, Field, IconButton, Input, ProgressBar } from "../src/components/ui";
import { Logo } from "../src/components/Logo";

function scorePassword(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH_LABELS = ["Too short", "Weak", "Fair", "Good", "Strong"];
const STRENGTH_TONES = ["expense", "expense", "warn", "brand", "income"] as const;

export default function Register() {
  const { register } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await register(name, email, password);
      router.replace("/");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create account"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
          <Logo size={56} style={{ alignSelf: "center", marginBottom: 24 }} />
          <Text style={{ fontSize: 24, fontWeight: "900", color: colors.ink, textAlign: "center" }}>Create your account</Text>
          <Text style={{ color: colors.inkMuted, textAlign: "center", marginTop: 6, marginBottom: 28 }}>
            Start managing your family's finances together.
          </Text>

          <View style={{ gap: 16 }}>
            <Field label="Name">
              <Input value={name} onChangeText={setName} placeholder="Jamie Lee" />
            </Field>
            <Field label="Email">
              <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
            </Field>
            <Field label="Password" hint="At least 8 characters.">
              <View style={{ position: "relative", justifyContent: "center" }}>
                <Input secureTextEntry={!showPassword} value={password} onChangeText={setPassword} placeholder="••••••••" style={{ paddingRight: 44 }} />
                <View style={{ position: "absolute", right: 6 }}>
                  <IconButton size={34} onPress={() => setShowPassword((v) => !v)}>
                    {showPassword ? <EyeOff size={17} color={colors.inkSubtle} /> : <Eye size={17} color={colors.inkSubtle} />}
                  </IconButton>
                </View>
              </View>
              {password.length > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <ProgressBar value={strength / 4} tone={STRENGTH_TONES[strength]} />
                  </View>
                  <Text style={{ fontSize: 11, fontWeight: "700", color: colors.inkSubtle }}>{STRENGTH_LABELS[strength]}</Text>
                </View>
              )}
            </Field>

            <ErrorText>{error}</ErrorText>

            <Button title={isSubmitting ? "Creating account…" : "Create account"} size="lg" loading={isSubmitting} onPress={handleSubmit} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 24 }}>
            <Text style={{ color: colors.inkMuted }}>Already have an account? </Text>
            <Link href="/login" style={{ color: colors.brand600, fontWeight: "700" }}>
              Sign in
            </Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
