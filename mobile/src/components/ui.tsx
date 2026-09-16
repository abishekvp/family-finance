import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type TextInputProps,
  type ViewProps,
} from "react-native";

export const colors = {
  brand600: "#4F46E5",
  brand700: "#4338CA",
  brand50: "#EEF2FF",
  slate50: "#F8FAFC",
  slate200: "#E2E8F0",
  slate400: "#94A3B8",
  slate500: "#64748B",
  slate700: "#334155",
  slate900: "#0F172A",
  white: "#FFFFFF",
  red600: "#DC2626",
  green600: "#16A34A",
};

export function Card({ children, style, ...props }: ViewProps) {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
}

export function Button({
  title,
  variant = "primary",
  disabled,
  ...props
}: PressableProps & { title: string; variant?: "primary" | "secondary" }) {
  return (
    <Pressable
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" ? styles.buttonPrimary : styles.buttonSecondary,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.buttonPressed,
      ]}
      {...props}
    >
      {disabled && variant === "primary" ? (
        <ActivityIndicator color={colors.white} />
      ) : (
        <Text style={variant === "primary" ? styles.buttonTextPrimary : styles.buttonTextSecondary}>{title}</Text>
      )}
    </Pressable>
  );
}

export function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Input(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.slate400} style={styles.input} {...props} />;
}

export function ErrorText({ children }: { children?: string | null }) {
  if (!children) return null;
  return <Text style={styles.errorText}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: {
    backgroundColor: colors.brand600,
  },
  buttonSecondary: {
    backgroundColor: colors.slate50,
    borderWidth: 1,
    borderColor: colors.slate200,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonTextPrimary: {
    color: colors.white,
    fontWeight: "600",
    fontSize: 15,
  },
  buttonTextSecondary: {
    color: colors.slate900,
    fontWeight: "600",
    fontSize: 15,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    color: colors.slate700,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.slate200,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.slate900,
    backgroundColor: colors.white,
  },
  errorText: {
    color: colors.red600,
    fontSize: 13,
    marginTop: 4,
  },
});
