import { useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import DateTimePicker, { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { CalendarDays, Clock, X } from "lucide-react-native";
import { useTheme } from "../context/ThemeContext";
import { RADIUS } from "../theme";
import { localDateInput, localTimeInput } from "../lib/dateUtils";
import { Button, Sheet, tap } from "./ui";

type Mode = "date" | "time";

/** A YYYY-MM-DD day as local midnight, or null when it isn't one. */
function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return null;
  const day = new Date(`${value.trim()}T00:00:00`);
  return Number.isNaN(day.getTime()) ? null : day;
}

/** "Today", "Yesterday", or e.g. "Mon, 5 Oct 2026". */
function describeDay(day: Date) {
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const diffDays = Math.round((startOfToday - day.getTime()) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays === -1) return "Tomorrow";
  return day.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

interface PickerOptions {
  minimumDate?: Date;
  maximumDate?: Date;
  /** Offers a "Clear" button in the picker. */
  onClear?: () => void;
}

/**
 * Opens the system picker. Android shows its own date or clock dialog; elsewhere the field shows an
 * inline picker in a sheet (`showSheet`).
 */
function usePicker(mode: Mode) {
  const [sheetValue, setSheetValue] = useState<Date | null>(null);
  const [handlers, setHandlers] = useState<{ onPick: (d: Date) => void; options: PickerOptions } | null>(null);

  function open(value: Date, onPick: (d: Date) => void, options: PickerOptions = {}) {
    tap();
    if (Platform.OS === "android") {
      DateTimePickerAndroid.open({
        value,
        mode,
        minimumDate: options.minimumDate,
        maximumDate: options.maximumDate,
        onValueChange: (_event, picked) => onPick(picked),
        ...(options.onClear ? { neutralButton: { label: "Clear" }, onNeutralButtonPress: options.onClear } : {}),
      });
      return;
    }
    setHandlers({ onPick, options });
    setSheetValue(value);
  }

  const sheet =
    sheetValue && handlers ? (
      <Sheet
        visible
        title={mode === "date" ? "Pick a date" : "Pick a time"}
        onClose={() => setSheetValue(null)}
        footer={
          <View style={{ flexDirection: "row", gap: 8 }}>
            {handlers.options.onClear && (
              <View style={{ flex: 1 }}>
                <Button
                  title="Clear"
                  variant="secondary"
                  onPress={() => {
                    handlers.options.onClear?.();
                    setSheetValue(null);
                  }}
                />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Button
                title="Done"
                onPress={() => {
                  handlers.onPick(sheetValue);
                  setSheetValue(null);
                }}
              />
            </View>
          </View>
        }
      >
        <DateTimePicker
          value={sheetValue}
          mode={mode}
          display={mode === "date" ? "inline" : "spinner"}
          minimumDate={handlers.options.minimumDate}
          maximumDate={handlers.options.maximumDate}
          onValueChange={(_event, picked) => setSheetValue(picked)}
        />
      </Sheet>
    ) : null;

  return { open, sheet };
}

function FieldButton({
  icon,
  label,
  placeholder,
  accessibilityLabel,
  onPress,
  onClear,
}: {
  icon: ReactNode;
  label: string | null;
  placeholder: string;
  accessibilityLabel: string;
  onPress: () => void;
  onClear?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        height: 46,
        borderWidth: 1,
        borderColor: colors.line,
        borderRadius: RADIUS.lg,
        paddingHorizontal: 12,
        backgroundColor: pressed ? colors.surfaceSunken : colors.surface,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
      })}
    >
      {icon}
      <Text numberOfLines={1} style={{ flex: 1, fontSize: 15, color: label ? colors.ink : colors.inkSubtle }}>
        {label ?? placeholder}
      </Text>
      {onClear && label ? (
        <Pressable onPress={onClear} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear">
          <X size={15} color={colors.inkSubtle} />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** A day picked from the system calendar. `value` is YYYY-MM-DD, or "" for none (when `clearable`). */
export function DateField({
  value,
  onChange,
  placeholder = "Pick a date",
  clearable = false,
  minimumDate,
  maximumDate,
}: {
  value: string;
  onChange: (day: string) => void;
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const { colors } = useTheme();
  const { open, sheet } = usePicker("date");
  const day = parseDay(value);
  const clear = clearable ? () => onChange("") : undefined;
  return (
    <>
      <FieldButton
        icon={<CalendarDays size={16} color={colors.inkMuted} />}
        label={day ? describeDay(day) : null}
        placeholder={placeholder}
        accessibilityLabel={day ? `Date, ${describeDay(day)}` : placeholder}
        onPress={() =>
          open(day ?? new Date(), (picked) => onChange(localDateInput(picked)), {
            minimumDate,
            maximumDate,
            onClear: day ? clear : undefined,
          })
        }
        onClear={clear}
      />
      {sheet}
    </>
  );
}

/** A time of day from the system clock picker. `value` is HH:mm (24-hour). */
export function TimeField({ value, onChange }: { value: string; onChange: (time: string) => void }) {
  const { colors } = useTheme();
  const { open, sheet } = usePicker("time");
  const [hours, minutes] = value.split(":").map(Number);
  const at = new Date();
  const valid = Number.isFinite(hours) && Number.isFinite(minutes);
  if (valid) at.setHours(hours, minutes, 0, 0);
  const label = valid ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : null;
  return (
    <>
      <FieldButton
        icon={<Clock size={16} color={colors.inkMuted} />}
        label={label}
        placeholder="Pick a time"
        accessibilityLabel={label ? `Time, ${label}` : "Pick a time"}
        onPress={() => open(at, (picked) => onChange(localTimeInput(picked)))}
      />
      {sheet}
    </>
  );
}
