import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import { Button, Card, EmptyState, ErrorText, Input, Label, Modal, Segmented, Select, Spinner } from "../ui";
import type { Category, CategoryType } from "../../api/types";

const DEFAULT_COLOR = "#6366F1";

export function CategoryManager({ familyId }: { familyId: string }) {
  const [type, setType] = useState<CategoryType>("EXPENSE");
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | "new" | null>(null);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [archiveError, setArchiveError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.get<Category[]>(`/families/${familyId}/categories`);
      setCategories(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to load categories"));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyId]);

  const categoriesOfType = useMemo(() => categories.filter((c) => c.type === type), [categories, type]);
  const topLevel = useMemo(() => categoriesOfType.filter((c) => !c.parentId), [categoriesOfType]);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, Category[]>();
    for (const c of categoriesOfType) {
      if (c.parentId) {
        const list = map.get(c.parentId) ?? [];
        list.push(c);
        map.set(c.parentId, list);
      }
    }
    return map;
  }, [categoriesOfType]);

  async function handleArchive(categoryId: string) {
    setArchiveError(null);
    try {
      await api.delete(`/families/${familyId}/categories/${categoryId}`);
      setArchivingId(null);
      await load();
    } catch (err) {
      setArchiveError(getErrorMessage(err, "Unable to archive category"));
    }
  }

  return (
    <Card>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Categories</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            value={type}
            onChange={setType}
            options={[
              { value: "EXPENSE", label: "Expense" },
              { value: "INCOME", label: "Income" },
            ]}
          />
          <Button variant="secondary" onClick={() => setEditing("new")}>
            <Plus size={16} className="mr-1.5" />
            Add
          </Button>
        </div>
      </div>

      <ErrorText>{error || archiveError}</ErrorText>

      {isLoading ? (
        <Spinner label="Loading categories..." />
      ) : topLevel.length === 0 ? (
        <EmptyState title="No categories yet" description="Add a category to start organizing transactions." />
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-800">
          {topLevel.map((category) => (
            <li key={category.id}>
              <CategoryRow
                category={category}
                isArchiving={archivingId === category.id}
                onEdit={() => setEditing(category)}
                onArchiveStart={() => setArchivingId(category.id)}
                onArchiveCancel={() => setArchivingId(null)}
                onArchiveConfirm={() => handleArchive(category.id)}
              />
              {(childrenByParent.get(category.id) ?? []).length > 0 && (
                <ul className="ml-8 divide-y divide-slate-100 border-l border-slate-200 pl-3 dark:divide-slate-800/60 dark:border-slate-800">
                  {(childrenByParent.get(category.id) ?? []).map((child) => (
                    <li key={child.id}>
                      <CategoryRow
                        category={child}
                        isArchiving={archivingId === child.id}
                        onEdit={() => setEditing(child)}
                        onArchiveStart={() => setArchivingId(child.id)}
                        onArchiveCancel={() => setArchivingId(null)}
                        onArchiveConfirm={() => handleArchive(child.id)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <CategoryFormModal
          familyId={familyId}
          type={type}
          category={editing === "new" ? null : editing}
          topLevelOptions={topLevel}
          onClose={() => setEditing(null)}
          onSaved={load}
        />
      )}
    </Card>
  );
}

function CategoryRow({
  category,
  isArchiving,
  onEdit,
  onArchiveStart,
  onArchiveCancel,
  onArchiveConfirm,
}: {
  category: Category;
  isArchiving: boolean;
  onEdit: () => void;
  onArchiveStart: () => void;
  onArchiveCancel: () => void;
  onArchiveConfirm: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: category.color }} />
        <span className="truncate text-sm font-medium">{category.name}</span>
        {category.ownerId && (
          <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            Private
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${category.name}`}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <Pencil size={14} />
        </button>
        {isArchiving ? (
          <span className="flex items-center gap-1.5 text-xs">
            <button
              type="button"
              onClick={onArchiveConfirm}
              className="rounded-md bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
            >
              Confirm
            </button>
            <button
              type="button"
              onClick={onArchiveCancel}
              className="rounded-md bg-slate-100 px-2 py-1 font-medium text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={onArchiveStart}
            className="text-xs font-medium text-slate-400 hover:text-red-600 dark:hover:text-red-400"
          >
            Archive
          </button>
        )}
      </span>
    </div>
  );
}

function CategoryFormModal({
  familyId,
  type,
  category,
  topLevelOptions,
  onClose,
  onSaved,
}: {
  familyId: string;
  type: CategoryType;
  category: Category | null;
  topLevelOptions: Category[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = Boolean(category);
  const [name, setName] = useState(category?.name ?? "");
  const [color, setColor] = useState(category?.color ?? DEFAULT_COLOR);
  const [parentId, setParentId] = useState(category?.parentId ?? "");
  const [isCommon, setIsCommon] = useState(category ? category.ownerId === null : true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (isEdit && category) {
        await api.patch(`/families/${familyId}/categories/${category.id}`, {
          name,
          color,
          parentId: parentId || null,
        });
      } else {
        await api.post(`/families/${familyId}/categories`, {
          name,
          type,
          color,
          parentId: parentId || null,
          isCommon,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to save category"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const parentChoices = topLevelOptions.filter((c) => c.id !== category?.id);

  return (
    <Modal title={isEdit ? "Edit category" : "Add category"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label htmlFor="category-name">Name</Label>
          <Input id="category-name" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="category-color">Color</Label>
          <input
            id="category-color"
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            className="h-10 w-16 cursor-pointer rounded-lg border border-slate-300 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
          />
        </div>
        <div>
          <Label htmlFor="category-parent">Parent category</Label>
          <Select id="category-parent" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top-level)</option>
            {parentChoices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        {!isEdit && (
          <div className="flex items-center gap-2">
            <input
              id="category-is-common"
              type="checkbox"
              checked={isCommon}
              onChange={(e) => setIsCommon(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            <Label htmlFor="category-is-common" className="mb-0">
              Shared family (common) category
            </Label>
          </div>
        )}
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={isSubmitting || !name.trim()}>
            {isSubmitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
