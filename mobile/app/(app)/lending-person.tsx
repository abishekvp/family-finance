import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowDownLeft, ArrowUpRight, Ban, CheckCircle2, Pencil, Plus, ShoppingBag, Trash2, Undo2, Users } from "lucide-react-native";
import { api } from "../../src/api/client";
import { ClientError } from "../../src/api/errors";
import { encryptOutgoing, hasFamilyKey } from "../../src/api/vaultSession";
import type { Account, Category, Transaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Avatar, Badge, Button, Card, Chip, ErrorText, Field, Input, ProgressBar, Sheet, SkeletonRows, Toggle } from "../../src/components/ui";
import { DateField, TimeField } from "../../src/components/DateTimeField";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { fetchWithCache } from "../../src/lib/cache";
import { combineDateTime, localDateInput, localTimeInput } from "../../src/lib/dateUtils";
import { formatCurrency } from "../../src/lib/format";
import { href } from "../../src/lib/nav";
import {
  describeBalance,
  describeEntry,
  isPerson,
  isSettled,
  isWriteOff,
  loanStatus,
  trackLoans,
  withNameInNotes,
  writeOffPayload,
  type LendingKind,
  type Loan,
} from "../../src/lib/lending";
import { refreshTodayWidget } from "../../src/lib/todayWidget";
import { syncTransactions, useTransactions } from "../../src/lib/transactionStore";
import { LOCKED_PLACEHOLDER } from "../../src/lib/vaultCrypto";

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function LendingPerson() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const canRecord = family.role !== "VIEWER";
  const router = useRouter();
  const navigation = useNavigation();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const person = accounts.find((a) => a.id === id) ?? null;
  const historyFilter = useMemo(() => ({ accountId: id }), [id]);
  const { transactions: history, ready: historyReady, sync } = useTransactions(user!.id, family.id, historyFilter);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const isLoading = !accountsLoaded || !historyReady;
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [writingOff, setWritingOff] = useState<Loan | null>(null);

  const load = useCallback(async () => {
    try {
      const [accountsRes] = await Promise.all([
        api.get<Account[]>(`/families/${family.id}/accounts`),
        sync(),
        fetchWithCache<Category[]>(`/families/${family.id}/categories`, undefined, (cached) => setCategories(cached.data)).then(
          (res) => setCategories(res.data),
          () => undefined
        ),
      ]);
      setAccounts(accountsRes.data);
      setError(accountsRes.data.some((a) => a.id === id) ? null : "This person was removed.");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load"));
    } finally {
      setAccountsLoaded(true);
    }
  }, [family.id, id, sync]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useLayoutEffect(() => {
    navigation.setOptions({ title: person?.name ?? "Lend & borrow" });
  }, [navigation, person?.name]);

  const loans = useMemo(() => (person ? trackLoans(history, person) : []), [history, person]);
  const openLoans = loans.filter((l) => !l.settled);
  const returnedLoans = loans.filter((l) => l.settled);
  // A shared person is the family's: only an admin manages them. A personal one, only its owner.
  const canManage = !!person && canRecord && (person.owner === null ? family.role === "ADMIN" : person.owner.id === user!.id);

  function record(kind: LendingKind, amount?: number, repaysId?: string) {
    router.push(
      href("/transaction-form", {
        type: "LENDING",
        kind,
        personId: id,
        ...(amount ? { amount: String(Number(amount.toFixed(2))) } : {}),
        ...(repaysId ? { repaysId } : {}),
      })
    );
  }

  function openTransaction(t: Transaction) {
    router.push(href("/transaction-form", { id: t.id, transaction: JSON.stringify(t) }));
  }

  /**
   * Takes a loan's write-offs back (to the bin, where they can still be restored): the money counts as
   * owed again. Write-offs matched to it automatically go too, so the loan is whole again.
   */
  async function cancelWriteOff(loan: Loan) {
    setError(null);
    try {
      const writeOffs = Array.from(new Set(loan.repayments.filter((r) => r.writtenOff).map((r) => r.transaction.id)));
      for (const writeOffId of writeOffs) await api.delete(`/families/${family.id}/transactions/${writeOffId}`);
      await Promise.all([afterChange(), load()]);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to cancel the write-off"));
      await afterChange();
    }
  }

  /** After money was written off, merged or deleted: everything showing balances catches up. */
  async function afterChange() {
    await syncTransactions(user!.id, family.id, { force: true }).catch(() => undefined);
    refreshTodayWidget(family.id, family.currency);
  }

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <SkeletonRows rows={5} />
      </View>
    );
  }

  if (!person) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.canvas, padding: 16 }}>
        <ErrorText>{error}</ErrorText>
      </View>
    );
  }

  const balance = person.balance;
  const settled = isSettled(balance);
  const theyOwe = balance > 0;
  const overdue = openLoans.filter((l) => l.overdue).reduce((sum, l) => sum + l.remaining, 0);

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <Card style={{ alignItems: "center", gap: 10, paddingVertical: 22 }}>
        <Avatar name={person.name} size={52} />
        <Text
          style={{
            fontSize: 19,
            fontWeight: "800",
            textAlign: "center",
            color: settled ? colors.inkMuted : theyOwe ? colors.income : colors.expense,
          }}
        >
          {describeBalance(person.name, balance, person.currency)}
        </Text>
        {overdue > 0 && (
          // Badge aligns itself to the start; the wrapper keeps it centred in the card.
          <View>
            <Badge tone="expense">{`${formatCurrency(overdue, person.currency)} overdue`}</Badge>
          </View>
        )}
        {!person.owner && <Text style={{ fontSize: 12, color: colors.inkSubtle }}>Shared with your family</Text>}
      </Card>

      <ErrorText>{error}</ErrorText>

      {canRecord && (
        <View style={{ gap: 10 }}>
          {settled ? (
            <ButtonPair
              primary={{ title: "Lend", icon: "out", onPress: () => record("lent") }}
              secondary={{ title: "Borrow", icon: "in", onPress: () => record("borrowed") }}
            />
          ) : theyOwe ? (
            <ButtonPair
              primary={{ title: "Got paid back", icon: "in", onPress: () => record("got-back", balance) }}
              secondary={{ title: "Lend more", icon: "out", onPress: () => record("lent") }}
            />
          ) : (
            <ButtonPair
              primary={{ title: "Pay back", icon: "out", onPress: () => record("paid-back", -balance) }}
              secondary={{ title: "Borrow more", icon: "in", onPress: () => record("borrowed") }}
            />
          )}
          <Button
            title={`${person.name} paid for something`}
            variant="ghost"
            icon={<ShoppingBag size={16} color={colors.ink} />}
            onPress={() => router.push(href("/transaction-form", { type: "EXPENSE", accountId: person.id }))}
          />
        </View>
      )}

      {openLoans.length > 0 && (
        <Section title="Waiting to be returned">
          <Card style={{ padding: 0 }}>
            {openLoans.map((loan, i) => (
              <LoanRow
                key={i}
                loan={loan}
                currency={person.currency}
                first={i === 0}
                onPress={loan.transaction ? () => openTransaction(loan.transaction!) : undefined}
                onOpenRepayment={openTransaction}
                onRecordReturn={
                  canRecord
                    ? () => record(loan.direction === "lent" ? "got-back" : "paid-back", loan.remaining, loan.transaction?.id)
                    : undefined
                }
                onWriteOff={canRecord ? () => setWritingOff(loan) : undefined}
                onCancelWriteOff={canRecord && loan.writtenOff > 0 ? () => cancelWriteOff(loan) : undefined}
              />
            ))}
          </Card>
        </Section>
      )}

      {returnedLoans.length > 0 && (
        <Section title="Closed">
          <Card style={{ padding: 0 }}>
            {returnedLoans.map((loan, i) => (
              <LoanRow
                key={i}
                loan={loan}
                currency={person.currency}
                first={i === 0}
                onPress={loan.transaction ? () => openTransaction(loan.transaction!) : undefined}
                onOpenRepayment={openTransaction}
                onCancelWriteOff={canRecord && loan.writtenOff > 0 ? () => cancelWriteOff(loan) : undefined}
              />
            ))}
          </Card>
        </Section>
      )}

      <Section title="History">
        {history.length === 0 ? (
          <Text style={{ color: colors.inkSubtle, fontSize: 13, paddingHorizontal: 2 }}>Nothing recorded yet.</Text>
        ) : (
          <Card style={{ padding: 0 }}>
            {history.map((t, i) => (
              <HistoryRow
                key={t.id}
                transaction={t}
                personId={person.id}
                repays={t.repaysId ? history.find((h) => h.id === t.repaysId) ?? null : null}
                first={i === 0}
                onPress={() => openTransaction(t)}
              />
            ))}
          </Card>
        )}
      </Section>

      {canManage && (
        <View style={{ gap: 10, marginTop: 8 }}>
          <Button title="Edit" variant="secondary" icon={<Pencil size={15} color={colors.ink} />} onPress={() => setEditing(true)} />
          <Button title="Delete person" variant="ghost" icon={<Trash2 size={15} color={colors.expense} />} onPress={() => setDeleting(true)} />
        </View>
      )}

      <EditPersonSheet
        visible={editing}
        familyId={family.id}
        person={person}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          load();
        }}
      />

      {writingOff && (
        <WriteOffSheet
          familyId={family.id}
          person={person}
          loan={writingOff}
          categories={categories}
          onClose={() => setWritingOff(null)}
          onSaved={async () => {
            setWritingOff(null);
            await afterChange();
            load();
          }}
        />
      )}

      {deleting && (
        <DeletePersonSheet
          familyId={family.id}
          encrypted={family.encryptionEnabled}
          person={person}
          people={accounts.filter((a) => isPerson(a) && a.id !== person.id)}
          history={history}
          onClose={() => setDeleting(false)}
          onDone={async (movedTo) => {
            setDeleting(false);
            await afterChange();
            if (movedTo) router.replace(href("/lending-person", { id: movedTo }));
            else router.back();
          }}
        />
      )}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 12, fontWeight: "800", color: colors.inkSubtle, textTransform: "uppercase", paddingHorizontal: 2 }}>{title}</Text>
      {children}
    </View>
  );
}

