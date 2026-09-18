import { useState } from "react";
import { Text, View } from "react-native";
import { Sparkles } from "lucide-react-native";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Chip, ErrorText, Field, Input, Screen } from "../../src/components/ui";
import { Logo } from "../../src/components/Logo";

const CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "INR", name: "Indian Rupee" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
];

export default function Onboarding() {
  const { refreshUser } = useAuth();
  const { colors } = useTheme();
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
    <Screen scroll contentStyle={{ justifyContent: "center", flexGrow: 1 }}>
      <Logo size={56} style={{ alignSelf: "center", marginBottom: 20 }} />
      <Text style={{ fontSize: 21, fontWeight: "900", color: colors.ink, textAlign: "center" }}>Create your family workspace</Text>
      <Text style={{ color: colors.inkMuted, textAlign: "center", marginTop: 8, marginBottom: 20, paddingHorizontal: 8 }}>
        This is where your household's shared accounts, budgets and categories will live.
      </Text>

      <View style={{ gap: 16 }}>
        <Field label="Family name">
          <Input value={name} onChangeText={setName} placeholder="The Smiths" />
        </Field>

        <Field label="Default currency">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CURRENCIES.map((c) => (
              <Chip key={c.code} label={`${c.code} — ${c.name}`} selected={currency === c.code} onPress={() => setCurrency(c.code)} />
            ))}
          </View>
        </Field>

        <View style={{ flexDirection: "row", gap: 10, backgroundColor: colors.brandSoft, borderRadius: 14, padding: 12 }}>
          <Sparkles size={16} color={colors.brand600} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, fontSize: 12, color: colors.inkMuted, lineHeight: 17 }}>
            We'll set you up with a starter set of income and expense categories — edit or remove them anytime.
          </Text>
        </View>

        <ErrorText>{error}</ErrorText>

        <Button title={isSubmitting ? "Creating…" : "Create family"} size="lg" loading={isSubmitting} disabled={!name.trim()} onPress={handleSubmit} />
      </View>
    </Screen>
  );
}
