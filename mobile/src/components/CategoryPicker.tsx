import { ScrollView, Pressable, Text, View } from "react-native";
import type { Category } from "../api/types";
import { colors } from "./ui";
import { CategoryBadge } from "./transactions/TransactionRow";

/** Vertical list of categories, flat but visually grouped by parent, including subcategories. */
export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  maxHeight = 260,
}: {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  maxHeight?: number;
}) {
  const parents = categories.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }

  function Row({ category, indent }: { category: Category; indent: boolean }) {
    const selected = selectedId === category.id;
    return (
      <Pressable
        onPress={() => onSelect(category.id)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingVertical: 8,
          paddingHorizontal: 8,
          paddingLeft: indent ? 32 : 8,
          borderRadius: 8,
          backgroundColor: selected ? colors.brand50 : "transparent",
        }}
      >
        <CategoryBadge color={category.color} label={category.name[0]?.toUpperCase() ?? "?"} size={24} />
        <Text style={{ fontSize: 14, color: selected ? colors.brand700 : colors.slate900, fontWeight: selected ? "700" : "500" }}>
          {category.name}
        </Text>
      </Pressable>
    );
  }

  if (parents.length === 0) {
    return <Text style={{ color: colors.slate400, fontSize: 13 }}>No categories yet.</Text>;
  }

  return (
    <ScrollView style={{ maxHeight }} nestedScrollEnabled>
      {parents.map((parent) => (
        <View key={parent.id}>
          <Row category={parent} indent={false} />
          {(childrenByParent.get(parent.id) ?? []).map((child) => (
            <Row key={child.id} category={child} indent />
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
