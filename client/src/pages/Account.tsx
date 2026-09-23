import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Fingerprint, KeyRound, Mail, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import { useAuth } from "../context/AuthContext";
import { useSecurity } from "../context/SecurityContext";
import { passkeysSupported, registerPasskey, type PasskeySummary } from "../lib/passkeys";
import { Badge, Button, Card, CardHeader, ErrorText, Field, IconButton, Input, SuccessText, Toggle, useToast } from "../components/ui";
import { NewMasterPasswordForm } from "../components/SecurityGate";

export function Account() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <ProfileCard />
      <EmailCard />
      <SignInSecurityCard />
      <EncryptionCard />
    </div>
  );
}

// ---------------------------------------------------------------------------------- profile

function ProfileCard() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [firstName, setFirstName] = useState(user!.firstName);
  const [lastName, setLastName] = useState(user!.lastName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.patch("/auth/me", { firstName, lastName });
      await refreshUser();
      toast("Profile updated");
    } catch (err) {
      setError(getErrorMessage(err, "Unable to update profile"));
    } finally {
      setBusy(false);
    }
  }

  const dirty = firstName.trim() !== user!.firstName || lastName.trim() !== user!.lastName;

  return (
    <Card>
      <CardHeader title="Profile" subtitle="How you appear to your family" icon={<UserRound size={17} />} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">
            {(props) => <Input {...props} required maxLength={60} autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />}
          </Field>
          <Field label="Last name">
            {(props) => <Input {...props} maxLength={60} autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} />}
          </Field>
        </div>
        <ErrorText>{error}</ErrorText>
        <Button type="submit" loading={busy} disabled={!dirty}>
          Save changes
        </Button>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------------------------ email

type EmailStep = "idle" | "password" | "currentCode" | "newEmail" | "newCode";

function CodeInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="6-digit code">
      {(props) => (
        <Input
          {...props}
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          autoFocus
          maxLength={6}
          placeholder="123456"
          className="tracking-[0.4em]"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
        />
      )}
    </Field>
  );
}

