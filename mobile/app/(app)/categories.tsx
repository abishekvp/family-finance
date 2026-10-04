import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";
import { ChevronRight, Pencil, Tag, Trash2 } from "lucide-react-native";
import { api } from "../../src/api/client";
import { fetchWithCache } from "../../src/lib/cache";
import type { Category, CategoryType, FamilyRole } from "../../src/api/types";
import { useAuth } from "../../src/context/AuthContext";
import { useTheme } from "../../src/context/ThemeContext";
import { getErrorMessage } from "../../src/api/errors";
import { Badge, Button, Card, Chip, EmptyState, ErrorText, Field, Input, Segmented, Sheet, SkeletonRows, Toggle } from "../../src/components/ui";
import { CategoryBadge } from "../../src/components/transactions/TransactionRow";
import { CHART_SWATCHES } from "../../src/theme";

type Visibility = "personal" | "shared";

/** Mirrors the server's assertCanModify: shared categories are admin-only, personal ones owner-only. */
function canModify(category: Category, role: FamilyRole) {
  if (role === "VIEWER") return false;
  return category.ownerId !== null || role === "ADMIN";
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Looked up by id so the sheet reflects each reload (e.g. after switching personal ↔ shared).
  const selected = categories.find((c) => c.id === selectedId) ?? null;

  const load = useCallback(async () => {
    try {
      const res = await fetchWithCache<Category[]>(
        `/families/${family.id}/categories`,
        undefined,
        (cached) => {
          setCategories(cached.data);
          setIsLoading(false);
        }
      );
      setCategories(res.data);
      setError(null);
    } catch (err) {
      if (categories.length === 0) {
        setError(getErrorMessage(err, "Unable to load categories"));
      }
    } finally {
      setIsLoading(false);
    }
  }, [family.id, categories.length]);

  useFocusEffect(
    useCallback(() => {

      load();
    }, [load])
  );

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
        <View key={category.id} style={{ paddingVertical: 12 }}>
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
        onPress={() => setSelectedId(category.id)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 12,
          paddingLeft: indent ? 32 : 0,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <CategoryBadge color={category.color} label={category.name[0]?.toUpperCase() ?? "?"} size={32} />
        <Text style={{ flex: 1, fontSize: 14, fontWeight: indent ? "600" : "700", color: colors.ink }} numberOfLines={1}>
          {category.name}
        </Text>
        <Badge tone={category.ownerId ? "neutral" : "brand"}>{category.ownerId ? "Personal" : "Family"}</Badge>
        <ChevronRight size={16} color={colors.inkSubtle} />
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

      <CategoryActionsSheet
        familyId={family.id}
        role={family.role}
        category={selected}
        hasChildren={!!selected && (childrenByParent.get(selected.id)?.length ?? 0) > 0}
        onClose={() => setSelectedId(null)}
        onEdit={(category) => {
          setSelectedId(null);
          setShowAddForm(false);
          setEditing(category);
        }}
        onChanged={load}
      />
    </ScrollView>
  );
}

/** What tapping a category offers: edit, switch personal ↔ family shared, or delete. */
function CategoryActionsSheet({
  familyId,
  role,
  category,
  hasChildren,
  onClose,
  onEdit,
  onChanged,
}: {
  familyId: string;
  role: FamilyRole;
  category: Category | null;
  hasChildren: boolean;
  onClose: () => void;
  onEdit: (category: Category) => void;
  onChanged: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"visibility" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Shown optimistically while the change saves; the list reload brings the real value.
  const [visibility, setVisibility] = useState<Visibility | null>(null);

  function close() {
    setConfirmDelete(false);
    setError(null);
    setVisibility(null);
    onClose();
  }

  if (!category) return null;

  const editable = canModify(category, role);
  const current: Visibility = visibility ?? (category.ownerId ? "personal" : "shared");

  async function changeVisibility(next: Visibility) {
    if (!category || busy || next === current) return;
    setError(null);
    setVisibility(next);
    setBusy("visibility");
    try {
      await api.patch(`/families/${familyId}/categories/${category.id}`, { isCommon: next === "shared" });
      await onChanged();
    } catch (err) {
      setVisibility(null);
      setError(getErrorMessage(err, "Unable to change who can see this category"));
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (!category) return;
    setError(null);
    setBusy("delete");
    try {
      await api.delete(`/families/${familyId}/categories/${category.id}`);
      await onChanged();
      close();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to delete category"));
      setConfirmDelete(false);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Sheet visible onClose={close} title={category.name}>
      <View style={{ gap: 16, paddingBottom: 8 }}>
        {editable ? (
          <>
            <Field
              label="Visible to"
              hint={
                current === "shared"
                  ? "Everyone in the family can see and use it."
                  : role === "ADMIN"
                    ? "Only you can see and use it."
                    : "Only you can see and use it. Once shared, only a family admin can make it personal again."
              }
            >
              <Segmented
                fullWidth
                value={current}
                onChange={changeVisibility}
                options={[
                  { value: "personal", label: "Personal" },
                  { value: "shared", label: "Family shared" },
                ]}
              />
            </Field>

            <ErrorText>{error}</ErrorText>

            <Button
              title="Edit name, color & parent"
              variant="secondary"
              icon={<Pencil size={16} color={colors.ink} />}
              disabled={busy !== null}
              onPress={() => onEdit(category)}
            />

            {confirmDelete ? (
              <View style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: colors.expenseSoft }}>
                <Text style={{ color: colors.ink, fontSize: 13, fontWeight: "600", lineHeight: 19 }}>
                  Delete “{category.name}”?{hasChildren ? " Its subcategories are deleted too." : ""} Transactions already in it keep their
                  history.
                </Text>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Button title="Delete" variant="danger" loading={busy === "delete"} onPress={handleDelete} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button title="Cancel" variant="secondary" disabled={busy === "delete"} onPress={() => setConfirmDelete(false)} />
                  </View>
                </View>
              </View>
            ) : (
              <Button
                title="Delete category"
                variant="ghost"
                icon={<Trash2 size={16} color={colors.expense} />}
                disabled={busy !== null}
                onPress={() => setConfirmDelete(true)}
              />
            )}
          </>
        ) : (
          <Text style={{ color: colors.inkMuted, fontSize: 13, lineHeight: 19 }}>
            {role === "VIEWER"
              ? "Viewers can't change categories. Ask a family admin for member access."
              : "This is a family shared category — only a family admin can edit, delete or make it personal."}
          </Text>
        )}
      </View>
    </Sheet>
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
  const [isCommon, setIsCommon] = useState(initial ? initial.ownerId === null : false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const availableParents = parents.filter((p) => p.id !== initial?.id);

  async function handleSubmit() {
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && initial) {
        await api.patch(`/families/${familyId}/categories/${initial.id}`, { name, color, parentId, isCommon });
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

      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.ink }}>Share with family</Text>
          <Text style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 2 }}>
            {isCommon ? "Everyone in the family can see and use it." : "Personal — only you can see and use it."}
          </Text>
        </View>
        <Toggle value={isCommon} onChange={setIsCommon} />
      </View>

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
