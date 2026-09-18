import { useEffect, useRef, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal as RNModal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type GestureResponderEvent,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { AlertCircle, Check, ChevronDown, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "../context/ThemeContext";
import { BRAND_GRADIENT, RADIUS, SPACE, type Palette } from "../theme";
import { formatCompactCurrency, formatCurrency, formatSignedCurrency } from "../lib/format";
import { AuroraBackground } from "./AuroraBackground";

/** Best-effort haptic tick — never throws, never blocks (some Android devices lack a vibrator). */
export function tap(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  Haptics.impactAsync(style).catch(() => undefined);
}

/* ------------------------------------------------------------------ screen */

/** Full-screen wrapper: aurora backdrop, safe-area insets, scroll-friendly padding. */
export function Screen({
  children,
  scroll = false,
  contentStyle,
  edges = ["top", "bottom"],
}: {
  children: ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  edges?: ("top" | "bottom" | "left" | "right")[];
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <AuroraBackground />
      <SafeAreaView edges={edges} style={{ flex: 1 }}>
        {scroll ? (
          <ScrollView contentContainerStyle={[{ padding: SPACE.lg, gap: SPACE.md }, contentStyle]}>
            {children}
          </ScrollView>
        ) : (
          <View style={[{ flex: 1, padding: SPACE.lg }, contentStyle]}>{children}</View>
        )}
      </SafeAreaView>
    </View>
  );
}

/* ------------------------------------------------------------------ surfaces */

export function Card({ children, style, muted = false, ...props }: ViewProps & { muted?: boolean }) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles(colors).card,
        muted && { backgroundColor: colors.surfaceSunken, borderColor: "transparent" },
        style,
      ]}
      {...props}
    >
      {children}
    </View>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon,
  action,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, marginBottom: 14 }}>
      {icon && (
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: RADIUS.md,
            backgroundColor: colors.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {icon}
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 16, fontWeight: "800", color: colors.ink }}>{title}</Text>
        {subtitle && <Text style={{ fontSize: 12, color: colors.inkMuted, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {action}
    </View>
  );
}

/* ------------------------------------------------------------------- buttons */

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export function Button({
  title,
  variant = "primary",
  size = "md",
  disabled,
  loading = false,
  icon,
  style,
  onPress,
  ...props
}: PressableProps & {
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  const isDisabled = disabled || loading;
  const heights: Record<ButtonSize, number> = { sm: 34, md: 46, lg: 52 };
  const fontSizes: Record<ButtonSize, number> = { sm: 13, md: 15, lg: 16 };

  const content = (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {loading ? (
        <ActivityIndicator color={variant === "primary" || variant === "danger" ? colors.white : colors.brand600} />
      ) : (
        icon
      )}
      <Text
        style={{
          color: variant === "primary" || variant === "danger" ? colors.white : variant === "outline" || variant === "ghost" ? colors.ink : colors.ink,
          fontWeight: "700",
          fontSize: fontSizes[size],
        }}
      >
        {title}
      </Text>
    </View>
  );

  const baseStyle: ViewStyle = {
    height: heights[size],
    borderRadius: RADIUS.lg,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: size === "sm" ? 14 : 20,
    opacity: isDisabled ? 0.5 : 1,
  };

  function handlePress(e: GestureResponderEvent) {
    if (isDisabled) return;
    tap();
    onPress?.(e);
  }

  if (variant === "primary") {
    return (
      <Pressable disabled={isDisabled} onPress={handlePress} {...props}>
        {({ pressed }) => (
          <LinearGradient
            colors={BRAND_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[baseStyle, style as ViewStyle, pressed && !isDisabled && { opacity: 0.88 }]}
          >
            {content}
          </LinearGradient>
        )}
      </Pressable>
    );
  }

  const variantStyle: ViewStyle =
    variant === "secondary"
      ? { backgroundColor: colors.surfaceSunken }
      : variant === "outline"
        ? { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.lineStrong }
        : variant === "danger"
          ? { backgroundColor: colors.expense }
          : { backgroundColor: "transparent" };

  return (
    <Pressable disabled={isDisabled} onPress={handlePress} {...props}>
      {({ pressed }) => (
        <View style={[baseStyle, variantStyle, style as ViewStyle, pressed && !isDisabled && { opacity: 0.75 }]}>
          {content}
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({
  children,
  onPress,
  size = 36,
  tone = "neutral",
  disabled,
  ...props
}: PressableProps & { children: ReactNode; size?: number; tone?: "neutral" | "brand" | "danger" }) {
  const { colors } = useTheme();
  const pressedTint = tone === "danger" ? colors.expenseSoft : tone === "brand" ? colors.brandSoft : colors.surfaceSunken;

  function handlePress(e: GestureResponderEvent) {
    if (disabled) return;
    tap();
    onPress?.(e);
  }
  return (
    <Pressable disabled={disabled} onPress={handlePress} hitSlop={8} {...props}>
      {({ pressed }) => (
        <View
          style={{
            width: size,
            height: size,
            borderRadius: RADIUS.md,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? pressedTint : "transparent",
            opacity: disabled ? 0.4 : 1,
          }}
        >
          {children}
        </View>
      )}
    </Pressable>
  );
}

/* -------------------------------------------------------------------- inputs */

export function Label({ children, style }: { children: string; style?: StyleProp<TextStyle> }) {
  const { colors } = useTheme();
  return <Text style={[{ fontSize: 13, fontWeight: "600", color: colors.inkMuted, marginBottom: 6 }, style]}>{children}</Text>;
}

export function Input({ style, ...props }: TextInputProps) {
  const { colors } = useTheme();
  return (
    <TextInput
      placeholderTextColor={colors.inkSubtle}
      style={[
        {
          height: 46,
          borderWidth: 1,
          borderColor: colors.line,
          borderRadius: RADIUS.lg,
          paddingHorizontal: 14,
          fontSize: 15,
          color: colors.ink,
          backgroundColor: colors.surface,
        },
        style,
      ]}
      {...props}
    />
  );
}

/** Label + input + optional error, matching the web Field's shape. */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View>
      <Label>{label}</Label>
      {children}
      {hint && !error && <Text style={{ marginTop: 6, fontSize: 12, color: colors.inkSubtle }}>{hint}</Text>}
      {error && <Text style={{ marginTop: 6, fontSize: 12, color: colors.expense, fontWeight: "600" }}>{error}</Text>}
    </View>
  );
}

export function ErrorText({ children }: { children?: string | null }) {
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        backgroundColor: colors.expenseSoft,
        borderRadius: RADIUS.lg,
        padding: 12,
        alignItems: "flex-start",
      }}
    >
      <AlertCircle size={15} color={colors.expense} style={{ marginTop: 1 }} />
      <Text style={{ color: colors.expense, fontSize: 13, flex: 1 }}>{children}</Text>
    </View>
  );
}

export function SuccessText({ children }: { children?: string | null }) {
  const { colors } = useTheme();
  if (!children) return null;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
      <Check size={14} color={colors.income} />
      <Text style={{ color: colors.income, fontSize: 13, fontWeight: "600" }}>{children}</Text>
    </View>
  );
}

