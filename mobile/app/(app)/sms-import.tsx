import { useEffect, useState } from "react";
import { Linking, Platform, ScrollView, Text, View } from "react-native";
import { format, formatDistanceToNow } from "date-fns";
import { CreditCard, History, MessageSquareText, RefreshCw, ShieldCheck, Wallet } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Account } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { useSmsImport } from "../../src/context/SmsImportContext";
import { getErrorMessage } from "../../src/api/errors";
import { isPerson } from "../../src/lib/lending";
import { Button, Card, CardHeader, Chip, ErrorText, Field, SkeletonRows, SuccessText, Toggle } from "../../src/components/ui";

const HISTORY_OPTIONS: { days: number; label: string }[] = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];
const DAY_MS = 24 * 60 * 60 * 1000;

export default function SmsImport() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canRecord = family.role !== "VIEWER";
  const sms = useSmsImport();
  const { settings } = sms;

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [setupAccountId, setSetupAccountId] = useState<string | null>(null);
  const [historyDays, setHistoryDays] = useState(7);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [enabling, setEnabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<Account[]>(`/families/${family.id}/accounts`)
      .then((res) => {
        if (cancelled) return;
        // Bank alerts land in your own accounts, never on a friend's lend & borrow tab.
        const active = res.data.filter((a) => !a.isArchived && !isPerson(a));
        setAccounts(active);
        setSetupAccountId((current) => current ?? active.find((a) => a.type === "BANK")?.id ?? active[0]?.id ?? null);
      })
      .catch((err) => !cancelled && setLoadError(getErrorMessage(err, "Unable to load accounts")))
      .finally(() => !cancelled && setAccountsLoading(false));
    return () => {
      cancelled = true;
    };
  }, [family.id]);

  async function handleToggle(next: boolean) {
    setPermissionDenied(false);
    if (!next) {
      await sms.disable();
      return;
    }
    if (!setupAccountId) return;
    setEnabling(true);
    try {
      const granted = await sms.enable({ defaultAccountId: setupAccountId });
      if (!granted) setPermissionDenied(true);
    } finally {
      setEnabling(false);
    }
  }

  function mapHint(hint: string, accountId: string | null) {
    const accountMap = { ...settings.accountMap };
    if (accountId) accountMap[hint] = accountId;
    else delete accountMap[hint];
    sms.updateSettings({ accountMap });
  }

  if (!sms.available) {
    return (
      <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Card>
          <CardHeader title="SMS transactions" icon={<MessageSquareText size={16} color={colors.brand600} />} />
          <Text style={{ color: colors.inkMuted, fontSize: 13, lineHeight: 19 }}>
            {Platform.OS === "android"
              ? "This build of the app can't read SMS. Install the latest version from Settings → App updates to use it."
              : "Recording transactions from bank SMS is only available in the Android app."}
          </Text>
        </Card>
      </ScrollView>
    );
  }

  if (sms.isLoading || accountsLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={4} />
      </View>
    );
  }

  const accountName = (id: string | null) => accounts.find((a) => a.id === id)?.name ?? "Default account";
  const lastRun = settings.lastRunAt ? formatDistanceToNow(settings.lastRunAt, { addSuffix: true }) : null;

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card>
        <CardHeader
          title="Record from SMS"
          subtitle="Turn bank, card and UPI alerts on this phone into transactions automatically."
          icon={<MessageSquareText size={16} color={colors.brand600} />}
          action={
            <Toggle
              value={settings.enabled}
              onChange={handleToggle}
              disabled={enabling || !canRecord || (!settings.enabled && !setupAccountId)}
            />
          }
        />
        <ErrorText>{loadError}</ErrorText>
        {!canRecord && (
          <Text style={{ color: colors.inkMuted, fontSize: 13 }}>Viewers can't add transactions. Ask a family admin for member access.</Text>
        )}
        {canRecord && accounts.length === 0 && (
          <Text style={{ color: colors.inkMuted, fontSize: 13 }}>Add an account first — SMS transactions need an account to go into.</Text>
        )}

        {canRecord && !settings.enabled && accounts.length > 0 && (
          <View style={{ gap: 16 }}>
            <Field label="Record into" hint="Only alerts that arrive after you turn this on are recorded. You can import past messages afterwards if you want them.">
              <AccountChips accounts={accounts} selectedId={setupAccountId} onSelect={setSetupAccountId} />
            </Field>
            {permissionDenied && (
              <View style={{ gap: 8 }}>
                <ErrorText>SMS permission was not granted, so nothing can be read.</ErrorText>
                <Button title="Open app settings" variant="secondary" size="sm" onPress={() => Linking.openSettings()} />
              </View>
            )}
          </View>
        )}

        {settings.enabled && (
          <View style={{ gap: 12 }}>
            <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
              {sms.isSyncing
                ? "Scanning messages…"
                : `${lastRun ? `Last scanned ${lastRun}` : "Recording new alerts from now on"} · ${settings.totalImported} recorded so far`}
            </Text>
            {sms.lastResult && !sms.lastResult.error && (
              <SuccessText>
                {sms.lastResult.imported === 0
                  ? "No new transactions found."
                  : `Recorded ${sms.lastResult.imported} new transaction${sms.lastResult.imported === 1 ? "" : "s"}.`}
              </SuccessText>
            )}
            <ErrorText>{sms.lastResult?.error}</ErrorText>
            <Button
              title="Scan now"
              variant="secondary"
              loading={sms.isSyncing}
              icon={<RefreshCw size={16} color={colors.ink} />}
              onPress={() => sms.syncNow()}
            />
          </View>
        )}
      </Card>

      {settings.enabled && canRecord && <PastMessagesCard historyDays={historyDays} onHistoryDaysChange={setHistoryDays} />}

      {settings.enabled && (
        <Card>
          <CardHeader title="Default account" subtitle="Alerts that don't match a mapped card below go here." icon={<Wallet size={16} color={colors.brand600} />} />
          <AccountChips accounts={accounts} selectedId={settings.defaultAccountId} onSelect={(id) => sms.updateSettings({ defaultAccountId: id })} />
        </Card>
      )}

      {settings.enabled && settings.seenHints.length > 0 && (
        <Card>
          <CardHeader
            title="Cards & accounts"
            subtitle="Match the last digits in your alerts to an account, so each spend lands in the right place."
            icon={<CreditCard size={16} color={colors.brand600} />}
          />
          <View style={{ gap: 18 }}>
            {settings.seenHints.map((hint) => {
              const mapped = settings.accountMap[hint] ?? null;
              return (
                <Field key={hint} label={`Ending ${hint} → ${mapped ? accountName(mapped) : `${accountName(settings.defaultAccountId)} (default)`}`}>
                  <AccountChips accounts={accounts} selectedId={mapped} onSelect={(id) => mapHint(hint, id === mapped ? null : id)} />
                </Field>
              );
            })}
          </View>
        </Card>
      )}

      <Card muted>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <ShieldCheck size={16} color={colors.inkMuted} style={{ marginTop: 1 }} />
          <Text style={{ flex: 1, color: colors.inkMuted, fontSize: 12, lineHeight: 18 }}>
            Messages are read on this phone only. Only the amount, payee, date and sender are saved — never the message text. OTPs,
            payment reminders, money requests and offers are ignored. Recorded transactions are tagged "sms" so you can review and edit
            them; recategorising one teaches future alerts from the same payee.
          </Text>
        </View>
      </Card>
    </ScrollView>
  );
}

