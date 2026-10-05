import { useState } from "react";
import { api } from "../api/client";
import type { Category, CategoryType } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { Button, ErrorText, Input, Toggle, cn } from "./ui";
import { CATEGORY_SWATCHES } from "./CategoryPicker";

/**
 * Adds a category without leaving the form it's needed in. Personal unless shared with the family.
 * `taken` are the categories already offered, so the next unused colour is suggested.
 */
export function NewCategoryForm({
  familyId,
  type,
  taken,
  onCreated,
  onCancel,
}: {
  familyId: string;
  type: CategoryType;
  taken: Category[];
  onCreated: (category: Category) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => CATEGORY_SWATCHES.find((c) => !taken.some((t) => t.color === c)) ?? CATEGORY_SWATCHES[0]);
  const [isCommon, setIsCommon] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSave() {
    setError(null);
    setIsSaving(true);
    try {
      const res = await api.post<Category>(`/families/${familyId}/categories`, { name: name.trim(), type, color, isCommon });
      onCreated(res.data);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to add category"));
      setIsSaving(false);
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-line bg-surface-sunken/60 p-4">
      <p className="text-sm font-semibold text-ink">New {type === "EXPENSE" ? "expense" : "income"} category</p>
      <Input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          // Inside a bigger form: Enter adds the category rather than submitting that form.
          if (e.key === "Enter") {
            e.preventDefault();
            if (name.trim() && !isSaving) handleSave();
          }
        }}
        placeholder={type === "EXPENSE" ? "e.g. Groceries" : "e.g. Freelance"}
      />
      <div className="flex flex-wrap gap-2">
        {CATEGORY_SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Use ${c}`}
            style={{ backgroundColor: c }}
            className={cn("h-6 w-6 rounded-full transition", color === c ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : "hover:scale-110")}
          />
        ))}
      </div>
      <Toggle
        checked={isCommon}
        onChange={setIsCommon}
        label="Share with family"
        description={isCommon ? "Everyone in the family can see and use it." : "Personal — only you can see and use it."}
      />
      <ErrorText>{error}</ErrorText>
      <div className="flex gap-2">
        <Button type="button" size="sm" loading={isSaving} disabled={!name.trim()} onClick={handleSave}>
          Add category
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={isSaving} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
