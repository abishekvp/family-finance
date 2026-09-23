import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { CalendarCog, Coins, RefreshCw, Smartphone } from "lucide-react-native";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { usePrefs, type LandingView, type WeekStart } from "../../src/context/PrefsContext";
import { useTheme } from "../../src/context/ThemeContext";
import { useAppUpdate } from "../../src/context/UpdateContext";
import { currentAppVersion } from "../../src/lib/appUpdate";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, CardHeader, Chip, ErrorText, Field, Input, SuccessText, Toggle } from "../../src/components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

export default function Settings() {
  const { user, refreshUser } = useAuth();
  const { colors } = useTheme();
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
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card>
        <CardHeader title="Family currency" icon={<Coins size={16} color={colors.brand600} />} />
        {!isAdmin ? (
          <Text style={{ color: colors.inkMuted, fontSize: 13 }}>Currency is {currency}. Only a family admin can change it.</Text>
        ) : (
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {CURRENCIES.map((c) => (
                <Chip key={c} label={c} selected={currency === c} onPress={() => handleSaveCurrency(c)} />
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1 }}>
                <Input value={customCurrency} onChangeText={setCustomCurrency} placeholder="Other (e.g. JPY)" autoCapitalize="characters" maxLength={3} />
              </View>
              <Button title="Save" variant="secondary" loading={savingCurrency} disabled={customCurrency.trim().length !== 3} onPress={() => handleSaveCurrency(customCurrency)} />
            </View>
            {currencySaved && <SuccessText>Currency updated.</SuccessText>}
            <ErrorText>{currencyError}</ErrorText>
          </View>
        )}
      </Card>

      <Card>
        <CardHeader title="Transactions hub" icon={<CalendarCog size={16} color={colors.brand600} />} />
        <View style={{ gap: 18 }}>
          <Field label="Default landing view">
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["daily", "calendar"] as LandingView[]).map((v) => (
                <Chip key={v} label={v === "daily" ? "Daily" : "Calendar"} selected={prefs.landingView === v} onPress={() => updatePrefs({ landingView: v })} />
              ))}
            </View>
          </Field>

          <Field label="Week starts on">
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["sunday", "monday"] as WeekStart[]).map((v) => (
                <Chip key={v} label={v === "sunday" ? "Sunday" : "Monday"} selected={prefs.weekStart === v} onPress={() => updatePrefs({ weekStart: v })} />
              ))}
            </View>
          </Field>

          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 4 }}>Carry-over balances</Text>
              <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
                When a period has no transactions, show the running account balance instead of an empty state.
              </Text>
            </View>
            <Toggle value={prefs.carryOver} onChange={(v) => updatePrefs({ carryOver: v })} />
          </View>
        </View>
      </Card>

      <AppUpdateCard />
    </ScrollView>
  );
}

function AppUpdateCard() {
  const { colors } = useTheme();
  const { status, release, error, checkForUpdates, install } = useAppUpdate();

  const statusText =
    status === "checking"
      ? "Checking for updates…"
      : status === "upToDate"
        ? "You're on the latest version."
        : release
          ? `Version ${release.version} is available.`
          : null;

  return (
    <Card>
      <CardHeader title="App updates" icon={<Smartphone size={16} color={colors.brand600} />} />
      <View style={{ gap: 12 }}>
        <View>
          <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 4 }}>Installed version {currentAppVersion()}</Text>
          {statusText && <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>{statusText}</Text>}
        </View>
        <ErrorText>{error}</ErrorText>
        {release ? (
          <Button title={status === "downloading" ? "Downloading" : "Update now"} loading={status === "downloading"} onPress={install} />
        ) : (
          <Button
            title="Check for updates"
            variant="secondary"
            loading={status === "checking"}
            icon={<RefreshCw size={16} color={colors.ink} />}
            onPress={() => checkForUpdates({ manual: true })}
          />
        )}
      </View>
    </Card>
  );
}