export function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 180, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [value]);

  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        tap();
        onChange(!value);
      }}
      style={{ opacity: disabled ? 0.5 : 1 }}
    >
      <Animated.View
        style={{
          width: 46,
          height: 26,
          borderRadius: 999,
          padding: 2,
          backgroundColor: anim.interpolate({ inputRange: [0, 1], outputRange: [colors.lineStrong, colors.brand600] }) as unknown as string,
        }}
      >
        <Animated.View
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            backgroundColor: colors.white,
            transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 20] }) }],
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

export function Checkbox({ checked, onChange }: { checked: boolean; onChange: (next: boolean) => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={() => {
        tap();
        onChange(!checked);
      }}
      hitSlop={8}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 7,
          borderWidth: checked ? 0 : 1.5,
          borderColor: colors.lineStrong,
          backgroundColor: checked ? colors.brand600 : colors.surface,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {checked && <Check size={13} color={colors.white} strokeWidth={3} />}
      </View>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ feedback */

export function EmptyState({ title, description, icon, action }: { title: string; description?: string; icon?: ReactNode; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        alignItems: "center",
        paddingVertical: 44,
        paddingHorizontal: 20,
        borderRadius: RADIUS.xl,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: colors.lineStrong,
      }}
    >
      {icon && (
        <View
          style={{
            width: 48,
            height: 48,
            borderRadius: RADIUS.xl,
            backgroundColor: colors.brandSoft,
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          {icon}
        </View>
      )}
      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.ink, textAlign: "center" }}>{title}</Text>
      {description && (
        <Text style={{ fontSize: 12, color: colors.inkSubtle, textAlign: "center", marginTop: 6, maxWidth: 260 }}>
          {description}
        </Text>
      )}
      {action && <View style={{ marginTop: 16 }}>{action}</View>}
    </View>
  );
}

