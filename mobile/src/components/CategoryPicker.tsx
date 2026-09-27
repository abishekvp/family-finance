import { ScrollView, Text, View } from "react-native";
import { Plus } from "lucide-react-native";
import type { Category } from "../api/types";
import { useTheme } from "../context/ThemeContext";
import { Chip, Dot } from "./ui";

/**
 * Category chips, one row per top-level category with its subcategories after it. `onAddNew` adds a
 * "New category" chip at the end.
 */
export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  onAddNew,
  maxHeight = 260,
}: {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddNew?: () => void;
  maxHeight?: number;
}) {
  const { colors } = useTheme();
  const ids = new Set(categories.map((c) => c.id));
  // A subcategory whose parent isn't offered here (another type, or not visible) stands on its own.
  const parents = categories.filter((c) => c.parentId === null || !ids.has(c.parentId));
  const childrenByParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (!c.parentId || !ids.has(c.parentId)) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }

  const chip = (c: Category, sub: boolean) => {
    const selected = selectedId === c.id;
    return (
      <Chip
        key={c.id}
        label={sub ? `↳ ${c.name}` : c.name}
        color={c.color}
        selected={selected}
        icon={selected || sub ? undefined : <Dot color={c.color} size={8} />}
        onPress={() => onSelect(c.id)}
      />
    );
  };
  const addChip = onAddNew ? (
    <Chip key="new" label="New category" icon={<Plus size={13} color={colors.brand600} />} onPress={onAddNew} />
  ) : null;

  if (parents.length === 0) {
    return (
      <View style={{ gap: 10 }}>
        <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No categories yet.</Text>
        {addChip && <View style={{ flexDirection: "row" }}>{addChip}</View>}
      </View>
    );
  }

  return (
    // Its own keyboardShouldPersistTaps: without it, with the amount keyboard up, the first tap on a
    // chip only closes the keyboard instead of choosing the category.
    <ScrollView style={{ maxHeight }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {parents.map((parent) => {
          const children = childrenByParent.get(parent.id) ?? [];
          if (children.length === 0) return chip(parent, false);
          // A parent with subcategories takes a full row so they read as one group.
          return (
            <View key={parent.id} style={{ width: "100%", flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {chip(parent, false)}
              {children.map((child) => chip(child, true))}
            </View>
          );
        })}
        {addChip}
      </View>
    </ScrollView>
  );
}
