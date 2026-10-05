import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { ChevronRight, Home, Inbox, Plus, Sparkles, Wand2 } from "lucide-react-native";
import type { Category, PayeeRule } from "../../src/api/types";
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
  deletePayeeRule,
  describeTarget,
  fetchPayeeRules,
  findRule,
  isSealed,
  learnMappings,
  ruleMatches,
  updatePayeeRule,
  type LearnedMapping,
  type PayeeRuleInput,
} from "../../src/lib/payeeRules";
import { CategoryPicker } from "../../src/components/CategoryPicker";
import { Badge, Button, Card, CardHeader, Dot, EmptyState, ErrorText, Field, Input, Segmented, SkeletonRows, SuccessText, Toggle } from "../../src/components/ui";

const DAY_MS = 24 * 60 * 60 * 1000;
// Suggestions need a pattern to be worth keeping: a payee seen once isn't one yet.
const MIN_SUGGESTION_COUNT = 2;
const MAX_SUGGESTIONS = 40;

type RuleType = PayeeRule["type"];

/** What the editor holds: a saved rule being changed, or a new one (maybe from a suggestion). */
interface Draft extends PayeeRuleInput {
  id: string | null;
}

export default function PayeeRules() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const router = useRouter();
  const family = user!.families[0];
  const canEdit = family.role !== "VIEWER";
  const isAdmin = family.role === "ADMIN";
  const scrollRef = useRef<ScrollView>(null);

  const [rules, setRules] = useState<PayeeRule[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    try {
      const [rulesRes, categoriesRes] = await Promise.all([
        fetchPayeeRules(family.id, (cached) => {
          setRules(cached);
          setIsLoading(false);
        }),
        fetchWithCache<Category[]>(`/families/${family.id}/categories`, undefined, (cached) => setCategories(cached.data)),
      ]);
      setRules(rulesRes);
      setCategories(categoriesRes.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load payee rules"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  // A year of the family's history is what the suggestions are read from.
  const historyFilter = useMemo(() => ({ from: new Date(Date.now() - 365 * DAY_MS) }), []);
  const { transactions: history, sync } = useTransactions(user!.id, family.id, historyFilter);
  useEffect(() => {
    sync();
  }, [sync]);
  const learned = useMemo(() => learnMappings(history, categories), [history, categories]);

  const sealedRules = rules.some((r) => isSealed(r.payee));
  const sortedRules = useMemo(() => [...rules].sort((a, b) => a.payee.localeCompare(b.payee)), [rules]);

  // History the saved rules don't already cover.
  const suggestions = useMemo(() => {
    const out: LearnedMapping[] = [];
    for (const m of learned.values()) {
      if (m.count < MIN_SUGGESTION_COUNT || findRule(rules, m.payee, m.type)) continue;
      out.push(m);
    }
    return out.sort((a, b) => b.count - a.count).slice(0, MAX_SUGGESTIONS);
  }, [learned, rules]);

  // Unfiled entries the rules (and history) can fill in, among those this member may change.
  const fillable = useMemo(
    () => categorizable(history.filter((t) => isAdmin || t.userId === user!.id), rules, learned),
    [history, rules, learned, isAdmin, user]
  );

  function edit(next: Draft) {
    setNotice(null);
    setError(null);
    setDraft(next);
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }

  async function quickSave(m: LearnedMapping) {
    setError(null);
    setNotice(null);
    try {
      const saved = await createPayeeRule(family.id, { payee: m.payee, type: m.type, categoryId: m.categoryId, familyTransfer: m.familyTransfer });
      setRules((list) => [...list, saved]);
      setNotice(`Saved: “${m.payee}” → ${describeTarget(m)}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the rule"));
    }
  }

  async function applyAll() {
    setError(null);
    setNotice(null);
    setApplying(true);
    try {
      const saved = await applyMatches(family.id, fillable);
      setNotice(`Filed ${saved} transaction${saved === 1 ? "" : "s"}.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update transactions"));
    } finally {
      setApplying(false);
    }
  }

  return (
    <ScrollView ref={scrollRef} style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      {draft ? (
        <RuleEditor
          familyId={family.id}
          draft={draft}
          categories={categories}
          history={history}
          onCancel={() => setDraft(null)}
          onSaved={(saved, wasNew) => {
            setRules((list) => [...list.filter((r) => r.id !== saved.id), saved]);
            setDraft(null);
            setNotice(wasNew ? `Saved: “${saved.payee}” → ${describeTarget(saved)}.` : "Rule updated.");
          }}
          onDeleted={(id) => {
            setRules((list) => list.filter((r) => r.id !== id));
            setDraft(null);
            setNotice("Rule deleted.");
          }}
        />
      ) : (
        <Card>
          <CardHeader
            title="Payee rules"
            subtitle="File transactions automatically by who they're to or from — typed in, or recorded from SMS."
            icon={<Wand2 size={16} color={colors.brand600} />}
          />
          <Text style={{ color: colors.inkMuted, fontSize: 12.5, lineHeight: 18 }}>
            A rule matches any payee containing its text at the start of a word, ignoring case: “swiggy” matches SWIGGY*4521 and
            swiggy@ybl. When several match, the longest wins. Mark money from parents or sent home as a family transfer so it isn't
            counted as income or spending.
          </Text>
          {canEdit && (
            <View style={{ marginTop: 14 }}>
              <Button
                title="Add rule"
                icon={<Plus size={16} color={colors.white} />}
                onPress={() => edit({ id: null, payee: "", type: "EXPENSE", categoryId: null, familyTransfer: false })}
              />
            </View>
          )}
        </Card>
      )}

      {notice && <SuccessText>{notice}</SuccessText>}
      <ErrorText>{error}</ErrorText>

      <Pressable onPress={() => router.push(href("/uncategorized"))}>
        <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
            <Inbox size={16} color={colors.brand600} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", fontSize: 14, color: colors.ink }}>Review uncategorised</Text>
            <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 1 }}>Sort out entries that have no category yet</Text>
          </View>
          <ChevronRight size={17} color={colors.inkSubtle} />
        </Card>
      </Pressable>

      {canEdit && fillable.length > 0 && (
        <Card>
          <CardHeader
            title={`${fillable.length} unfiled transaction${fillable.length === 1 ? "" : "s"} can be filed`}
            subtitle="Your rules and history know where these go."
            icon={<Sparkles size={16} color={colors.brand600} />}
          />
          <Button title="File them now" variant="secondary" loading={applying} onPress={applyAll} />
        </Card>
      )}

      <Card>
        <CardHeader title="Your rules" subtitle="Shared with your family." />
        {sealedRules && (
          <Text style={{ color: colors.inkSubtle, fontSize: 12, marginBottom: 10 }}>Unlock your vault to read encrypted rules.</Text>
        )}
        {isLoading ? (
          <SkeletonRows rows={3} />
        ) : sortedRules.length === 0 ? (
          <EmptyState title="No rules yet" description="Add one, or keep a suggestion below." />
        ) : (
          <View>
            {sortedRules.map((rule, i) => (
              <Pressable
                key={rule.id}
                disabled={!canEdit || isSealed(rule.payee)}
                onPress={() => edit({ id: rule.id, payee: rule.payee, type: rule.type, categoryId: rule.categoryId, familyTransfer: rule.familyTransfer })}
                style={({ pressed }) => [
                  { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line },
                  pressed && { opacity: 0.6 },
                ]}
              >
                <TargetIcon category={rule.category} familyTransfer={rule.familyTransfer} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ fontWeight: "700", fontSize: 14, color: colors.ink }} numberOfLines={1}>
                    {rule.payee}
                  </Text>
                  <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {rule.type === "INCOME" ? "Income" : "Expense"} → {describeTarget(rule)}
                  </Text>
                </View>
                {canEdit && !isSealed(rule.payee) && <ChevronRight size={16} color={colors.inkSubtle} />}
              </Pressable>
            ))}
          </View>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Suggested from your history"
          subtitle="How each payee was filed most often. Keep one as a rule, or tap to change it first."
          icon={<Sparkles size={16} color={colors.brand600} />}
        />
        {suggestions.length === 0 ? (
          <Text style={{ color: colors.inkMuted, fontSize: 13 }}>
            {history.length === 0 ? "Nothing to learn from yet." : "No new suggestions — your rules cover the payees you file regularly."}
          </Text>
        ) : (
          <View>
            {suggestions.map((m, i) => (
              <View
                key={`${m.type}|${m.payee}`}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}
              >
                <Pressable
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 12, minWidth: 0 }}
                  disabled={!canEdit}
                  onPress={() => edit({ id: null, payee: m.payee, type: m.type, categoryId: m.categoryId, familyTransfer: m.familyTransfer })}
                >
                  <TargetIcon category={m.category} familyTransfer={m.familyTransfer} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: "700", fontSize: 14, color: colors.ink }} numberOfLines={1}>
                      {m.payee}
                    </Text>
                    <Text style={{ color: colors.inkSubtle, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                      {m.type === "INCOME" ? "Income" : "Expense"} → {describeTarget(m)} · {m.count} of {m.total}
                    </Text>
                  </View>
                </Pressable>
                {canEdit && <Button title="Keep" size="sm" variant="secondary" onPress={() => quickSave(m)} />}
              </View>
            ))}
          </View>
        )}
      </Card>
    </ScrollView>
  );
}

