import { useMemo } from "react";
import type { Category } from "../api/types";
import { SearchSelect, type SearchSelectOption } from "./SearchSelect";

/** Colours offered for a new category. */
export const CATEGORY_SWATCHES = [
  "#6366F1",
  "#A855F7",
  "#22D3EE",
  "#2DD4BF",
  "#84CC16",
  "#F59E0B",
  "#FB7185",
  "#EC4899",
  "#0EA5E9",
  "#10B981",
  "#F97316",
  "#94A3B8",
];

/**
 * A category select field with search: top-level categories each followed by their subcategories.
 * `onAddNew` adds a "New category" entry at the end; `clearLabel` lets the choice be cleared.
 */
export function CategoryPicker({
  id,
  categories,
  selectedId,
  onSelect,
  onAddNew,
  clearLabel,
  placeholder = "Select a category",
  "aria-describedby": describedBy,
}: {
  id?: string;
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddNew?: () => void;
  clearLabel?: string;
  placeholder?: string;
  "aria-describedby"?: string;
}) {
  const options = useMemo<SearchSelectOption[]>(() => {
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
    <SearchSelect
      id={id}
      aria-describedby={describedBy}
      options={options}
      value={selectedId}
      onChange={onSelect}
      placeholder={categories.length === 0 ? "No categories yet" : placeholder}
      clearLabel={clearLabel}
      searchPlaceholder="Search categories"
      emptyText="No category matches."
      onAddNew={onAddNew}
      addNewLabel="New category"
    />
  );
}