type PairButton = { title: string; icon: "in" | "out"; onPress: () => void };

function ButtonPair({ primary, secondary }: { primary: PairButton; secondary: PairButton }) {
  const { colors } = useTheme();
  const icon = (dir: "in" | "out", color: string) =>
    dir === "out" ? <ArrowUpRight size={16} color={color} /> : <ArrowDownLeft size={16} color={color} />;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Button title={primary.title} icon={icon(primary.icon, colors.white)} onPress={primary.onPress} />
      </View>
      <View style={{ flex: 1 }}>
        <Button title={secondary.title} variant="secondary" icon={icon(secondary.icon, colors.ink)} onPress={secondary.onPress} />
      </View>
    </View>
  );
}

/** One loan, how much of it has come back (or was written off) and which entries closed it. */
function LoanRow({
  loan,
  currency,
  first,
  onPress,
  onOpenRepayment,
  onRecordReturn,
  onWriteOff,
  onCancelWriteOff,
}: {
  loan: Loan;
  currency: string;
  first: boolean;
  onPress?: () => void;
  onOpenRepayment: (t: Transaction) => void;
  onRecordReturn?: () => void;
  onWriteOff?: () => void;
  /** For a loan (partly) written off: takes that back, so it's owed again. */
  onCancelWriteOff?: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [cancelling, setCancelling] = useState(false);
  const lent = loan.direction === "lent";
  const title = loan.transaction
    ? `${lent ? "You lent" : "You borrowed"} ${formatCurrency(loan.amount, currency)}`
    : `${lent ? "They owed you" : "You owed"} ${formatCurrency(loan.amount, currency)} to start`;
  const detail = [formatDay(loan.date), loan.transaction?.category?.name, loan.transaction?.notes].filter(Boolean).join(" · ");
  const closedByWriteOff = loan.settled && loan.writtenOff > 0 && loan.returned === 0;

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [
        { padding: 14, gap: 8, borderTopWidth: first ? 0 : 1, borderTopColor: colors.line },
        pressed && { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {closedByWriteOff ? (
          <Ban size={18} color={colors.inkMuted} />
        ) : loan.settled ? (
          <CheckCircle2 size={18} color={colors.income} />
        ) : lent ? (
          <ArrowUpRight size={18} color={colors.inkMuted} />
        ) : (
          <ArrowDownLeft size={18} color={colors.inkMuted} />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>
      {!loan.settled && <ProgressBar value={(loan.returned + loan.writtenOff) / loan.amount} tone={lent ? "income" : "expense"} />}
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: 12, color: loan.settled && !closedByWriteOff ? colors.income : colors.inkMuted, fontWeight: "600" }}>
          {loanStatus(loan, currency)}
        </Text>
        {!loan.settled && loan.dueDate && (
          <Text style={{ fontSize: 12, fontWeight: "700", color: loan.overdue ? colors.expense : colors.inkMuted }}>
            {loan.overdue ? `Overdue since ${formatDay(loan.dueDate)}` : `Return by ${formatDay(loan.dueDate)}`}
          </Text>
        )}
      </View>
      {loan.repayments.length > 0 && (
        <View style={{ gap: 6, paddingLeft: 28 }}>
          {loan.repayments.map((r, i) => (
            <Pressable key={`${r.transaction.id}-${i}`} onPress={() => onOpenRepayment(r.transaction)} hitSlop={4} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {r.writtenOff ? <Ban size={13} color={colors.inkSubtle} /> : <Undo2 size={13} color={colors.inkSubtle} />}
              <Text style={{ flex: 1, fontSize: 12, color: colors.inkMuted }} numberOfLines={1}>
                {`${formatCurrency(r.amount, currency)} ${r.writtenOff ? "written off" : "returned"} ${formatDay(new Date(r.transaction.date))}`}
                {r.transaction.repaysId === loan.transaction?.id ? "" : " · matched automatically"}
              </Text>
            </Pressable>
          ))}
        </View>
      )}
      {(((onRecordReturn || onWriteOff) && !loan.settled) || onCancelWriteOff) && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 18, paddingLeft: 28 }}>
          {onRecordReturn && !loan.settled && (
            <Pressable onPress={onRecordReturn} hitSlop={6}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.brand600 }}>{lent ? "Record money got back" : "Record paying back"}</Text>
            </Pressable>
          )}
          {onWriteOff && !loan.settled && (
            <Pressable onPress={onWriteOff} hitSlop={6}>
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.inkMuted }}>{lent ? "Won't be returned" : "No need to repay"}</Text>
            </Pressable>
          )}
          {onCancelWriteOff && (
            <Pressable
              disabled={cancelling}
              hitSlop={6}
              onPress={async () => {
                setCancelling(true);
                await onCancelWriteOff();
                setCancelling(false);
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: "700", color: colors.inkMuted, opacity: cancelling ? 0.5 : 1 }}>
                {cancelling ? "Cancelling…" : "Cancel write-off"}
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

function HistoryRow({
  transaction,
  personId,
  repays,
  first,
  onPress,
}: {
  transaction: Transaction;
  personId: string;
  /** The loan this entry pays back (or writes off), when it was linked to one. */
  repays: Transaction | null;
  first: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { effect, label, detail } = describeEntry(transaction, personId);
  const writtenOff = isWriteOff(transaction);
  const Icon = writtenOff
    ? Ban
    : transaction.type === "EXPENSE"
      ? ShoppingBag
      : transaction.type === "TRANSFER" && transaction.transferToAccountId === personId
        ? ArrowUpRight
        : ArrowDownLeft;
  const date = formatDay(new Date(transaction.date));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderTopWidth: first ? 0 : 1, borderTopColor: colors.line },
        pressed && { backgroundColor: colors.surfaceSunken },
      ]}
    >
      <View style={{ width: 36, height: 36, borderRadius: 11, backgroundColor: colors.surfaceSunken, alignItems: "center", justifyContent: "center" }}>
        <Icon size={16} color={colors.inkMuted} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: "700", color: colors.ink }} numberOfLines={1}>
          {label}
        </Text>
        <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }} numberOfLines={1}>
          {[date, transaction.category?.name, detail].filter(Boolean).join(" · ")}
        </Text>
        {repays ? (
          <Text style={{ fontSize: 12, color: colors.brand600, marginTop: 2 }} numberOfLines={1}>
            {`${writtenOff ? "Writes off" : "Pays back"} “${repays.payee || "loan"}” · ${formatDay(new Date(repays.date))}`}
          </Text>
        ) : null}
        {transaction.notes ? (
          <Text style={{ fontSize: 12, color: colors.inkMuted, marginTop: 2 }} numberOfLines={2}>
            {transaction.notes}
          </Text>
        ) : null}
      </View>
      {/* Signed by what it did to the tab: + they owe you more (or you owe less), − the reverse. */}
      <Text style={{ fontWeight: "800", fontVariant: ["tabular-nums"], color: effect > 0 ? colors.income : colors.expense }}>
        {`${effect > 0 ? "+" : "−"}${formatCurrency(Math.abs(effect), transaction.account.currency)}`}
      </Text>
    </Pressable>
  );
}