function TargetIcon({ category, familyTransfer }: { category: { color: string } | null; familyTransfer: boolean }) {
  const { colors } = useTheme();
  if (familyTransfer && !category) {
    return (
      <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
        <Home size={14} color={colors.brand600} />
      </View>
    );
  }
  return (
    <View style={{ width: 30, alignItems: "center" }}>
      <Dot color={category?.color ?? colors.inkSubtle} size={12} />
    </View>
  );
}

function RuleEditor({
  familyId,
  draft,
  categories,
  history,
  onCancel,
  onSaved,
  onDeleted,
}: {
  familyId: string;
  draft: Draft;
  categories: Category[];
  history: { payee: string | null; type: string }[];
  onCancel: () => void;
  onSaved: (rule: PayeeRule, wasNew: boolean) => void;
  onDeleted: (id: string) => void;
}) {
  const { colors } = useTheme();
  const [payee, setPayee] = useState(draft.payee);
  const [type, setType] = useState<RuleType>(draft.type);
  const [categoryId, setCategoryId] = useState<string | null>(draft.categoryId);
  const [familyTransfer, setFamilyTransfer] = useState(draft.familyTransfer);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoriesForType = useMemo(() => categories.filter((c) => c.type === type), [categories, type]);
  const matches = useMemo(
    () => (payee.trim() ? history.filter((t) => t.type === type && t.payee && !isSealed(t.payee) && ruleMatches(payee, t.payee)).length : 0),
    [history, payee, type]
  );
  const canSave = payee.trim().length >= 2 && (!!categoryId || familyTransfer);

  async function save() {
    setError(null);
    setSaving(true);
    try {
      const input = { payee: payee.trim(), type, categoryId, familyTransfer };
      const saved = draft.id ? await updatePayeeRule(familyId, draft.id, input) : await createPayeeRule(familyId, input);
      onSaved(saved, !draft.id);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save the rule"));
      setSaving(false);
    }
  }

  async function remove() {
    if (!draft.id) return;
    setError(null);
    setSaving(true);
    try {
      await deletePayeeRule(familyId, draft.id);
      onDeleted(draft.id);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete the rule"));
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title={draft.id ? "Edit rule" : "New rule"} icon={<Wand2 size={16} color={colors.brand600} />} />
      <View style={{ gap: 16 }}>
        <Segmented
          fullWidth
          value={type}
          onChange={(next) => {
            setType(next);
            if (categories.find((c) => c.id === categoryId)?.type !== next) setCategoryId(null);
          }}
          options={[
            { value: "EXPENSE", label: "Expense" },
            { value: "INCOME", label: "Income" },
          ]}
        />
        <Field
          label="Payee contains"
          hint={payee.trim() ? `Matches ${matches} of your entries from the past year.` : "e.g. swiggy, amazon, or a family member's name as it appears in alerts."}
        >
          <Input value={payee} onChangeText={setPayee} placeholder="Payee text" autoCapitalize="none" autoCorrect={false} />
        </Field>
        <Field label="Category" hint={familyTransfer ? "Optional for a family transfer." : undefined}>
          <CategoryPicker categories={categoriesForType} selectedId={categoryId} onSelect={setCategoryId} clearLabel="No category" />
        </Field>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Family transfer</Text>
            <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
              {type === "INCOME"
                ? "Money from family: it goes into the account but isn't income, and isn't owed back."
                : "Money to family: it leaves the account but isn't spending or in budgets, and isn't owed back."}
            </Text>
          </View>
          <Toggle value={familyTransfer} onChange={setFamilyTransfer} />
        </View>
        {familyTransfer && <Badge tone="brand">Not counted in income or spending</Badge>}
        <ErrorText>{error}</ErrorText>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button title="Save rule" loading={saving} disabled={!canSave} onPress={save} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Cancel" variant="secondary" disabled={saving} onPress={onCancel} />
          </View>
        </View>
        {draft.id &&
          (confirmDelete ? (
            <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.expenseSoft }}>
              <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600" }}>
                Delete this rule? Transactions already filed by it stay as they are.
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Button title="Delete" variant="danger" loading={saving} onPress={remove} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button title="Keep" variant="secondary" disabled={saving} onPress={() => setConfirmDelete(false)} />
                </View>
              </View>
            </View>
          ) : (
            <Button title="Delete rule" variant="ghost" disabled={saving} onPress={() => setConfirmDelete(true)} />
          ))}
      </View>
    </Card>
  );
}