/** Optional: record alerts that arrived before SMS import was turned on. */
function PastMessagesCard({ historyDays, onHistoryDaysChange }: { historyDays: number; onHistoryDaysChange: (days: number) => void }) {
  const { colors } = useTheme();
  const sms = useSmsImport();
  const { historyFrom, since } = sms.settings;
  const coveredFrom = historyFrom ?? since;
  const result = sms.historyResult;

  // historyFrom 0 = imported by an older version of the app when import was first turned on.
  if (coveredFrom === 0) {
    return (
      <Card>
        <CardHeader title="Past messages" icon={<History size={16} color={colors.brand600} />} />
        <Text style={{ color: colors.inkMuted, fontSize: 13 }}>Past messages were already imported when SMS recording was turned on.</Text>
      </Card>
    );
  }

  const alreadyCovered = Date.now() - historyDays * DAY_MS >= coveredFrom;
  const importedSome = coveredFrom < since;

  return (
    <Card>
      <CardHeader
        title="Past messages"
        subtitle="Optional — also record bank alerts you received before turning this on."
        icon={<History size={16} color={colors.brand600} />}
      />
      <View style={{ gap: 12 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {HISTORY_OPTIONS.map((o) => (
            <Chip key={o.days} label={o.label} selected={historyDays === o.days} onPress={() => onHistoryDaysChange(o.days)} />
          ))}
        </View>
        {importedSome && (
          <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>Imported back to {format(coveredFrom, "d MMM yyyy")}.</Text>
        )}
        {result && !result.error && (
          <SuccessText>
            {`${
              result.imported === 0
                ? "No past transactions found"
                : `Recorded ${result.imported} past transaction${result.imported === 1 ? "" : "s"}`
            }${result.complete ? "." : " — tap Import again to continue further back."}`}
          </SuccessText>
        )}
        <ErrorText>{result?.error}</ErrorText>
        <Button
          title={alreadyCovered ? "Already imported" : `Import past ${historyDays} days`}
          variant="secondary"
          loading={sms.isImportingHistory}
          disabled={alreadyCovered || sms.isSyncing}
          icon={<History size={16} color={colors.ink} />}
          onPress={() => sms.importHistory(historyDays)}
        />
      </View>
    </Card>
  );
}

function AccountChips({ accounts, selectedId, onSelect }: { accounts: Account[]; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {accounts.map((a) => (
        <Chip key={a.id} label={a.name} selected={selectedId === a.id} onPress={() => onSelect(a.id)} />
      ))}
    </ScrollView>
  );
}
