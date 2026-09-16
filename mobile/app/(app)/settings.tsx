import { useState } from "react";
import { Pressable, ScrollView, Switch, Text, View } from "react-native";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { usePrefs, type LandingView, type WeekStart } from "../../src/context/PrefsContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, colors, pillStyle, pillTextStyle } from "../../src/components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const family = user!.families[0];
  const { prefs, updatePrefs } = usePrefs();
  const isAdmin = family.role === "ADMIN";

  const [currency, setCurrency] = useState(family.currency);
  const [customCurrency, setCustomCurrency] = useState("");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencyError, setCurrencyError] = useState<string | null>(null);
  const [currencySaved, setCurrencySaved] = useState(false);

  async function handleSaveCurrency(value: string) {
    const trimmed = value.trim().toUpperCase();
    if (trimmed.length !== 3) {
      setCurrencyError("Enter a 3-letter currency code, e.g. USD");
      return;
    }
    setCurrencyError(null);
    setSavingCurrency(true);
    setCurrencySaved(false);
    try {
      await api.patch(`/families/${family.id}`, { currency: trimmed });
      setCurrency(trimmed);
      await refreshUser();
      setCurrencySaved(true);
    } catch (err) {
      setCurrencyError(getErrorMessage(err, "Unable to update currency"));
    } finally {
      setSavingCurrency(false);
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.slate50 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.slate500, marginBottom: 8, textTransform: "uppercase" }}>
          Family currency
        </Text>
        <Card style={{ gap: 12 }}>
          {!isAdmin ? (
            <Text style={{ color: colors.slate500, fontSize: 13 }}>
              Currency is {currency}. Only a family admin can change it.
            </Text>
          ) : (
            <>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {CURRENCIES.map((c) => (
                  <Pressable key={c} onPress={() => handleSaveCurrency(c)} style={pillStyle(currency === c)}>
                    <Text style={pillTextStyle(currency === c)}>{c}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Input
                    value={customCurrency}
                    onChangeText={setCustomCurrency}
                    placeholder="Other (e.g. JPY)"
                    autoCapitalize="characters"
                    maxLength={3}
                  />
                </View>
                <Button
                  title={savingCurrency ? "Saving..." : "Save"}
                  variant="secondary"
                  disabled={savingCurrency || customCurrency.trim().length !== 3}
                  onPress={() => handleSaveCurrency(customCurrency)}
                />
              </View>
              {currencySaved && <Text style={{ color: colors.green600, fontSize: 12 }}>Currency updated.</Text>}
              <ErrorText>{currencyError}</ErrorText>
            </>
          )}
        </Card>
      </View>

      <View>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.slate500, marginBottom: 8, textTransform: "uppercase" }}>
          Transactions hub
        </Text>
        <Card style={{ gap: 16 }}>
          <View>
            <Label>Default landing view</Label>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["daily", "calendar"] as LandingView[]).map((v) => (
                <Pressable key={v} onPress={() => updatePrefs({ landingView: v })} style={pillStyle(prefs.landingView === v)}>
                  <Text style={pillTextStyle(prefs.landingView === v)}>{v === "daily" ? "Daily" : "Calendar"}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Label>Week starts on</Label>
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["sunday", "monday"] as WeekStart[]).map((v) => (
                <Pressable key={v} onPress={() => updatePrefs({ weekStart: v })} style={pillStyle(prefs.weekStart === v)}>
                  <Text style={pillTextStyle(prefs.weekStart === v)}>{v === "sunday" ? "Sunday" : "Monday"}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Label>Carry-over balances</Label>
              <Text style={{ color: colors.slate500, fontSize: 12 }}>
                When a period has no transactions, show the running account balance instead of an empty state.
              </Text>
            </View>
            <Switch value={prefs.carryOver} onValueChange={(v) => updatePrefs({ carryOver: v })} />
          </View>
        </Card>
      </View>
    </ScrollView>
  );
}