export function Skeleton({ width = "100%", height = 14, radius = 8 }: { width?: number | `${number}%`; height?: number; radius?: number }) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);
  return (
    <Animated.View
      style={{ width, height, borderRadius: radius, backgroundColor: colors.surfaceSunken, opacity: anim }}
    />
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <View style={{ gap: 14 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Skeleton width={40} height={40} radius={RADIUS.md} />
          <View style={{ flex: 1, gap: 6 }}>
            <Skeleton width="55%" height={13} />
            <Skeleton width="30%" height={11} />
          </View>
          <Skeleton width={60} height={14} />
        </View>
      ))}
    </View>
  );
}

/* --------------------------------------------------------------------- atoms */

const AVATAR_HUES = ["#6366F1", "#0EA5E9", "#10B981", "#F59E0B", "#EC4899", "#A855F7"];
function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash << 5) - hash + value.charCodeAt(i);
  return Math.abs(hash);
}

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = AVATAR_HUES[hashString(name) % AVATAR_HUES.length];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: hue,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: "#fff", fontWeight: "800", fontSize: size * 0.4 }}>
        {name.trim().charAt(0).toUpperCase() || "?"}
      </Text>
    </View>
  );
}

export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

type BadgeTone = "neutral" | "brand" | "income" | "expense" | "warn" | "info";
export function Badge({ children, tone = "neutral" }: { children: string; tone?: BadgeTone }) {
  const { colors } = useTheme();
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    neutral: { bg: colors.surfaceSunken, fg: colors.inkMuted },
    brand: { bg: colors.brandSoft, fg: colors.brand600 },
    income: { bg: colors.incomeSoft, fg: colors.income },
    expense: { bg: colors.expenseSoft, fg: colors.expense },
    warn: { bg: colors.warnSoft, fg: colors.warn },
    info: { bg: colors.infoSoft, fg: colors.info },
  };
  const t = map[tone];
  return (
    <View style={{ backgroundColor: t.bg, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, alignSelf: "flex-start" }}>
      <Text style={{ color: t.fg, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 }}>{children}</Text>
    </View>
  );
}

export function ProgressBar({ value, tone = "brand" }: { value: number; tone?: "brand" | "income" | "expense" | "warn" }) {
  const { colors } = useTheme();
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const fill = tone === "income" ? colors.income : tone === "expense" ? colors.expense : tone === "warn" ? colors.warn : colors.brand600;
  return (
    <View style={{ height: 6, borderRadius: 999, backgroundColor: colors.surfaceSunken, overflow: "hidden" }}>
      {tone === "brand" ? (
        <LinearGradient
          colors={BRAND_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ width: `${pct}%`, height: "100%", borderRadius: 999 }}
        />
      ) : (
        <View style={{ width: `${pct}%`, height: "100%", backgroundColor: fill, borderRadius: 999 }} />
      )}
    </View>
  );
}