function EmailCard() {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [step, setStep] = useState<EmailStep>("idle");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setStep("idle");
    setPassword("");
    setCode("");
    setToken("");
    setNewEmail("");
    setError(null);
  }

  async function run(e: FormEvent, fn: () => Promise<void>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const steps: Record<Exclude<EmailStep, "idle">, { label: string; body: JSX.Element; submit: string; action: () => Promise<void> }> = {
    password: {
      label: "Confirm your password to continue.",
      submit: "Continue",
      body: (
        <Field label="Current password">
          {(props) => <Input {...props} type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
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
      body: <CodeInput value={code} onChange={setCode} />,
      action: async () => {
        const { data } = await api.post<{ token: string }>("/auth/me/email/verify-current", { code });
        setToken(data.token);
        setCode("");
        setStep("newEmail");
      },
    },
    newEmail: {
      label: "Enter the new address. We'll send a code there to confirm it.",
      submit: "Send code",
      body: (
        <Field label="New email">
          {(props) => <Input {...props} type="email" autoComplete="email" required autoFocus value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />}
        </Field>
      ),
      action: async () => {
        await api.post("/auth/me/email/request-new", { token, newEmail });
        setStep("newCode");
      },
    },
    newCode: {
      label: `We sent a code to ${newEmail}.`,
      submit: "Update email",
      body: <CodeInput value={code} onChange={setCode} />,
      action: async () => {
        await api.post("/auth/me/email/confirm-new", { token, newEmail, code });
        await refreshUser();
        toast("Email updated");
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
        icon={<Mail size={17} />}
        actions={
          step === "idle" ? (
            <Button variant="secondary" size="sm" onClick={() => setStep("password")}>
              Change email
            </Button>
          ) : undefined
        }
      />
      {current && (
        <form onSubmit={(e) => run(e, current.action)} className="space-y-4">
          <p className="text-sm text-ink-muted">{current.label}</p>
          {current.body}
          <ErrorText>{error}</ErrorText>
          <div className="flex gap-2">
            <Button type="submit" loading={busy}>
              {current.submit}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {!user!.hasPassword && step === "idle" && (
        <p className="text-xs text-ink-subtle">
          You sign in with Google or Microsoft. To change your email, first create a password with “Forgot password” on the sign-in page.
        </p>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------- passkeys + screen lock

function SignInSecurityCard() {
  const toast = useToast();
  const { screenLockEnabled, enableScreenLock, disableScreenLock } = useSecurity();
  const [passkeys, setPasskeys] = useState<PasskeySummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await api.get<PasskeySummary[]>("/auth/passkeys");
    setPasskeys(data);
  }, []);

  useEffect(() => {
    load().catch(() => setPasskeys([]));
  }, [load]);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title="Passkeys & screen lock"
        subtitle="Sign in and unlock with your fingerprint, face, or device PIN"
        icon={<Fingerprint size={17} />}
        actions={
          passkeysSupported() ? (
            <Button
              size="sm"
              variant="secondary"
              icon={<KeyRound size={14} />}
              loading={busy}
              onClick={() =>
                run(async () => {
                  await registerPasskey();
                  await load();
                  toast("Passkey added");
                })
              }
            >
              Add passkey
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-5">
        {passkeys && passkeys.length === 0 && (
          <p className="text-sm text-ink-muted">No passkeys yet. Add one to sign in without a password on this and your synced devices.</p>
        )}
        {passkeys && passkeys.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {passkeys.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound size={16} className="shrink-0 text-brand-600" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{p.name}</p>
                  <p className="text-xs text-ink-subtle">
                    Added {new Date(p.createdAt).toLocaleDateString()}
                    {p.lastUsedAt ? ` · last used ${new Date(p.lastUsedAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                {p.backedUp && <Badge tone="info">Synced</Badge>}
                <IconButton
                  label="Remove passkey"
                  tone="danger"
                  onClick={() =>
                    run(async () => {
                      if (!window.confirm(`Remove “${p.name}”? You won't be able to sign in with it any more.`)) return;
                      await api.delete(`/auth/passkeys/${p.id}`);
                      await load();
                    })
                  }
                >
                  <Trash2 size={15} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}

        <Toggle
          checked={screenLockEnabled}
          disabled={busy || (!screenLockEnabled && (passkeys?.length ?? 0) === 0)}
          onChange={(next) =>
            run(async () => {
              if (next) {
                await enableScreenLock();
                toast("Screen lock on for this browser");
              } else disableScreenLock();
            })
          }
          label="Screen lock on this browser"
          description={
            (passkeys?.length ?? 0) === 0
              ? "Add a passkey first — it's what unlocks the app."
              : "Ask for your passkey (fingerprint, face or PIN) whenever Family Finance is opened here or left idle for 5 minutes."
          }
        />
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}

// -------------------------------------------------------------------------------- encryption

function EncryptionCard() {
  const { user } = useAuth();
  const security = useSecurity();
  const toast = useToast();
  const family = user!.families[0];
  const isAdmin = family?.role === "ADMIN";
  const [mode, setMode] = useState<"idle" | "setup" | "change">("idle");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<void>, success?: string) {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await fn();
      if (success) toast(success);
    } catch (err) {
      setError(getErrorMessage(err, "Something went wrong"));
    } finally {
      setBusy(false);
    }
  }

  const hasVault = security.status === "unlocked" || security.status === "locked";
  const enc = security.familyEncryption;
  const familyEncrypted = enc?.enabled ?? family?.encryptionEnabled ?? false;

  return (
    <Card>
      <CardHeader
        title="End-to-end encryption"
        subtitle="Zero-knowledge protection for transaction payees and notes"
        icon={<ShieldCheck size={17} />}
        actions={familyEncrypted ? <Badge tone="income">On</Badge> : <Badge>Off</Badge>}
      />

      <div className="space-y-5 text-sm">
        <p className="text-ink-muted">
          With a master password, payees and notes are encrypted on your device before they're saved. The server — and anyone with access to
          it — only ever sees ciphertext. Amounts, dates and categories stay readable so balances and budgets keep working. You'll be asked for
          the master password each time you sign in (or use easy unlock).
        </p>

        {!hasVault && mode !== "setup" && (
          <Button onClick={() => setMode("setup")} icon={<KeyRound size={16} />}>
            Set up master password
          </Button>
        )}

        {!hasVault && mode === "setup" && (
          <div className="max-w-sm">
            <NewMasterPasswordForm
              submitLabel="Create vault"
              busy={busy}
              onSubmit={(pw) =>
                run(async () => {
                  await security.setupVault(pw);
                  setMode("idle");
                }, "Vault created")
              }
            />
          </div>
        )}

        {security.status === "unlocked" && (
          <>
            {security.awaitingAccess && (
              <p className="rounded-xl bg-warn-soft px-3.5 py-2.5 text-warn">
                Your family's key hasn't been shared with you yet. It will be the next time another family member opens the app.
              </p>
            )}

            {security.progress && <p className="font-medium text-brand-600">{security.progress}</p>}

            {isAdmin && (
              <Toggle
                checked={familyEncrypted}
                disabled={busy || (familyEncrypted && !enc?.wrappedKey)}
                onChange={(next) => {
                  if (next) {
                    run(security.enableFamilyEncryption, "Family encryption is on");
                  } else if (window.confirm("Decrypt every payee and note and store them in plaintext again?")) {
                    run(security.disableFamilyEncryption, "Family encryption is off");
                  }
                }}
                label="Encrypt this family's payees and notes"
                description="Existing transactions are encrypted in the background. Members get the key once they set up their own master password."
              />
            )}

            {familyEncrypted && enc && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">Members</p>
                <ul className="space-y-1.5">
                  {enc.members.map((m) => (
                    <li key={m.userId} className="flex items-center justify-between gap-3">
                      <span className="text-ink">{m.name}</span>
                      {m.hasKey ? <Badge tone="income">Has key</Badge> : m.publicKey ? <Badge tone="warn">Waiting</Badge> : <Badge>No vault</Badge>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Toggle
              checked={security.easyUnlockEnabled}
              disabled={busy}
              onChange={(next) =>
                next ? run(security.enableEasyUnlock, "Easy unlock is on for this browser") : security.disableEasyUnlock()
              }
              label="Easy unlock on this browser"
              description="Skip typing the master password: a passkey on this device derives a key that unlocks your vault (needs WebAuthn PRF support)."
            />

            {mode === "change" ? (
              <div className="max-w-sm space-y-4">
                <Field label="Current master password">
                  {(props) => <Input {...props} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />}
                </Field>
                <NewMasterPasswordForm
                  submitLabel="Change master password"
                  busy={busy}
                  onSubmit={(pw) =>
                    run(async () => {
                      await security.changeMasterPassword(currentPassword, pw);
                      setCurrentPassword("");
                      setMode("idle");
                    }, "Master password changed")
                  }
                />
                <Button variant="ghost" onClick={() => setMode("idle")}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setMode("change")}>
                  Change master password
                </Button>
                {!familyEncrypted && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (window.confirm("Remove your master password and vault?")) run(security.removeVault, "Vault removed");
                    }}
                  >
                    Remove vault
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        <SuccessText>{notice}</SuccessText>
        <ErrorText>{error}</ErrorText>
      </div>
    </Card>
  );
}
