import { useMemo } from "react";
import type { Category } from "../api/types";
import { SelectField, type SelectOption } from "./SelectField";

/**
 * A category select field: tapping it opens a searchable list, top-level categories each followed by
 * their subcategories. `onAddNew` adds a "New category" entry at the end; `clearLabel` lets the
 * choice be cleared.
 */
export function CategoryPicker({
  categories,
  selectedId,
  onSelect,
  onAddNew,
  clearLabel,
  placeholder = "Select a category",
}: {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddNew?: () => void;
  clearLabel?: string;
  placeholder?: string;
}) {
  const options = useMemo<SelectOption[]>(() => {
    const ids = new Set(categories.map((c) => c.id));
    const byId = new Map(categories.map((c) => [c.id, c]));
    // A subcategory whose parent isn't offered here (another type, or not visible) stands on its own.
    const parents = categories.filter((c) => c.parentId === null || !ids.has(c.parentId));
    const childrenByParent = new Map<string, Category[]>();
    for (const c of categories) {
      if (!c.parentId || !ids.has(c.parentId)) continue;
      const list = childrenByParent.get(c.parentId) ?? [];
      list.push(c);
      childrenByParent.set(c.parentId, list);
    }
    return parents.flatMap((parent) => [
      { id: parent.id, label: parent.name, color: parent.color },
      ...(childrenByParent.get(parent.id) ?? []).map((child) => ({
        id: child.id,
        label: child.name,
        color: child.color,
        indent: true,
        // Searching "food" also finds Food's subcategories.
        keywords: byId.get(parent.id)?.name,
      })),
    ]);
  }, [categories]);

  return (
    <SelectField
      title="Category"
      options={options}
      selectedId={selectedId}
      onSelect={onSelect}
      placeholder={categories.length === 0 ? "No categories yet" : placeholder}
      clearLabel={clearLabel}
      searchPlaceholder="Search categories"
      emptyText="No category matches."
      onAddNew={onAddNew}
      addNewLabel="New category"
    />
  );
}
