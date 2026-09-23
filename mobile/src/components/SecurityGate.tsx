import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Fingerprint, KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react-native";
import { useAuth } from "../context/AuthContext";
import { useSecurity } from "../context/SecurityContext";
import { useTheme } from "../context/ThemeContext";
import { getErrorMessage } from "../api/errors";
import { Button, ErrorText, Field, Input } from "./ui";
import { Logo } from "./Logo";

/**
 * Sits between "signed in" and the app. The zero-knowledge vault (unlock, or one-time setup when
 * the family already uses encryption) replaces the app until it's open, so screens load their data
 * with the key in place. The app lock is an overlay instead, so returning to the app after a
 * timeout keeps whatever screen and form the user was on.
 */
export function SecurityGate({ children }: { children: ReactNode }) {
  const security = useSecurity();
  const { colors } = useTheme();

  if (security.status === "loading") {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas }}>
        <Logo size={52} />
      </View>
    );
  }

  let content = children;
  if (security.status === "locked") content = <VaultUnlock />;
  else if (security.status === "setup" && !security.setupSkipped) content = <VaultSetup />;

  return (
    <View style={{ flex: 1 }}>
      {content}
      {security.appLocked && (
        <View style={StyleSheet.absoluteFill}>
          <AppLock />
        </View>
      )}
    </View>
  );
}

function GateShell({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  return (
    <View style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }} keyboardShouldPersistTaps="handled">
          <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: colors.brandSoft, alignItems: "center", justifyContent: "center", alignSelf: "center" }}>
            {icon}
          </View>
          <Text style={{ fontSize: 22, fontWeight: "900", color: colors.ink, textAlign: "center", marginTop: 18 }}>{title}</Text>
          <Text style={{ color: colors.inkMuted, textAlign: "center", marginTop: 6, marginBottom: 24, lineHeight: 20 }}>{subtitle}</Text>
          <View style={{ gap: 14 }}>{children}</View>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 28, paddingTop: 14, borderTopWidth: 1, borderTopColor: colors.line }}>
            <Text style={{ color: colors.inkSubtle, fontSize: 12, flex: 1 }} numberOfLines={1}>
              {user?.email}
            </Text>
            <Pressable onPress={() => logout()} style={{ flexDirection: "row", alignItems: "center", gap: 6, padding: 6 }}>
              <LogOut size={14} color={colors.inkMuted} />
              <Text style={{ color: colors.inkMuted, fontWeight: "700", fontSize: 12 }}>Sign out</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function useRunner() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>, fallback = "Unable to unlock") {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(getErrorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run };
}

function AppLock() {
  const { colors } = useTheme();
  const { unlockWithDevice } = useSecurity();
  const { error, busy, run } = useRunner();
  const prompted = useRef(false);

  // Prompt straight away on open; the button is there if the user cancels.
  useEffect(() => {
    if (prompted.current) return;
    prompted.current = true;
    run(unlockWithDevice);
  }, []);

  return (
    <GateShell icon={<LockKeyhole size={24} color={colors.brand600} />} title="Family Finance is locked" subtitle="Unlock with your fingerprint, face, or screen lock.">
      <Button title="Unlock" size="lg" loading={busy} icon={<Fingerprint size={18} color="#fff" />} onPress={() => run(unlockWithDevice)} />
      <ErrorText>{error}</ErrorText>
    </GateShell>
  );
}

function VaultUnlock() {
  const { colors } = useTheme();
  const { unlock, unlockWithDevice, easyUnlockEnabled, appLocked, resetVault } = useSecurity();
  const { error, busy, run } = useRunner();
  const [password, setPassword] = useState("");
  const [resetting, setResetting] = useState(false);
  const prompted = useRef(false);

  // With easy unlock, offer the biometric prompt right away (unless the app lock is already doing so).
  useEffect(() => {
    if (easyUnlockEnabled && !appLocked && !prompted.current) {
      prompted.current = true;
      run(unlockWithDevice);
    }
  }, [easyUnlockEnabled, appLocked]);

  if (resetting) {
    return (
      <GateShell
        icon={<KeyRound size={24} color={colors.brand600} />}
        title="Reset master password"
        subtitle="Your master password can't be recovered. Resetting creates a new vault — you'll regain encrypted payees and notes once another family member opens the app and re-shares the family key."
      >
        <NewMasterPasswordForm submitLabel="Reset and continue" busy={busy} onSubmit={(pw) => run(() => resetVault(pw), "Unable to reset")} />
        <ErrorText>{error}</ErrorText>
        <Button title="Back" variant="ghost" onPress={() => setResetting(false)} />
      </GateShell>
    );
  }

  return (
    <GateShell icon={<ShieldCheck size={24} color={colors.brand600} />} title="Unlock your vault" subtitle="Payees and notes are end-to-end encrypted. Enter your master password to read them on this phone.">
      <Field label="Master password">
        <Input secureTextEntry autoFocus={!easyUnlockEnabled} value={password} onChangeText={setPassword} onSubmitEditing={() => run(() => unlock(password))} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button title="Unlock" size="lg" loading={busy} disabled={!password} onPress={() => run(() => unlock(password))} />
      {easyUnlockEnabled && (
        <Button title="Use fingerprint or face" variant="secondary" icon={<Fingerprint size={16} color={colors.ink} />} disabled={busy} onPress={() => run(unlockWithDevice)} />
      )}
      <Pressable onPress={() => setResetting(true)} style={{ alignSelf: "center", padding: 8 }}>
        <Text style={{ color: colors.brand600, fontWeight: "700", fontSize: 13 }}>Forgot master password?</Text>
      </Pressable>
    </GateShell>
  );
}

export function NewMasterPasswordForm({ submitLabel, onSubmit, busy }: { submitLabel: string; onSubmit: (password: string) => void; busy: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (password.length < 10) return setError("Use at least 10 characters");
    if (password !== confirm) return setError("Passwords don't match");
    setError(null);
    onSubmit(password);
  }

  return (
    <View style={{ gap: 14 }}>
      <Field label="Master password" hint="At least 10 characters. It never leaves this device and can't be recovered.">
        <Input secureTextEntry value={password} onChangeText={setPassword} />
      </Field>
      <Field label="Confirm master password">
        <Input secureTextEntry value={confirm} onChangeText={setConfirm} onSubmitEditing={submit} />
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button title={submitLabel} size="lg" loading={busy} onPress={submit} />
    </View>
  );
}

function VaultSetup() {
  const { colors } = useTheme();
  const { setupVault, skipSetup } = useSecurity();
  const { error, busy, run } = useRunner();

  return (
    <GateShell
      icon={<ShieldCheck size={24} color={colors.brand600} />}
      title="Set up your master password"
      subtitle="Your family turned on end-to-end encryption. Create a master password to receive the family key — a member who has it shares it with you the next time they open the app."
    >
      <NewMasterPasswordForm submitLabel="Create vault" busy={busy} onSubmit={(pw) => run(() => setupVault(pw), "Unable to create vault")} />
      <ErrorText>{error}</ErrorText>
      <Button title="Not now" variant="ghost" onPress={skipSetup} />
    </GateShell>
  );
}
