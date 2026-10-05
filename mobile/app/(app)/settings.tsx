import { useEffect, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { Bell, CalendarCog, Coins, RefreshCw, Smartphone, Trash2 } from "lucide-react-native";
import { useRouter } from "expo-router";
import { api } from "../../src/api/client";
import { useAuth } from "../../src/context/AuthContext";
import { usePrefs, type LandingView, type WeekStart } from "../../src/context/PrefsContext";
import { useTheme } from "../../src/context/ThemeContext";
import { useAppUpdate } from "../../src/context/UpdateContext";
import { currentAppVersion } from "../../src/lib/appUpdate";
import { getErrorMessage } from "../../src/api/errors";
import { syncTransactions } from "../../src/lib/transactionStore";
import { href } from "../../src/lib/nav";
import {
  DEFAULT_REMINDER_SETTINGS,
  ensureReminderPermission,
  formatReminderTime,
  loadReminderSettings,
  refreshUncategorizedReminder,
  saveReminderSettings,
  type ReminderSettings,
} from "../../src/lib/uncategorizedReminder";
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

      <ReminderCard />

      <BinCard />
      {isAdmin && <BulkDeleteCard familyId={family.id} />}
      {isAdmin && <ResetDataCard />}

      <AppUpdateCard />
    </ScrollView>
  );
}

const REMINDER_HOURS = [19, 20, 21, 22, 23];

/** The end-of-day "needs a category" notification. */
function ReminderCard() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const family = user!.families[0];
  const [settings, setSettings] = useState<ReminderSettings>(DEFAULT_REMINDER_SETTINGS);
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    loadReminderSettings().then(setSettings);
    ensureReminderPermission().then((granted) => setBlocked(!granted));
  }, []);

  async function update(patch: Partial<ReminderSettings>) {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveReminderSettings(next);
    if (next.enabled) setBlocked(!(await ensureReminderPermission({ ask: true, force: true })));
    await refreshUncategorizedReminder(user!.id, family.id, family.currency);
  }

  return (
    <Card>
      <CardHeader
        title="End-of-day reminder"
        subtitle="A notification when today's transactions still need a category."
        icon={<Bell size={16} color={colors.brand600} />}
        action={<Toggle value={settings.enabled} onChange={(enabled) => update({ enabled })} />}
      />
      <View style={{ gap: 12 }}>
        {settings.enabled && (
          <Field label="Remind me at">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {REMINDER_HOURS.map((hour) => (
                <Chip
                  key={hour}
                  label={formatReminderTime({ hour, minute: 0 })}
                  selected={settings.hour === hour && settings.minute === 0}
                  onPress={() => update({ hour, minute: 0 })}
                />
              ))}
            </View>
          </Field>
        )}
        {settings.enabled && blocked && (
          <ErrorText>Notifications are off for Family Finance. Turn them on in your phone's settings to get this reminder.</ErrorText>
        )}
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
          Only entries you recorded today are counted, and nothing is sent when they're all filed. Payee rules file most SMS
          transactions on their own.
        </Text>
        <Button title="Review uncategorised" variant="secondary" onPress={() => router.push(href("/uncategorized"))} />
      </View>
    </Card>
  );
}

/** Admin-only: clears every transaction and zeroes all balances, keeping accounts and categories. */
function ResetDataCard() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reset() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await api.post<{ transactionsCleared: number }>(`/families/${family.id}/transactions/reset`, { confirm: true });
      await syncTransactions(user!.id, family.id, { force: true });
      setNotice(`Cleared ${res.data.transactionsCleared} transactions and reset balances.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to clear transactions"));
    } finally {
      setBusy(false);
    }
  }

  function confirmReset() {
    Alert.alert(
      "Clear all transactions?",
      "Every transaction is deleted and every account balance goes back to zero. Accounts, categories, budgets, goals and your SMS account mapping are kept. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Clear everything", style: "destructive", onPress: reset },
      ]
    );
  }

  return (
    <Card>
      <CardHeader title="Clear transactions & balances" icon={<Trash2 size={16} color={colors.expense} />} />
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>Start fresh: deletes every transaction and zeroes all balances. Accounts and categories stay.</Text>
        {notice && <SuccessText>{notice}</SuccessText>}
        <ErrorText>{error}</ErrorText>
        <Button title="Clear transactions & balances" variant="danger" loading={busy} onPress={confirmReset} />
      </View>
    </Card>
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

function BulkDeleteCard({ familyId }: { familyId: string }) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function purge() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const payload: Record<string, string> = {};
      if (from) payload.from = new Date(from).toISOString();
      if (to) payload.to = new Date(to).toISOString();
      const res = await api.post<{ deletedCount: number }>(`/families/${familyId}/transactions/bulk-delete`, payload);
      await syncTransactions(user!.id, familyId, { force: true });
      setNotice(`Moved ${res.data.deletedCount} transactions to bin.`);
      setFrom("");
      setTo("");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to purge transactions"));
    } finally {
      setBusy(false);
    }
  }

  function confirmPurge() {
    Alert.alert(
      "Purge transactions?",
      "Move transactions in this date range to the bin. They will be auto-deleted after 30 days.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Move to Bin", style: "destructive", onPress: purge },
      ]
    );
  }

  return (
    <Card>
      <CardHeader title="Purge Transactions" icon={<Trash2 size={16} color={colors.expense} />} />
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>Delete transactions in a date range. They move to the bin and can be restored for 30 days.</Text>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label="From (inclusive)">
              <Input value={from} onChangeText={setFrom} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label="To (exclusive)">
              <Input value={to} onChangeText={setTo} placeholder="YYYY-MM-DD" autoCapitalize="none" />
            </Field>
          </View>
        </View>
        {notice && <SuccessText>{notice}</SuccessText>}
        <ErrorText>{error}</ErrorText>
        <Button title="Delete to Bin" variant="danger" disabled={busy || (!from && !to)} onPress={confirmPurge} />
      </View>
    </Card>
  );
}

import { Link } from "expo-router";

function BinCard() {
  const { colors } = useTheme();
  return (
    <Card>
      <CardHeader
        title="Recycle Bin"
        icon={<Trash2 size={16} color={colors.ink} />}
        action={
          <Link href={"/bin" as any} asChild>
            <Button variant="secondary" title="Open Bin" />
          </Link>
        }
      />
      <View style={{ gap: 12 }}>
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>View and restore recently deleted transactions.</Text>
      </View>
    </Card>
  );
}
