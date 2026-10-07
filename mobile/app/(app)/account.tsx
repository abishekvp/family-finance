import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Fingerprint, KeyRound, Mail, ShieldCheck, Trash2, UserRound } from "lucide-react-native";
import { api } from "../../src/api/client";
import { getErrorMessage } from "../../src/api/errors";
import { useAuth } from "../../src/context/AuthContext";
import { useSecurity } from "../../src/context/SecurityContext";
import { useTheme } from "../../src/context/ThemeContext";
import { passkeysSupported, registerPasskey, type PasskeySummary } from "../../src/lib/passkeys";
import { Badge, Button, Card, CardHeader, ErrorText, Field, Input, SuccessText, Toggle } from "../../src/components/ui";
import { NewMasterPasswordForm } from "../../src/components/SecurityGate";

function useRunner() {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>, success?: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      if (success) setNotice(success);
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }
  return { error, notice, busy, run };
}

function confirm(title: string, message: string, destructiveLabel: string): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: destructiveLabel, style: "destructive", onPress: () => resolve(true) },
    ])
  );
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink, marginBottom: 4 }}>{title}</Text>
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>{description}</Text>
      </View>
      {children}
    </View>
  );
}

export default function Account() {
  const { colors } = useTheme();
  return (
    <ScrollView style={{ backgroundColor: colors.canvas }} contentContainerStyle={{ padding: 16, gap: 16 }} keyboardShouldPersistTaps="handled">
      <ProfileCard />
      <EmailCard />
      <SignInSecurityCard />
      <EncryptionCard />
      <DeleteAccountCard />
    </ScrollView>
  );
}

// --------------------------------------------------------------------------- delete account

function DeleteAccountCard() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const { error, busy, run } = useRunner();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState("");
  const usesPassword = user!.hasPassword;
  const ready = usesPassword ? secret.length > 0 : secret.trim().toLowerCase() === user!.email.toLowerCase();

  function handleDelete() {
    run(async () => {
      const sure = await confirm(
        "Delete your account?",
        "This permanently deletes your account and your personal data. It can't be undone.",
        "Delete for good"
      );
      if (!sure) return;
      await api.delete("/auth/me", { data: usesPassword ? { password: secret } : { confirmEmail: secret.trim() } });
      await logout();
    });
  }

  return (
    <Card>
      <CardHeader title="Delete account" subtitle="Permanently remove your account and data" icon={<Trash2 size={16} color={colors.expense} />} />
      <View style={{ gap: 12 }}>
        <Text style={{ fontSize: 12.5, color: colors.inkMuted, lineHeight: 18 }}>
          Your sign-in, personal accounts, personal budgets and everything recorded on them are deleted. A family where you're the only
          member is deleted with you. In a family you share, what's on family accounts stays with the family, and the longest-standing
          member becomes admin if no one else is.
        </Text>
        {open ? (
          <>
            <Field label={usesPassword ? "Your password" : `Type ${user!.email} to confirm`}>
              <Input
                value={secret}
                onChangeText={setSecret}
                secureTextEntry={usesPassword}
                autoCapitalize="none"
                autoCorrect={false}
                placeholder={usesPassword ? "Password" : user!.email}
              />
            </Field>
            <ErrorText>{error}</ErrorText>
            <View style={{ flexDirection: "row", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button title="Delete permanently" variant="danger" loading={busy} disabled={!ready} onPress={handleDelete} />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Cancel"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    setOpen(false);
                    setSecret("");
                  }}
                />
              </View>
            </View>
          </>
        ) : (
          <Button title="Delete my account" variant="ghost" icon={<Trash2 size={15} color={colors.expense} />} onPress={() => setOpen(true)} />
        )}
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------------------- profile

function ProfileCard() {
  const { user, refreshUser } = useAuth();
  const { colors } = useTheme();
  const { error, notice, busy, run } = useRunner();
  const [firstName, setFirstName] = useState(user!.firstName);
  const [lastName, setLastName] = useState(user!.lastName);
  const dirty = firstName.trim() !== user!.firstName || lastName.trim() !== user!.lastName;

  return (
    <Card>
      <CardHeader title="Profile" subtitle="How you appear to your family" icon={<UserRound size={16} color={colors.brand600} />} />
      <View style={{ gap: 14 }}>
        <Field label="First name">
          <Input value={firstName} onChangeText={setFirstName} maxLength={60} autoComplete="given-name" />
        </Field>
        <Field label="Last name">
          <Input value={lastName} onChangeText={setLastName} maxLength={60} autoComplete="family-name" />
        </Field>
        <ErrorText>{error}</ErrorText>
        <SuccessText>{notice}</SuccessText>
        <Button
          title="Save changes"
          loading={busy}
          disabled={!dirty || !firstName.trim()}
          onPress={() =>
            run(async () => {
              await api.patch("/auth/me", { firstName, lastName });
              await refreshUser();
            }, "Profile updated.")
          }
        />
      </View>
    </Card>
  );
}

// ------------------------------------------------------------------------------------ email

type EmailStep = "idle" | "password" | "currentCode" | "newEmail" | "newCode";

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="6-digit code">
      <Input
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        autoFocus
        maxLength={6}
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, ""))}
        placeholder="123456"
        style={{ letterSpacing: 6 }}
      />
    </Field>
  );
}

