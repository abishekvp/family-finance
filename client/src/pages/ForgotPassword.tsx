import { useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { api } from "../api/client";
import { getErrorMessage } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorText, Field, Input, SuccessText } from "../components/ui";

export function ForgotPassword() {
  const { user, completeSignIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [step, setStep] = useState<"email" | "reset">("email");
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? "");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post("/auth/password/forgot", { email });
      setStep("reset");
      setNotice(`If an account exists for ${email}, we've emailed it a 6-digit code.`);
    } catch (err) {
      setError(getErrorMessage(err, "Unable to send the code"));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { data } = await api.post<{ accessToken: string }>("/auth/password/reset", { email, code, password });
      await completeSignIn(data.accessToken);
      navigate("/", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Unable to reset your password"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={step === "email" ? "Forgot your password?" : "Choose a new password"}
      subtitle={
        step === "email"
          ? "Enter your account email and we'll send you a code to reset it."
          : "Enter the code from your email and pick a new password. You'll be signed out everywhere else."
      }
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="font-semibold text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </>
      }
    >
      {step === "email" ? (
        <form onSubmit={sendCode} className="space-y-4">
          <Field label="Email">
            {(props) => (
              <Input {...props} type="email" autoComplete="email" required autoFocus placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Send reset code
          </Button>
        </form>
      ) : (
        <form onSubmit={handleReset} className="space-y-4">
          <SuccessText>{notice}</SuccessText>
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
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              />
            )}
          </Field>
          <Field label="New password" hint="At least 8 characters.">
            {(props) => (
              <Input {...props} type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Field>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" size="lg" className="w-full" loading={busy}>
            Reset password and sign in
          </Button>
          <button type="button" disabled={busy} onClick={() => sendCode()} className="w-full text-center text-xs font-semibold text-brand-600 hover:underline">
            Send a new code
          </button>
        </form>
      )}
    </AuthShell>
  );
}
