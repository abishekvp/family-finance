import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { Eye, EyeOff } from "lucide-react-native";
import { useAuth } from "../src/context/AuthContext";
import { useTheme } from "../src/context/ThemeContext";
import { getErrorMessage } from "../src/api/errors";
import { Button, ErrorText, Field, IconButton, Input, FormScrollView } from "../src/components/ui";
import { Logo } from "../src/components/Logo";
import { SocialSignIn } from "../src/components/SocialSignIn";
import { href } from "../src/lib/nav";

export default function Login() {
  const { login } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await login(email, password);
      router.replace("/");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to sign in"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <FormScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24, paddingBottom: 64 }}>
          <Logo size={56} style={{ alignSelf: "center", marginBottom: 24 }} />
          <Text style={{ fontSize: 24, fontWeight: "900", color: colors.ink, textAlign: "center" }}>Welcome back</Text>
          <Text style={{ color: colors.inkMuted, textAlign: "center", marginTop: 6, marginBottom: 28 }}>
            Sign in to your family finance workspace.
          </Text>

          <View style={{ gap: 16 }}>
            <Field label="Email">
              <Input autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="you@example.com" />
            </Field>
            <Field label="Password">
              <View style={{ position: "relative", justifyContent: "center" }}>
                <Input secureTextEntry={!showPassword} value={password} onChangeText={setPassword} placeholder="••••••••" style={{ paddingRight: 44 }} />
                <View style={{ position: "absolute", right: 6 }}>
                  <IconButton size={34} onPress={() => setShowPassword((v) => !v)}>
                    {showPassword ? <EyeOff size={17} color={colors.inkSubtle} /> : <Eye size={17} color={colors.inkSubtle} />}
                  </IconButton>
                </View>
              </View>
            </Field>

            <Pressable
              onPress={() => router.push(href("/forgot-password", { email }))}
              style={{ alignSelf: "flex-end", marginTop: -8, paddingVertical: 4 }}
            >
              <Text style={{ color: colors.brand600, fontWeight: "700", fontSize: 13 }}>Forgot password?</Text>
            </Pressable>

            <ErrorText>{error}</ErrorText>

            <Button title={isSubmitting ? "Signing in…" : "Sign in"} size="lg" loading={isSubmitting} onPress={handleSubmit} />
          </View>

          <View style={{ marginTop: 24 }}>
            <SocialSignIn />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 24 }}>
            <Text style={{ color: colors.inkMuted }}>Don't have an account? </Text>
            <Link href="/register" style={{ color: colors.brand600, fontWeight: "700" }}>
              Create one
            </Link>
          </View>
        </FormScrollView>
    </View>
  );
}