/** Rename, and share with (or keep from) the family. */
function EditPersonSheet({
  visible,
  familyId,
  person,
  onClose,
  onSaved,
}: {
  visible: boolean;
  familyId: string;
  person: Account;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const [name, setName] = useState(person.name);
  const [shared, setShared] = useState(person.owner === null);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const changed = name.trim() !== person.name || shared !== (person.owner === null);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.patch(`/families/${familyId}/accounts/${person.id}`, {
        name: name.trim(),
        ...(shared !== (person.owner === null) ? { isCommon: shared } : {}),
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Edit person"
      footer={<Button title="Save" loading={isSaving} disabled={!name.trim() || !changed} onPress={handleSave} />}
    >
      <View style={{ gap: 16 }}>
        <Field label="Name">
          <Input value={name} onChangeText={setName} autoCapitalize="words" />
        </Field>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Share with family</Text>
            <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
              {shared ? "Everyone in the family sees them and what's owed." : "Only you see them and what's owed."}
            </Text>
          </View>
          <Toggle value={shared} onChange={setShared} />
        </View>
        <ErrorText>{error}</ErrorText>
      </View>
    </Sheet>
  );
}

/** Closes (part of) a loan as money that won't come back. */
function WriteOffSheet({
  familyId,
  person,
  loan,
  categories,
  onClose,
  onSaved,
}: {
  familyId: string;
  person: Account;
  loan: Loan;
  categories: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { colors } = useTheme();
  const lent = loan.direction === "lent";
  const [amount, setAmount] = useState(String(Number(loan.remaining.toFixed(2))));
  const [date, setDate] = useState(() => localDateInput(new Date()));
  const [time, setTime] = useState(() => localTimeInput(new Date()));
  const [counted, setCounted] = useState(false);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const amountValue = Number(amount);
  const when = combineDateTime(date, time);
  const tooMuch = amountValue > loan.remaining + 0.005;

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      await api.post(
        `/families/${familyId}/transactions`,
        writeOffPayload({ person, loan, amount: amountValue, date: when!.toISOString(), counted, categoryId, notes })
      );
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to write it off"));
      setIsSaving(false);
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={lent ? "Won't be returned" : "No need to repay"}
      footer={
        <Button
          title={`Write off ${amountValue > 0 ? formatCurrency(amountValue, person.currency) : ""}`.trim()}
          variant="danger"
          loading={isSaving}
          disabled={!(amountValue > 0) || tooMuch || !when}
          onPress={handleSave}
        />
      }
    >
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
        <Text style={{ fontSize: 13, color: colors.inkMuted, lineHeight: 19 }}>
          {lent
            ? `${person.name} won't owe you this any more. Your accounts don't change — the money already left them when you lent it.`
            : `You won't owe ${person.name} this any more. Your accounts don't change — the money already came in when you borrowed it.`}
        </Text>
        <Field label="Amount" error={tooMuch ? `Only ${formatCurrency(loan.remaining, person.currency)} is left on this loan` : null}>
          <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        </Field>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={{ flex: 4 }}>
            <Field label="Date">
              <DateField value={date} onChange={setDate} />
            </Field>
          </View>
          <View style={{ flex: 3 }}>
            <Field label="Time">
              <TimeField value={time} onChange={setTime} />
            </Field>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>{lent ? "Count it as spending" : "Count it as income"}</Text>
            <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
              {counted
                ? lent
                  ? "Shows up as an expense on this date, in the category you pick."
                  : "Shows up as income on this date, in the category you pick."
                : "Off: kept out of income, spending and budgets."}
            </Text>
          </View>
          <Toggle value={counted} onChange={setCounted} />
        </View>
        {counted && (
          <Field label="Category" hint="Optional">
            <CategoryPicker
              categories={categories.filter((c) => c.type === (lent ? "EXPENSE" : "INCOME"))}
              selectedId={categoryId}
              onSelect={setCategoryId}
              clearLabel="No category"
            />
          </Field>
        )}
        <Field label="Notes" hint="Optional">
          <Input value={notes} onChangeText={setNotes} placeholder="Why it won't come back" />
        </Field>
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </Sheet>
  );
}

/**
 * Deletes a person: their entries either move to someone else (or a new group like "Friends"),
 * each keeping the name in its notes, or go to the bin with them.
 */
function DeletePersonSheet({
  familyId,
  encrypted,
  person,
  people,
  history,
  onClose,
  onDone,
}: {
  familyId: string;
  encrypted: boolean;
  person: Account;
  people: Account[];
  history: Transaction[];
  onClose: () => void;
  /** With the person their entries moved to, if they moved. */
  onDone: (movedTo: string | null) => void;
}) {
  const { colors } = useTheme();
  const shared = person.owner === null;
  // A shared person's entries are the family's, so they can only move to someone shared too.
  const targets = people.filter((p) => !shared || p.owner === null);
  const count = history.length;
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [targetId, setTargetId] = useState<string | "new">(() => targets.find((p) => /^friends?$/i.test(p.name))?.id ?? "new");
  const [groupName, setGroupName] = useState("Friends");
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const target = targetId === "new" ? null : targets.find((p) => p.id === targetId) ?? null;
  const canSubmit = count === 0 || mode === "delete" || !!target || (targetId === "new" && groupName.trim().length > 0);

  /** For an end-to-end encrypted family the server can't write the name into notes; this device does. */
  function sealedNotes() {
    if (!encrypted) return undefined;
    if (!hasFamilyKey(familyId)) throw new ClientError("Unlock your vault with your master password first, so their notes can keep the name.");
    return history
      .filter((t) => t.notes !== LOCKED_PLACEHOLDER)
      .map((t) => ({ id: t.id, notes: encryptOutgoing(familyId, { notes: withNameInNotes(person.name, t.notes) }).notes as string }));
  }

  async function handleConfirm() {
    setError(null);
    setIsWorking(true);
    try {
      if (count > 0 && mode === "move") {
        const res = await api.post<Account>(`/families/${familyId}/accounts/${person.id}/merge`, {
          ...(target ? { targetId: target.id } : { newTarget: { name: groupName.trim(), isCommon: shared } }),
          notes: sealedNotes(),
        });
        onDone(res.data.id);
      } else {
        await api.delete(`/families/${familyId}/accounts/${person.id}`, { params: count > 0 ? { entries: "delete" } : undefined });
        onDone(null);
      }
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete"));
      setIsWorking(false);
    }
  }

  return (
    <Sheet
      visible
      onClose={onClose}
      title={`Delete ${person.name}`}
      footer={
        <Button
          title={count > 0 && mode === "move" ? `Move entries & delete ${person.name}` : `Delete ${person.name}`}
          variant="danger"
          loading={isWorking}
          disabled={!canSubmit}
          onPress={handleConfirm}
        />
      }
    >
      <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 14, paddingBottom: 4 }}>
        {count === 0 ? (
          <Text style={{ fontSize: 13, color: colors.inkMuted, lineHeight: 19 }}>{`Nothing is recorded with ${person.name}, so they're simply removed.`}</Text>
        ) : (
          <>
            <Text style={{ fontSize: 13, color: colors.inkMuted, lineHeight: 19 }}>
              {`${count} ${count === 1 ? "entry is" : "entries are"} recorded with ${person.name}. What should happen to ${count === 1 ? "it" : "them"}?`}
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip label="Move to someone else" icon={<Users size={13} color={mode === "move" ? colors.white : colors.inkMuted} />} selected={mode === "move"} onPress={() => setMode("move")} />
              <Chip label="Delete them too" icon={<Trash2 size={13} color={mode === "delete" ? colors.white : colors.inkMuted} />} selected={mode === "delete"} onPress={() => setMode("delete")} color={colors.expense} />
            </View>
            {mode === "move" ? (
              <View style={{ gap: 12 }}>
                <Field label="Move to">
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {targets.map((p) => (
                      <Chip key={p.id} label={p.name} selected={targetId === p.id} onPress={() => setTargetId(p.id)} />
                    ))}
                    <Chip label="New group" icon={<Plus size={13} color={targetId === "new" ? colors.white : colors.inkMuted} />} selected={targetId === "new"} onPress={() => setTargetId("new")} />
                  </View>
                </Field>
                {targetId === "new" && (
                  <Field label="Group name" hint={shared ? "Shared with the family, like them." : undefined}>
                    <Input value={groupName} onChangeText={setGroupName} autoCapitalize="words" placeholder="Friends" />
                  </Field>
                )}
                <Text style={{ fontSize: 12, color: colors.inkSubtle, lineHeight: 17 }}>
                  {`Every entry moves to ${target?.name ?? (groupName.trim() || "the group")} with “${person.name}” written in its notes, and what's owed moves with them. Your account balances don't change.`}
                </Text>
              </View>
            ) : (
              <Text style={{ fontSize: 12, color: colors.expense, lineHeight: 17 }}>
                {`Their entries go to the bin and your account balances change back as if they never happened. Restoring one from the bin brings ${person.name} back.`}
              </Text>
            )}
          </>
        )}
        <ErrorText>{error}</ErrorText>
      </ScrollView>
    </Sheet>
  );
}
