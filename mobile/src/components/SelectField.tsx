import { useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { Check, Plus, Search } from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
import { Dot, Input, SelectChevron, Sheet } from "./ui";

export interface SelectOption {
  id: string;
  label: string;
  /** Smaller second line (an amount and date, a parent's name…). */
  detail?: string;
  color?: string;
  /** Shown indented under the option before it (a subcategory under its parent). */
  indent?: boolean;
  /** Extra text the search matches besides the label. */
  keywords?: string;
}

/**
 * A select field: one row showing the current choice, which opens a searchable list in a bottom
 * sheet. Used wherever a long list of choices (categories, expenses to refund) used to be shown as
 * a wall of chips.
 */
export function SelectField({
  title,
  options,
  selectedId,
  onSelect,
  placeholder = "Select",
  clearLabel,
  searchPlaceholder = "Search",
  emptyText = "Nothing matches.",
  onAddNew,
  addNewLabel = "Add new",
  disabled,
}: {
  /** The sheet's title. */
  title: string;
  options: SelectOption[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  placeholder?: string;
  /** When set, the list starts with this option, which clears the choice. */
  clearLabel?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onAddNew?: () => void;
  addNewLabel?: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = options.find((o) => o.id === selectedId) ?? null;

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      query
        ? options.filter((o) => `${o.label} ${o.detail ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(query))
        : options,
    [options, query]
  );

  function close() {
    setOpen(false);
    setSearch("");
  }

  function choose(id: string | null) {
    onSelect(id);
    close();
  }

  const row = (key: string, content: ReactNode, isSelected: boolean, onPress: () => void, indent = false) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 12,
        paddingHorizontal: 12,
        marginLeft: indent ? 20 : 0,
        borderRadius: 12,
        backgroundColor: isSelected ? colors.brandSoft : pressed ? colors.surfaceSunken : "transparent",
      })}
    >
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10 }}>{content}</View>
      {isSelected && <Check size={16} color={colors.brand600} />}
    </Pressable>
  );

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => ({
          minHeight: 46,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 14,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: 14,
          backgroundColor: colors.surface,
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        })}
      >
        {selected?.color && <Dot color={selected.color} size={10} />}
        <View style={{ flex: 1, paddingVertical: 8 }}>
          <Text numberOfLines={1} style={{ fontSize: 15, color: selected ? colors.ink : colors.inkSubtle }}>
            {selected ? selected.label : placeholder}
          </Text>
          {selected?.detail && (
            <Text numberOfLines={1} style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 1 }}>
              {selected.detail}
            </Text>
          )}
        </View>
        <SelectChevron />
      </Pressable>

      <Sheet visible={open} onClose={close} title={title}>
        <View style={{ gap: 10, paddingBottom: 12 }}>
          {options.length > 8 && (
            <View style={{ justifyContent: "center" }}>
              <View style={{ position: "absolute", left: 12, zIndex: 1 }}>
                <Search size={16} color={colors.inkSubtle} />
              </View>
              <Input
                value={search}
                onChangeText={setSearch}
                placeholder={searchPlaceholder}
                autoCorrect={false}
                style={{ paddingLeft: 36 }}
              />
            </View>
          )}
          <ScrollView style={{ maxHeight: height * 0.5 }} keyboardShouldPersistTaps="handled">
            {clearLabel && !query && row("__clear", <Text style={{ fontSize: 15, color: colors.inkMuted }}>{clearLabel}</Text>, !selectedId, () => choose(null))}
            {filtered.map((o) =>
              row(
                o.id,
                <>
                  {o.color && <Dot color={o.color} size={o.indent ? 8 : 10} />}
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ fontSize: 15, color: colors.ink, fontWeight: o.indent ? "400" : "600" }}>
                      {o.label}
                    </Text>
                    {o.detail && (
                      <Text numberOfLines={1} style={{ fontSize: 12, color: colors.inkSubtle, marginTop: 1 }}>
                        {o.detail}
                      </Text>
                    )}
                  </View>
                </>,
                o.id === selectedId,
                () => choose(o.id),
                o.indent && !query
              )
            )}
            {filtered.length === 0 && <Text style={{ color: colors.inkSubtle, fontSize: 13, padding: 12 }}>{emptyText}</Text>}
            {onAddNew &&
              row(
                "__new",
                <>
                  <Plus size={16} color={colors.brand600} />
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.brand600 }}>{addNewLabel}</Text>
                </>,
                false,
                () => {
                  close();
                  onAddNew();
                }
              )}
          </ScrollView>
        </View>
      </Sheet>
    </>
  );
}