function EmailCard() {
  const { user, refreshUser } = useAuth();
  const { colors } = useTheme();
  const { error, notice, busy, run } = useRunner();
  const [step, setStep] = useState<EmailStep>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [newEmail, setNewEmail] = useState("");

  function reset() {
    setStep("idle");
    setPassword("");
    setCode("");
    setToken("");
    setNewEmail("");
  }

  const steps: Record<Exclude<EmailStep, "idle">, { label: string; body: ReactNode; submit: string; ready: boolean; action: () => Promise<void> }> = {
    password: {
      label: "Confirm your password to continue.",
      submit: "Continue",
      ready: password.length > 0,
      body: (
        <Field label="Current password">
          <Input secureTextEntry autoFocus value={password} onChangeText={setPassword} />
        </Field>
      ),
      action: async () => {
        await api.post("/auth/me/email/start", { password });
        setPassword("");
        setStep("currentCode");
      },
    },
    currentCode: {
      label: `We sent a code to ${user!.email}.`,
      submit: "Verify",
      ready: code.length === 6,
      body: <CodeInput value={code} onChange={setCode} />,
      action: async () => {
        const res = await api.post<{ token: string }>("/auth/me/email/verify-current", { code });
        setToken(res.data.token);
        setCode("");
        setStep("newEmail");
      },
    },
    newEmail: {
      label: "Enter the new address. We'll send a code there to confirm it.",
      submit: "Send code",
      ready: newEmail.includes("@"),
      body: (
        <Field label="New email">
          <Input autoCapitalize="none" keyboardType="email-address" autoFocus value={newEmail} onChangeText={setNewEmail} />
        </Field>
      ),
      action: async () => {
        await api.post("/auth/me/email/request-new", { token, newEmail: newEmail.trim() });
        setStep("newCode");
      },
    },
    newCode: {
      label: `We sent a code to ${newEmail.trim()}.`,
      submit: "Update email",
      ready: code.length === 6,
      body: <CodeInput value={code} onChange={setCode} />,
      action: async () => {
        await api.post("/auth/me/email/confirm-new", { token, newEmail: newEmail.trim(), code });
        await refreshUser();
        reset();
      },
    },
  };

  const current = step === "idle" ? null : steps[step];

  return (
    <Card>
      <CardHeader
        title="Email"
        subtitle={user!.email}
        icon={<Mail size={16} color={colors.brand600} />}
        action={step === "idle" ? <Button title="Change" size="sm" variant="secondary" onPress={() => setStep("password")} /> : undefined}
      />
      {current && (
        <View style={{ gap: 14 }}>
          <Text style={{ color: colors.inkMuted, fontSize: 13 }}>{current.label}</Text>
          {current.body}
          <ErrorText>{error}</ErrorText>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Button title={current.submit} loading={busy} disabled={!current.ready} onPress={() => run(current.action, step === "newCode" ? "Email updated." : undefined)} />
            <Button title="Cancel" variant="ghost" onPress={reset} />
          </View>
        </View>
      )}
      {step === "idle" && <SuccessText>{notice}</SuccessText>}
      {!user!.hasPassword && step === "idle" && (
        <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>
          You sign in with Google or Microsoft. To change your email, first create a password with “Forgot password” on the sign-in screen.
        </Text>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ passkeys + app lock

function SignInSecurityCard() {
  const { colors } = useTheme();
  const { appLockEnabled, enableAppLock, disableAppLock } = useSecurity();
  const { error, notice, busy, run } = useRunner();
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const supported = passkeysSupported();

  const load = useCallback(async () => {
    const res = await api.get<PasskeySummary[]>("/auth/passkeys");
    setPasskeys(res.data);
  }, []);

  useEffect(() => {
    load().catch(() => setPasskeys([]));
  }, [load]);

  return (
    <Card>
      <CardHeader title="Passkeys & app lock" subtitle="Fingerprint, face, or screen lock" icon={<Fingerprint size={16} color={colors.brand600} />} />
      <View style={{ gap: 16 }}>
        <SettingRow title="App lock" description="Ask for your fingerprint, face or screen lock when the app opens or after a minute away.">
          <Toggle
            value={appLockEnabled}
            disabled={busy}
            onChange={(next) => run(next ? enableAppLock : disableAppLock, next ? "App lock is on." : undefined)}
          />
        </SettingRow>

        <View style={{ height: 1, backgroundColor: colors.line }} />

        <Text style={{ fontSize: 13, fontWeight: "700", color: colors.ink }}>Passkeys</Text>
        {passkeys?.length === 0 && (
          <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>No passkeys yet. Add one to sign in without a password.</Text>
        )}
        {passkeys?.map((p) => (
          <View key={p.id} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <KeyRound size={16} color={colors.brand600} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.ink, fontWeight: "600", fontSize: 14 }}>{p.name}</Text>
              <Text style={{ color: colors.inkSubtle, fontSize: 11.5 }}>Added {new Date(p.createdAt).toLocaleDateString()}</Text>
            </View>
            {p.backedUp && <Badge tone="info">Synced</Badge>}
            <Pressable
              hitSlop={8}
              onPress={() =>
                run(async () => {
                  if (!(await confirm("Remove passkey?", `You won't be able to sign in with “${p.name}” any more.`, "Remove"))) return;
                  await api.delete(`/auth/passkeys/${p.id}`);
                  await load();
                })
              }
            >
              <Trash2 size={17} color={colors.expense} />
            </Pressable>
          </View>
        ))}
        {supported ? (
          <Button
            title="Add a passkey"
            variant="secondary"
            icon={<KeyRound size={16} color={colors.ink} />}
            loading={busy}
            onPress={() =>
              run(async () => {
                await registerPasskey();
                await load();
              }, "Passkey added.")
            }
          />
        ) : (
          <Text style={{ color: colors.inkSubtle, fontSize: 12 }}>This phone doesn't support passkeys.</Text>
        )}
        <ErrorText>{error}</ErrorText>
        <SuccessText>{notice}</SuccessText>
      </View>
    </Card>
  );
}

// -------------------------------------------------------------------------------- encryption

function EncryptionCard() {
  const { user } = useAuth();
  const { colors } = useTheme();
  const security = useSecurity();
  const { error, notice, busy, run } = useRunner();
  const family = user!.families[0];
  const isAdmin = family?.role === "ADMIN";
  const [mode, setMode] = useState<"idle" | "setup" | "change">("idle");
  const [currentPassword, setCurrentPassword] = useState("");

  const hasVault = security.status === "unlocked" || security.status === "locked";
  const enc = security.familyEncryption;
  const familyEncrypted = enc?.enabled ?? family?.encryptionEnabled ?? false;

  return (
    <Card>
      <CardHeader
        title="End-to-end encryption"
        subtitle="Zero-knowledge protection for payees and notes"
        icon={<ShieldCheck size={16} color={colors.brand600} />}
        action={<Badge tone={familyEncrypted ? "income" : "neutral"}>{familyEncrypted ? "On" : "Off"}</Badge>}
      />
      <View style={{ gap: 16 }}>
        <Text style={{ color: colors.inkMuted, fontSize: 13, lineHeight: 19 }}>
          With a master password, payees and notes are encrypted on your phone before they're saved — the server only ever sees ciphertext.
          Amounts, dates and categories stay readable so balances and budgets keep working. You'll be asked for it each time you sign in,
          unless you turn on easy unlock.
        </Text>

        {!hasVault && mode !== "setup" && (
          <Button title="Set up master password" icon={<KeyRound size={16} color="#fff" />} onPress={() => setMode("setup")} />
        )}
        {!hasVault && mode === "setup" && (
          <NewMasterPasswordForm
            submitLabel="Create vault"
            busy={busy}
            onSubmit={(pw) =>
              run(async () => {
                await security.setupVault(pw);
                setMode("idle");
              }, "Vault created.")
            }
          />
        )}

        {security.status === "unlocked" && (
          <>
            {security.awaitingAccess && (
              <Text style={{ color: colors.warn, fontSize: 13 }}>
                Your family's key hasn't been shared with you yet. It will be the next time another member opens the app.
              </Text>
            )}
            {security.progress && <Text style={{ color: colors.brand600, fontWeight: "700", fontSize: 13 }}>{security.progress}</Text>}

            {isAdmin && (
              <SettingRow title="Encrypt this family's data" description="Existing transactions are encrypted in the background. Members get the key once they set up a master password.">
                <Toggle
                  value={familyEncrypted}
                  disabled={busy || (familyEncrypted && !enc?.wrappedKey)}
                  onChange={(next) =>
                    run(async () => {
                      if (next) return security.enableFamilyEncryption();
                      if (await confirm("Turn off encryption?", "Every payee and note will be decrypted and stored in plaintext again.", "Turn off")) {
                        await security.disableFamilyEncryption();
                      }
                    })
                  }
                />
              </SettingRow>
            )}

            {familyEncrypted && enc && (
              <View style={{ gap: 8 }}>
                {enc.members.map((m) => (
                  <View key={m.userId} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                    <Text style={{ color: colors.ink, fontSize: 13 }}>{m.name}</Text>
                    {m.hasKey ? <Badge tone="income">Has key</Badge> : m.publicKey ? <Badge tone="warn">Waiting</Badge> : <Badge>No vault</Badge>}
                  </View>
                ))}
              </View>
            )}

            <SettingRow title="Easy unlock" description="Skip the master password — your fingerprint or face unlocks the vault key kept in this phone's secure hardware.">
              <Toggle
                value={security.easyUnlockEnabled}
                disabled={busy}
                onChange={(next) => run(next ? security.enableEasyUnlock : security.disableEasyUnlock, next ? "Easy unlock is on." : undefined)}
              />
            </SettingRow>

            {mode === "change" ? (
              <View style={{ gap: 14 }}>
                <Field label="Current master password">
                  <Input secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} />
                </Field>
                <NewMasterPasswordForm
                  submitLabel="Change master password"
                  busy={busy}
                  onSubmit={(pw) =>
                    run(async () => {
                      await security.changeMasterPassword(currentPassword, pw);
                      setCurrentPassword("");
                      setMode("idle");
                    }, "Master password changed.")
                  }
                />
                <Button title="Cancel" variant="ghost" onPress={() => setMode("idle")} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <Button title="Change master password" size="sm" variant="secondary" onPress={() => setMode("change")} />
                {!familyEncrypted && (
                  <Button
                    title="Remove vault"
                    size="sm"
                    variant="ghost"
                    onPress={() =>
                      run(async () => {
                        if (await confirm("Remove vault?", "Your master password and vault will be deleted.", "Remove")) await security.removeVault();
                      })
                    }
                  />
                )}
              </View>
            )}
          </>
        )}

        <ErrorText>{error}</ErrorText>
        <SuccessText>{notice}</SuccessText>
      </View>
    </Card>
  );
}
