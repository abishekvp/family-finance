import { useState, type FormEvent, type ReactNode } from "react";
import { Fingerprint, KeyRound, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useSecurity } from "../context/SecurityContext";
import { getErrorMessage } from "../api/errors";
import { Button, ErrorText, Field, Input } from "./ui";
import { Logo, LogoLockup } from "./Logo";

/**
 * Sits between "signed in" and the app: the device screen lock first, then the zero-knowledge
 * vault (unlock, or one-time setup when the family already uses encryption).
 */
export function SecurityGate({ children }: { children: ReactNode }) {
  const security = useSecurity();

  if (security.status === "loading") {
    return (
      <div className="flex h-dvh items-center justify-center">
        <Logo size={44} className="animate-pulse" />
      </div>
    );
  }
  if (security.screenLocked) return <ScreenLock />;
  if (security.status === "locked") return <VaultUnlock />;
  if (security.status === "setup" && !security.setupSkipped) return <VaultSetup />;
  return <>{children}</>;
}

function GateShell({ icon, title, subtitle, children }: { icon: ReactNode; title: string; subtitle: string; children: ReactNode }) {
  const { user, logout } = useAuth();
  return (
    <div className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="glass w-full max-w-[26rem] animate-rise-in rounded-3xl p-7 sm:p-8">
        <LogoLockup className="mb-7" />
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-600">{icon}</span>
        <h1 className="mt-4 text-xl font-extrabold tracking-tight text-ink">{title}</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{subtitle}</p>
        <div className="mt-6">{children}</div>
        <div className="mt-6 flex items-center justify-between border-t border-line pt-4 text-xs text-ink-subtle">
          <span className="truncate">{user?.email}</span>
          <button type="button" onClick={() => logout()} className="inline-flex items-center gap-1.5 font-semibold hover:text-ink">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function ScreenLock() {
  const { unlockWithPasskey } = useSecurity();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    setError(null);
    setBusy(true);
    try {
      await unlockWithPasskey();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to unlock"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GateShell icon={<LockKeyhole size={22} />} title="Family Finance is locked" subtitle="Unlock with your fingerprint, face, or device PIN.">
      <Button size="lg" className="w-full" icon={<Fingerprint size={18} />} loading={busy} onClick={handleUnlock} autoFocus>
        Unlock
      </Button>
      <div className="mt-3">
        <ErrorText>{error}</ErrorText>
      </div>
    </GateShell>
  );
}

function PasswordInput({ value, onChange, autoFocus, autoComplete = "current-password" }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; autoComplete?: string }) {
  return (
    <Field label="Master password">
      {(props) => (
        <Input {...props} type="password" autoComplete={autoComplete} required autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

function VaultUnlock() {
  const { unlock, unlockWithPasskey, easyUnlockEnabled, resetVault } = useSecurity();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);

  async function run(fn: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(getErrorMessage(err, "Unable to unlock"));
    } finally {
      setBusy(false);
    }
  }

  if (resetting) {
    return (
      <GateShell
        icon={<KeyRound size={22} />}
        title="Reset master password"
        subtitle="Your master password can't be recovered. Resetting creates a new vault: you'll lose access to encrypted payees and notes until another family member opens the app, which re-shares the family key with you automatically."
      >
        <NewMasterPasswordForm submitLabel="Reset and continue" onSubmit={(pw) => run(() => resetVault(pw))} busy={busy} />
        <ErrorText>{error}</ErrorText>
        <Button variant="ghost" className="mt-2 w-full" onClick={() => setResetting(false)}>
          Back
        </Button>
      </GateShell>
    );
  }

  return (
    <GateShell icon={<ShieldCheck size={22} />} title="Unlock your vault" subtitle="Your payees and notes are end-to-end encrypted. Enter your master password to read them on this device.">
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          run(() => unlock(password));
        }}
        className="space-y-4"
      >
        <PasswordInput value={password} onChange={setPassword} autoFocus />
        <ErrorText>{error}</ErrorText>
        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Unlock
        </Button>
      </form>
      {easyUnlockEnabled && (
        <Button variant="secondary" className="mt-3 w-full" icon={<Fingerprint size={16} />} disabled={busy} onClick={() => run(unlockWithPasskey)}>
          Unlock with passkey
        </Button>
      )}
      <button type="button" onClick={() => setResetting(true)} className="mt-4 w-full text-center text-xs font-semibold text-brand-600 hover:underline">
        Forgot master password?
      </button>
    </GateShell>
  );
}

export function NewMasterPasswordForm({ submitLabel, onSubmit, busy }: { submitLabel: string; onSubmit: (password: string) => void; busy: boolean }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (password.length < 10) return setError("Use at least 10 characters");
        if (password !== confirm) return setError("Passwords don't match");
        setError(null);
        onSubmit(password);
      }}
    >
      <Field label="Master password" hint="At least 10 characters. It never leaves this device and can't be recovered.">
        {(props) => <Input {...props} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Field label="Confirm master password">
        {(props) => <Input {...props} type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {submitLabel}
      </Button>
    </form>
  );
}

function VaultSetup() {
  const { setupVault, skipSetup } = useSecurity();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <GateShell
      icon={<ShieldCheck size={22} />}
      title="Set up your master password"
      subtitle="Your family turned on end-to-end encryption. Create a master password to receive the family key — a member who already has it shares it with you the next time they open the app."
    >
      <NewMasterPasswordForm
        submitLabel="Create vault"
        busy={busy}
        onSubmit={async (pw) => {
          setError(null);
          setBusy(true);
          try {
            await setupVault(pw);
          } catch (err) {
            setError(getErrorMessage(err, "Unable to create vault"));
          } finally {
            setBusy(false);
          }
        }}
      />
      <ErrorText>{error}</ErrorText>
      <Button variant="ghost" className="mt-2 w-full" onClick={skipSetup}>
        Not now
      </Button>
    </GateShell>
  );
}
