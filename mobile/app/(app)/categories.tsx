import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { Tag } from "lucide-react-native";
import { api } from "../../src/api/client";
import type { Category, CategoryType } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Badge, Button, Card, Chip, EmptyState, ErrorText, Field, Input, Segmented, SkeletonRows, Toggle } from "../../src/components/ui";
import { CategoryBadge } from "../../src/components/transactions/TransactionRow";
import { CHART_SWATCHES } from "../../src/theme";

export default function Categories() {
  const { user } = useAuth();
  const { colors } = useTheme();
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
        style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, paddingLeft: indent ? 32 : 0 }}
      >
        <CategoryBadge color={category.color} label={category.name[0]?.toUpperCase() ?? "?"} size={32} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: indent ? "600" : "700", color: colors.ink }} numberOfLines={1}>
          {category.name}
        </Text>
        {category.ownerId && <Badge>Private</Badge>}
        {confirmArchiveId === category.id ? (
          <Button title="Confirm" size="sm" variant="danger" onPress={() => handleArchive(category.id)} />
        ) : (
          <Pressable onPress={() => setConfirmArchiveId(category.id)} hitSlop={8}>
            <Text style={{ color: colors.inkSubtle, fontSize: 11, fontWeight: "700" }}>Archive</Text>
          </Pressable>
        )}
      </Pressable>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }}>
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
          size="sm"
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
        <SkeletonRows rows={4} />
      ) : parents.length === 0 ? (
        <EmptyState icon={<Tag size={20} color={colors.brand600} />} title={`No ${type.toLowerCase()} categories yet`} description="Add one to start organizing transactions." />
      ) : (
        <Card style={{ paddingVertical: 4, paddingHorizontal: 16 }}>
          {parents.map((parent, i) => (
            <View key={parent.id} style={{ borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
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
  const { colors } = useTheme();
  const isEdit = !!initial;
  const [name, setName] = useState(initial?.name ?? "");
  const [color, setColor] = useState(initial?.color ?? CHART_SWATCHES[0]);
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
        await api.patch(`/families/${familyId}/categories/${initial.id}`, { name, color, parentId });
      } else {
        await api.post(`/families/${familyId}/categories`, { name, type, color, parentId, isCommon });
      }
      onDone();
    } catch (err) {
      setError(getErrorMessage(err, isEdit ? "Unable to update category" : "Unable to create category"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Card style={{ gap: 14 }}>
      <Field label="Name">
        <Input value={name} onChangeText={setName} placeholder={type === "EXPENSE" ? "Groceries" : "Salary"} />
      </Field>

      <Field label="Color">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {CHART_SWATCHES.map((c) => (
            <Pressable
              key={c}
              onPress={() => setColor(c)}
              style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: colors.ink }}
            />
          ))}
        </View>
      </Field>

      {availableParents.length > 0 && (
        <Field label="Parent category">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Chip label="None (top-level)" selected={parentId === null} onPress={() => setParentId(null)} />
            {availableParents.map((p) => (
              <Chip key={p.id} label={p.name} selected={parentId === p.id} onPress={() => setParentId(p.id)} />
            ))}
          </View>
        </Field>
      )}

      {!isEdit && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Shared family category</Text>
          <Toggle value={isCommon} onChange={setIsCommon} />
        </View>
      )}

      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? "Save changes" : "Add category"} loading={isSubmitting} disabled={!name.trim()} onPress={handleSubmit} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" variant="secondary" onPress={onCancel} />
        </View>
      </View>
    </Card>
  );
}
