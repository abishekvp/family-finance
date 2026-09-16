import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { api } from "../../src/api/client";
import type { Category, CategoryType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { getErrorMessage } from "../../src/api/errors";
import { Button, Card, ErrorText, Input, Label, Segmented, colors, pillStyle, pillTextStyle } from "../../src/components/ui";
import { CategoryBadge } from "../../src/components/transactions/TransactionRow";

const SWATCHES = ["#4F46E5", "#0EA5E9", "#F59E0B", "#EC4899", "#10B981", "#8B5CF6", "#F97316", "#14B8A6", "#DC2626", "#64748B"];

export default function Categories() {
  const { user } = useAuth();
  const family = user!.families[0];
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState<CategoryType>("EXPENSE");
  const [showAddForm, setShowAddForm] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get<Category[]>(`/families/${family.id}/categories`);
      setCategories(res.data);
      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load categories"));
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

  async function handleArchive(id: string) {
    setArchiveError(null);
    try {
      await api.delete(`/families/${family.id}/categories/${id}`);
      setConfirmArchiveId(null);
      await load();
    } catch (err) {
      setArchiveError(getErrorMessage(err, "Unable to archive category"));
    }
  }

  const categoriesForType = useMemo(() => categories.filter((c) => c.type === type), [categories, type]);
  const parents = useMemo(() => categoriesForType.filter((c) => c.parentId === null), [categoriesForType]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categoriesForType) {
      if (!c.parentId) continue;
      const list = map.get(c.parentId) ?? [];
      list.push(c);
      map.set(c.parentId, list);
    }
    return map;
  }, [categoriesForType]);

  function renderRow(category: Category, indent: boolean) {
    if (editing?.id === category.id) {
      return (
        <View key={category.id} style={{ padding: 16 }}>
          <CategoryForm
            familyId={family.id}
            type={type}
            parents={parents}
            initial={category}
            onDone={() => {
              setEditing(null);
              load();
            }}
            onCancel={() => setEditing(null)}
          />
        </View>
      );
    }
    return (
      <Pressable
        key={category.id}
        onPress={() => {
          setShowAddForm(false);
          setEditing(category);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 12,
          paddingLeft: indent ? 32 : 0,
        }}
      >
        <CategoryBadge color={category.color} label={category.name[0]?.toUpperCase() ?? "?"} size={30} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: indent ? "500" : "600" }} numberOfLines={1}>
          {category.name}
        </Text>
        {confirmArchiveId === category.id ? (
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable onPress={() => handleArchive(category.id)} hitSlop={8}>
              <Text style={{ color: colors.red600, fontSize: 11, fontWeight: "700" }}>Confirm</Text>
            </Pressable>
            <Pressable onPress={() => setConfirmArchiveId(null)} hitSlop={8}>
              <Text style={{ color: colors.slate500, fontSize: 11, fontWeight: "600" }}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setConfirmArchiveId(category.id)} hitSlop={8}>
            <Text style={{ color: colors.slate400, fontSize: 11, fontWeight: "600" }}>Archive</Text>
          </Pressable>
        )}
      </Pressable>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.slate50 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Segmented
          options={[
            { value: "EXPENSE", label: "Expense" },
            { value: "INCOME", label: "Income" },
          ]}
          value={type}
          onChange={(v) => {
            setType(v);
            setShowAddForm(false);
            setEditing(null);
          }}
        />
        <Button
          title={showAddForm ? "Cancel" : "Add"}
          variant="secondary"
          onPress={() => {
            setEditing(null);
            setShowAddForm((v) => !v);
          }}
        />
      </View>

      {showAddForm && (
        <CategoryForm
          familyId={family.id}
          type={type}
          parents={parents}
          onDone={() => {
            setShowAddForm(false);
            load();
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      <ErrorText>{error}</ErrorText>
      <ErrorText>{archiveError}</ErrorText>

      {isLoading ? (
        <ActivityIndicator color={colors.brand600} size="large" style={{ marginTop: 40 }} />
      ) : parents.length === 0 ? (
        <Card>
          <Text style={{ color: colors.slate400, fontSize: 13, textAlign: "center" }}>
            No {type.toLowerCase()} categories yet. Add one to start organizing transactions.
          </Text>
        </Card>
      ) : (
        <Card style={{ padding: 0, paddingHorizontal: 16 }}>
          {parents.map((parent, i) => (
            <View key={parent.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.slate200 }}>
              {renderRow(parent, false)}
              {(childrenByParent.get(parent.id) ?? []).map((child) => renderRow(child, true))}
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

function CategoryForm({
  familyId,
  type,
  parents,
  initial,
  onDone,
  onCancel,
}: {
  familyId: string;
  type: CategoryType;
  parents: Category[];
  initial?: Category;
  onDone: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? SWATCHES[0]);
  const [parentId, setParentId] = useState<string | null>(initial?.parentId ?? null);
  const [isCommon, setIsCommon] = useState(initial ? initial.ownerId === null : true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableParents = parents.filter((p) => p.id !== initial?.id);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && initial) {
        await api.patch(`/families/${familyId}/categories/${initial.id}`, {
          name,
          color,
          parentId,
        });
      } else {
        await api.post(`/families/${familyId}/categories`, {
          name,
          type,
          color,
          parentId,
          isCommon,
        });
      }
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update category" : "Unable to create category"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 12 }}>
      <View>
        <Label>Name</Label>
        <Input value={name} onChangeText={setName} placeholder={type === "EXPENSE" ? "Groceries" : "Salary"} />
      </View>

      <View>
        <Label>Color</Label>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SWATCHES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: c,
                borderWidth: color === c ? 3 : 0,
                borderColor: colors.slate900,
              }}
            />
          ))}
        </View>
      </View>

      {availableParents.length > 0 && (
        <View>
          <Label>Parent category</Label>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Pressable onPress={() => setParentId(null)} style={pillStyle(parentId === null)}>
              <Text style={pillTextStyle(parentId === null)}>None (top-level)</Text>
            </Pressable>
            {availableParents.map((p) => (
              <Pressable key={p.id} onPress={() => setParentId(p.id)} style={pillStyle(parentId === p.id)}>
                <Text style={pillTextStyle(parentId === p.id)}>{p.name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {!isEdit && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Label>Shared family category</Label>
          <Pressable onPress={() => setIsCommon((v) => !v)} style={[pillStyle(isCommon), { paddingHorizontal: 16 }]}>
            <Text style={pillTextStyle(isCommon)}>{isCommon ? "Shared" : "Private"}</Text>
          </Pressable>
        </View>
      )}

      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button
            title={isSubmitting ? "Saving..." : isEdit ? "Save changes" : "Add category"}
            onPress={handleSubmit}
            disabled={isSubmitting || !name.trim()}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
