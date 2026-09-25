import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { api } from "../api/client";
import type { Category, CategoryType } from "../api/types";
import { getErrorMessage } from "../api/errors";
import { useTheme } from "../context/ThemeContext";
import { CHART_SWATCHES } from "../theme";
import { Button, ErrorText, Input, Toggle } from "./ui";

/**
 * Adds a category without leaving the form it's needed in. Personal unless shared with the family.
 * `taken` are the categories already offered, so the next unused color is suggested.
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
  const { colors } = useTheme();
  const [name, setName] = useState("");
  const [color, setColor] = useState(() => CHART_SWATCHES.find((c) => !taken.some((t) => t.color === c)) ?? CHART_SWATCHES[0]);
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
    <View style={{ gap: 12, padding: 14, borderRadius: 16, backgroundColor: colors.surfaceSunken }}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: colors.ink }}>New {type === "EXPENSE" ? "expense" : "income"} category</Text>
      <Input value={name} onChangeText={setName} placeholder={type === "EXPENSE" ? "e.g. Groceries" : "e.g. Freelance"} autoCapitalize="words" autoFocus />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {CHART_SWATCHES.map((c) => (
          <Pressable
            key={c}
            onPress={() => setColor(c)}
            hitSlop={4}
            style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: color === c ? 3 : 0, borderColor: colors.ink }}
          />
        ))}
      </View>
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
          <Button title="Add category" size="sm" loading={isSaving} disabled={!name.trim()} onPress={handleSave} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Cancel" size="sm" variant="secondary" disabled={isSaving} onPress={onCancel} />
        </View>
      </View>
    </View>
  );
}
