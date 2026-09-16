import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors } from "../../src/components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

export default function Onboarding() {
  const { refreshUser } = useAuth();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post("/families", { name, currency });
      await refreshUser();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create family"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 20, backgroundColor: "#F8FAFC" }}>
      <Card>
        <Text style={{ fontSize: 20, fontWeight: "700", marginBottom: 4 }}>Create your family workspace</Text>
        <Text style={{ color: colors.slate500, marginBottom: 20 }}>
          This is where your household's shared accounts, budgets, and categories will live.
        </Text>

        <View style={{ marginBottom: 14 }}>
          <Label>Family name</Label>
          <Input value={name} onChangeText={setName} placeholder="The Smiths" />
        </View>

        <View style={{ marginBottom: 8 }}>
          <Label>Default currency</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CURRENCIES.map((c) => (
              <Pressable
                key={c}
                onPress={() => setCurrency(c)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: currency === c ? colors.brand600 : colors.slate50,
                  borderWidth: 1,
                  borderColor: currency === c ? colors.brand600 : colors.slate200,
                }}
              >
                <Text style={{ color: currency === c ? colors.white : colors.slate700, fontWeight: "600" }}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <ErrorText>{error}</ErrorText>

        <View style={{ marginTop: 16 }}>
          <Button title="Create family" onPress={handleSubmit} disabled={isSubmitting || !name.trim()} />
        </View>
      </Card>
    </ScrollView>
  );
}
