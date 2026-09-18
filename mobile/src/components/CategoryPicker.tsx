import { Fragment } from "react";
import { ScrollView, Text, View } from "react-native";
import type { Category } from "../api/types";
import { useTheme } from "../context/ThemeContext";
import { Chip } from "./ui";

/** Wrapping grid of category chips, grouped by parent, including subcategories. */
export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  maxHeight = 220,
}: {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  maxHeight?: number;
}) {
  const { colors } = useTheme();
  const parents = categories.filter((c) => c.parentId === null);
  const childrenByParent = new Map<string, Category[]>();
  for (const c of categories) {
    if (!c.parentId) continue;
    const list = childrenByParent.get(c.parentId) ?? [];
    list.push(c);
    childrenByParent.set(c.parentId, list);
  }

  if (parents.length === 0) {
    return <Text style={{ color: colors.inkSubtle, fontSize: 13 }}>No categories yet.</Text>;
  }

  return (
    <ScrollView style={{ maxHeight }} nestedScrollEnabled>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {parents.map((parent) => (
          <Fragment key={parent.id}>
            <Chip
              label={parent.name}
              color={parent.color}
              selected={selectedId === parent.id}
              onPress={() => onSelect(parent.id)}
            />
            {(childrenByParent.get(parent.id) ?? []).map((child) => (
              <Chip
                key={child.id}
                label={child.name}
                color={child.color}
                selected={selectedId === child.id}
                onPress={() => onSelect(child.id)}
              />
            ))}
          </Fragment>
        ))}
      </View>
    </ScrollView>
  );
}
