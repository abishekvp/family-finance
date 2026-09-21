import { useCallback, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { CheckCircle2, Target } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Goal } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, EmptyState, ErrorText, Field, Input, Money, ProgressBar, SkeletonRows, Toggle } from "../../src/components/ui";

export default function Goals() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const family = user!.families[0];
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [contributingTo, setContributingTo] = useState<Goal | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Goal[]>(`/families/${family.id}/goals`);
      setGoals(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load goals"));
    } finally {
      setIsLoading(false);
    }
  }, [family.id]);

  useFocusEffect(
    useCallback(() => {
      setIsLoading(true);
      load();
    }, [load])
  );

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await api.delete(`/families/${family.id}/goals/${id}`);
      setConfirmDeleteId(null);
      await load();
    } catch (err) {
      setDeleteError(getErrorMessage(err, "Unable to delete goal"));
    }
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <Button
          title={showAddForm ? "Cancel" : "Add goal"}
          variant="secondary"
          size="sm"
          onPress={() => setShowAddForm((v) => !v)}
        />
      </View>

      {showAddForm && (
        <GoalForm
          familyId={family.id}
          onDone={() => {
            setShowAddForm(false);
            load();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {contributingTo && (
        <ContributeForm
          familyId={family.id}
          goal={contributingTo}
          onDone={() => {
            setContributingTo(null);
            load();
          }}
          onCancel={() => setContributingTo(null)}
        />
      )}

      <ErrorText>{error}</ErrorText>
      <ErrorText>{deleteError}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={3} />
      ) : goals.length === 0 ? (
        <EmptyState
          icon={<Target size={20} color={colors.brand600} />}
          title="No savings goals yet"
          description="Set a target and track progress as you contribute."
        />
      ) : (
        <View style={{ gap: 12 }}>
          {goals.map((g) => (
            <Card key={g.id} style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flex: 1 }}>
                  {g.isCompleted && <CheckCircle2 size={16} color={colors.income} />}
                  <Text style={{ fontWeight: "700", fontSize: 14.5, color: colors.ink }} numberOfLines={1}>
                    {g.name}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", gap: 14 }}>
                  {!g.isCompleted && (
                    <Pressable onPress={() => setContributingTo(g)} hitSlop={8}>
                      <Text style={{ color: colors.brand600, fontSize: 12, fontWeight: "700" }}>Add money</Text>
                    </Pressable>
                  )}
                  {confirmDeleteId === g.id ? (
                    <Button title="Confirm" size="sm" variant="danger" onPress={() => handleDelete(g.id)} />
                  ) : (
                    <Pressable onPress={() => setConfirmDeleteId(g.id)} hitSlop={8}>
                      <Text style={{ color: colors.inkSubtle, fontSize: 12, fontWeight: "700" }}>Delete</Text>
                    </Pressable>
                  )}
                </View>
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Money amount={g.saved} currency={family.currency} style={{ fontSize: 12, color: colors.inkSubtle }} />
                <Text style={{ fontSize: 12, color: colors.inkSubtle }}>{Math.round(g.progress * 100)}%</Text>
              </View>
              <ProgressBar value={g.progress} tone={g.isCompleted ? "income" : "brand"} />
              {g.targetDate && (
                <Text style={{ fontSize: 11, color: colors.inkSubtle }}>
                  Target date {new Date(g.targetDate).toLocaleDateString()}
                </Text>
              )}
            </Card>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function GoalForm({
  familyId,
  onDone,
  onCancel,
}: {
  familyId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [isCommon, setIsCommon] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { colors } = useTheme();

  const amountValue = Number(targetAmount);
  const canSubmit = name.trim().length > 0 && targetAmount.trim().length > 0 && amountValue > 0;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/goals`, { name, targetAmount: amountValue, isCommon });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create goal"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Field label="Goal name">
        <Input value={name} onChangeText={setName} placeholder="Emergency fund" />
      </Field>
      <Field label="Target amount">
        <Input keyboardType="decimal-pad" value={targetAmount} onChangeText={setTargetAmount} placeholder="0.00" />
      </Field>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Shared family goal</Text>
        <Toggle value={isCommon} onChange={setIsCommon} />
      </View>
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Add goal" loading={isSubmitting} disabled={!canSubmit} onPress={handleSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}

function ContributeForm({
  familyId,
  goal,
  onDone,
  onCancel,
}: {
  familyId: string;
  goal: Goal;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { colors } = useTheme();

  const amountValue = Number(amount);
  const canSubmit = amount.trim().length > 0 && amountValue > 0;

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post(`/families/${familyId}/goals/${goal.id}/contributions`, { amount: amountValue });
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to add contribution"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Text style={{ fontWeight: "800", color: colors.ink }}>Add money to "{goal.name}"</Text>
      <Field label="Amount">
        <Input keyboardType="decimal-pad" value={amount} onChangeText={setAmount} placeholder="0.00" autoFocus />
      </Field>
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title="Add" loading={isSubmitting} disabled={!canSubmit} onPress={handleSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
