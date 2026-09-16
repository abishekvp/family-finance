import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Link, useRouter } from "expo-router";
import { useAuth } from "../src/context/AuthContext";
import { getErrorMessage } from "../src/api/errors";
import { Button, Card, ErrorText, Input, Label } from "../src/components/ui";

export default function Register() {
  const { register } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: "#F8FAFC" }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20 }}>
        <Card>
          <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 4 }}>Create your account</Text>
          <Text style={{ color: "#64748B", marginBottom: 20 }}>
            Start managing your family's finances together.
          </Text>

          <View style={{ marginBottom: 14 }}>
            <Label>Name</Label>
            <Input value={name} onChangeText={setName} placeholder="Jane Doe" />
          </View>
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
            <Input secureTextEntry value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
          </View>

          <ErrorText>{error}</ErrorText>

          <View style={{ marginTop: 16 }}>
            <Button title="Create account" onPress={handleSubmit} disabled={isSubmitting} />
          </View>

          <View style={{ flexDirection: "row", justifyContent: "center", marginTop: 20 }}>
            <Text style={{ color: "#64748B" }}>Already have an account? </Text>
            <Link href="/login" style={{ color: "#4F46E5", fontWeight: "600" }}>
              Sign in
            </Link>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
