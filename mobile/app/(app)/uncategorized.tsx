import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Check, Home, Inbox, Sparkles, Wand2 } from "lucide-react-native";
import type { Category, PayeeRule, Transaction } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { fetchWithCache } from "../../src/lib/cache";
import { href } from "../../src/lib/nav";
import { useTransactions } from "../../src/lib/transactionStore";
import {
  applyMatches,
  categorizable,
  createPayeeRule,
  describeTarget,
  fetchPayeeRules,
  findRule,
  isUncategorized,
  learnMappings,
  matchCategory,
  normalizePayee,
  seriesKey,
  type PayeeTarget,
} from "../../src/lib/payeeRules";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { TransactionRow } from "../../src/components/transactions/TransactionRow";
import { Button, Card, CardHeader, Chip, EmptyState, ErrorText, SkeletonRows, SuccessText } from "../../src/components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;
// Old enough entries were probably left alone on purpose; the reminder is about recent ones.
const LOOKBACK_DAYS = 90;
const MAX_SHOWN = 60;

/** Just filed by hand: offered as a rule so the next one from this payee files itself. */
interface Offer {
  payee: string;
  type: "INCOME" | "EXPENSE";
  target: PayeeTarget;
}

export default function Uncategorized() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const family = user!.families[0];
  const isAdmin = family.role === "ADMIN";
  const canEdit = family.role !== "VIEWER";

  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [offer, setOffer] = useState<Offer | null>(null);

  const load = useCallback(async () => {
    try {
      const [rulesRes, categoriesRes] = await Promise.all([
        fetchPayeeRules(family.id, setRules),
        fetchWithCache<Category[]>(`/families/${family.id}/categories`, undefined, (cached) => setCategories(cached.data)),
      ]);
      setRules(rulesRes);
      setCategories(categoriesRes.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load categories"));
    }
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const filter = useMemo(() => ({ from: new Date(Date.now() - 365 * DAY_MS) }), []);
  const { transactions: history, ready, sync } = useTransactions(user!.id, family.id, filter);
  useEffect(() => {
    sync({ force: true });
  }, [sync]);
  const learned = useMemo(() => learnMappings(history, categories), [history, categories]);

  // Only entries this member may change: their own, or anyone's for an admin.
  const pending = useMemo(() => {
    const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS).toISOString();
    return history.filter((t) => t.date >= since && isUncategorized(t) && (isAdmin || t.userId === user!.id));
  }, [history, isAdmin, user]);
  const suggested = useMemo(() => categorizable(pending, rules, learned), [pending, rules, learned]);

  async function file(t: Transaction, target: PayeeTarget, { offerRule = true } = {}) {
    setError(null);
    setNotice(null);
    setBusyId(t.id);
    try {
      await applyMatches(family.id, [{ transaction: t, match: target }]);
      const type = t.type as "INCOME" | "EXPENSE";
      const pattern = t.payee ? seriesKey(t.payee) || normalizePayee(t.payee) : "";
      const rule = t.payee ? findRule(rules, t.payee, type) : null;
      const covered = rule && rule.categoryId === target.categoryId && rule.familyTransfer === target.familyTransfer;
      setOffer(offerRule && canEdit && pattern.length >= 2 && !covered ? { payee: pattern, type, target } : null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update the transaction"));
    } finally {
      setBusyId(null);
    }
  }

  async function keepOffer() {
    if (!offer) return;
    setError(null);
    try {
      const saved = await createPayeeRule(family.id, { payee: offer.payee, type: offer.type, categoryId: offer.target.categoryId, familyTransfer: offer.target.familyTransfer });
      setRules((list) => [...list, saved]);
      setNotice(`Saved: “${saved.payee}” → ${describeTarget(saved)}. Later ones file themselves.`);
      setOffer(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the rule"));
    }
  }

  async function applyAll() {
    setError(null);
    setNotice(null);
    setOffer(null);
    setApplying(true);
    try {
      const saved = await applyMatches(family.id, suggested);
      setNotice(`Filed ${saved} transaction${saved === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update transactions"));
    } finally {
      setApplying(false);
    }
  }

  const shown = pending.slice(0, MAX_SHOWN);

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
      <Card>
        <CardHeader
          title={pending.length === 0 ? "All sorted" : `${pending.length} to sort out`}
          subtitle={`Expenses and income from the last ${LOOKBACK_DAYS} days with no category.`}
          icon={<Inbox size={16} color={colors.brand600} />}
          action={<Button title="Rules" size="sm" variant="secondary" icon={<Wand2 size={14} color={colors.ink} />} onPress={() => router.push(href("/payee-rules"))} />}
        />
        {canEdit && suggested.length > 0 && (
          <Button
            title={`File ${suggested.length} with suggestions`}
            variant="secondary"
            loading={applying}
            icon={<Sparkles size={16} color={colors.ink} />}
            onPress={applyAll}
          />
        )}
        {!canEdit && <Text style={{ color: colors.inkMuted, fontSize: 13 }}>Viewers can't change transactions.</Text>}
      </Card>

      {notice && <SuccessText>{notice}</SuccessText>}
      <ErrorText>{error}</ErrorText>

      {offer && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
            {`Always file “${offer.payee}” ${offer.type === "INCOME" ? "income" : "expenses"} as ${describeTarget(offer.target)}?`}
          </Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Remember" size="sm" onPress={keepOffer} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Not now" size="sm" variant="secondary" onPress={() => setOffer(null)} />
            </View>
          </View>
        </Card>
      )}

      {!ready ? (
        <SkeletonRows rows={4} />
      ) : pending.length === 0 ? (
        <EmptyState title="Nothing to sort out" description="Every recent expense and income has a category." icon={<Check size={22} color={colors.income} />} />
      ) : (
        shown.map((t) => {
          const match = matchCategory(t.payee, t.type, rules, learned);
          const matchCategoryLive = match?.categoryId ? categories.some((c) => c.id === match.categoryId) : true;
          return (
            <Card key={t.id} style={{ paddingVertical: 6, gap: 8, opacity: busyId === t.id ? 0.5 : 1 }}>
              <TransactionRow transaction={t} onPress={() => router.push(href("/transaction-form", { id: t.id, transaction: JSON.stringify(t) }))} />
              {canEdit && (
                <View style={{ gap: 8, paddingBottom: 8 }}>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                    {match && matchCategoryLive && (
                      <Chip
                        label={describeTarget(match)}
                        color={match.category?.color}
                        icon={<Sparkles size={13} color={colors.brand600} />}
                        onPress={() => file(t, match, { offerRule: match.source !== "rule" })}
                      />
                    )}
                    <Chip
                      label={t.type === "INCOME" ? "From family" : "To family"}
                      icon={<Home size={13} color={colors.brand600} />}
                      onPress={() => file(t, { categoryId: null, category: null, familyTransfer: true })}
                    />
                  </View>
                  <CategoryPicker
                    categories={categories.filter((c) => c.type === t.type)}
                    selectedId={null}
                    placeholder="Pick a category"
                    onSelect={(id) => {
                      const category = categories.find((c) => c.id === id);
                      if (category) file(t, { categoryId: category.id, category, familyTransfer: false });
                    }}
                  />
                </View>
              )}
            </Card>
          );
        })
      )}
      {pending.length > MAX_SHOWN && (
        <Text style={{ color: colors.inkSubtle, fontSize: 12, textAlign: "center" }}>
          Showing the newest {MAX_SHOWN}. File these and the rest will appear.
        </Text>
      )}
    </ScrollView>
  );
}