/* ---------------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  fullWidth = false,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  fullWidth?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: colors.surfaceSunken,
        borderRadius: RADIUS.lg,
        padding: 4,
        alignSelf: fullWidth ? "stretch" : "flex-start",
      }}
    >
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => {
              tap();
              onChange(opt.value);
            }}
            style={[
              {
                paddingHorizontal: 14,
                paddingVertical: 7,
                borderRadius: RADIUS.md,
                backgroundColor: active ? colors.surface : "transparent",
              },
              fullWidth && { flex: 1, alignItems: "center" },
            ]}
          >
            <Text style={{ fontSize: 13, fontWeight: "700", color: active ? colors.brand600 : colors.inkMuted }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  icon,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  const bg = selected ? color ?? colors.brand600 : colors.surface;
  const fg = selected ? colors.white : colors.inkMuted;
  return (
    <Pressable
      onPress={() => {
        tap();
        onPress?.();
      }}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 13,
        paddingVertical: 8,
        borderRadius: 999,
        backgroundColor: bg,
        borderWidth: selected ? 0 : 1,
        borderColor: colors.line,
      }}
    >
      {icon}
      <Text style={{ fontSize: 12, fontWeight: "700", color: fg }}>{label}</Text>
    </Pressable>
  );
}

export function SelectChevron() {
  const { colors } = useTheme();
  return <ChevronDown size={15} color={colors.inkSubtle} />;
}

/* -------------------------------------------------------------------- sheet */

/** Bottom sheet modal — the native equivalent of the web Modal's phone presentation. */
export function Sheet({
  visible,
  onClose,
  title,
  children,
  footer,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" }}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <SafeAreaView edges={["bottom"]} style={{ backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28, maxHeight: "92%" }}>
          <View style={{ alignSelf: "center", width: 36, height: 4, borderRadius: 999, backgroundColor: colors.lineStrong, marginTop: 10 }} />
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 20, paddingBottom: 12 }}>
            <Text style={{ fontSize: 17, fontWeight: "800", color: colors.ink }}>{title}</Text>
            <IconButton onPress={onClose}>
              <X size={18} color={colors.inkMuted} />
            </IconButton>
          </View>
          <View style={{ paddingHorizontal: 20 }}>{children}</View>
          {footer && <View style={{ padding: 20, borderTopWidth: 1, borderTopColor: colors.line, marginTop: 12 }}>{footer}</View>}
        </SafeAreaView>
      </View>
    </RNModal>
  );
}

/* ------------------------------------------------------------------- money */

export function Money({
  amount,
  currency,
  signed = false,
  compact = false,
  tone,
  style,
}: {
  amount: number;
  currency: string;
  signed?: boolean;
  compact?: boolean;
  tone?: "income" | "expense" | "auto" | "muted";
  style?: StyleProp<TextStyle>;
}) {
  const { colors } = useTheme();
  const resolvedTone = tone === "auto" ? (amount < 0 ? "expense" : amount > 0 ? "income" : "muted") : tone;
  const text = signed ? formatSignedCurrency(amount, currency) : compact ? formatCompactCurrency(amount, currency) : formatCurrency(amount, currency);
  const color = resolvedTone === "income" ? colors.income : resolvedTone === "expense" ? colors.expense : resolvedTone === "muted" ? colors.inkMuted : colors.ink;
  return <Text style={[{ color, fontVariant: ["tabular-nums"] }, style]}>{text}</Text>;
}

export function StatTile({
  label,
  value,
  currency,
  icon,
  hint,
  compact = false,
  tone,
  loading = false,
}: {
  label: string;
  value: number;
  currency: string;
  icon?: ReactNode;
  hint?: ReactNode;
  compact?: boolean;
  tone?: "income" | "expense" | "auto";
  loading?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Card style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Text style={{ fontSize: 12, color: colors.inkMuted, flex: 1 }} numberOfLines={2}>
          {label}
        </Text>
        {icon && (
          <View style={{ width: 28, height: 28, borderRadius: RADIUS.sm, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center" }}>
            {icon}
          </View>
        )}
      </View>
      {loading ? (
        <Skeleton width="70%" height={22} radius={6} />
      ) : (
        <Money amount={value} currency={currency} compact={compact} tone={tone} style={{ fontSize: 20, fontWeight: "800", marginTop: 8 }} />
      )}
      {hint && <View style={{ marginTop: 4 }}>{hint}</View>}
    </Card>
  );
}

/* ------------------------------------------------------------------- styles */

function styles(colors: Palette) {
  return StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: RADIUS.xl,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.line,
      shadowColor: "#0B0F1F",
      shadowOpacity: 0.05,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 1,
    },
  });
}
