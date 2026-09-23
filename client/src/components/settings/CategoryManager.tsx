import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { api } from "../../api/client";
import { getErrorMessage } from "../../api/errors";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Dot,
  EmptyState,
  ErrorText,
  Field,
  IconButton,
  Input,
  Label,
  Modal,
  Segmented,
  Select,
  SkeletonRows,
  Toggle,
} from "../ui";
import type { Category, CategoryType } from "../../api/types";

const SWATCHES = [
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
      <CardHeader
        title="Categories"
        subtitle="Organize income and spending"
        icon={<Tag size={17} />}
        actions={
          <>
            <Segmented
              size="sm"
              value={type}
              onChange={setType}
              options={[
                { value: "EXPENSE", label: "Expense" },
                { value: "INCOME", label: "Income" },
              ]}
            />
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setEditing("new")}>
              Add
            </Button>
          </>
        }
      />

      <ErrorText>{error || archiveError}</ErrorText>

      {isLoading ? (
        <SkeletonRows rows={4} />
      ) : topLevel.length === 0 ? (
        <EmptyState title="No categories yet" description="Add a category to start organizing transactions." icon={<Tag size={18} />} />
      ) : (
        <ul className="divide-y divide-line">
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
                <ul className="ml-5 space-y-0.5 border-l-2 border-line pl-3 sm:ml-8">
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
    <div className="-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5 hover:bg-surface-sunken">
      <button type="button" onClick={onEdit} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <Dot color={category.color} />
        <span className="truncate text-sm font-medium text-ink">{category.name}</span>
        {category.ownerId && <Badge>Personal</Badge>}
      </button>
      <span className="flex shrink-0 items-center gap-1">
        <IconButton label={`Edit ${category.name}`} onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        {isArchiving ? (
          <span className="flex items-center gap-1.5">
            <Button size="sm" variant="danger" onClick={onArchiveConfirm}>
              Confirm
            </Button>
            <Button size="sm" variant="ghost" onClick={onArchiveCancel}>
              Cancel
            </Button>
          </span>
        ) : (
          <IconButton label={`Archive ${category.name}`} tone="danger" onClick={onArchiveStart}>
            <Trash2 size={14} />
          </IconButton>
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
  const [color, setColor] = useState(category?.color ?? SWATCHES[0]);
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
          isCommon,
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
    <Modal
      title={isEdit ? "Edit category" : "Add category"}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="category-form" loading={isSubmitting} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <form id="category-form" onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          {(props) => <Input {...props} required value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>

        <div>
          <Label>Color</Label>
          <div className="flex flex-wrap items-center gap-2">
            {SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                onClick={() => setColor(swatch)}
                aria-label={`Use ${swatch}`}
                style={{ backgroundColor: swatch }}
                className={`h-8 w-8 rounded-full transition duration-150 ease-swift ${
                  color === swatch ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "hover:scale-110"
                }`}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              aria-label="Custom color"
              className="h-8 w-8 cursor-pointer rounded-full border border-line bg-surface p-0.5"
            />
          </div>
        </div>

        <Field label="Parent category">
          {(props) => (
            <Select {...props} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">None (top-level)</option>
              {parentChoices.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Toggle
          checked={isCommon}
          onChange={setIsCommon}
          label="Shared family category"
          description="Visible to the whole family rather than just you. Turn off to make it personal."
        />

        <ErrorText>{error}</ErrorText>
      </form>
    </Modal>
  );
}
