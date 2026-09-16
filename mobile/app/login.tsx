import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "../src/context/AuthContext";
import { getErrorMessage } from "../src/api/errors";
import { Button, Card, ErrorText, Input, Label } from "../src/components/ui";

export default function Login() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#F8FAFC" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 4 }}>Welcome back</Text>
          <Text style={{ color: "#64748B", marginBottom: 20 }}>Sign in to your family finance workspace.</Text>

          <View style={{ marginBottom: 14 }}>
            <Label>Email</Label>
            <Input
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
            />
          </View>
          <View style={{ marginBottom: 8 }}>
            <Label>Password</Label>
            <Input secureTextEntry value={password} onChangeText={setPassword} placeholder="••••••••" />
          </View>

          <ErrorText>{error}</ErrorText>

          <View style={{ marginTop: 16 }}>
            <Button title="Sign in" onPress={handleSubmit} disabled={isSubmitting} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
            <Text style={{ color: "#64748B" }}>Don't have an account? </Text>
            <Link href="/register" style={{ color: "#4F46E5", fontWeight: "600" }}>
              Create one
            </Link>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
