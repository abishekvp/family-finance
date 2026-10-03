import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorText, Field, Input, ProgressBar } from "../components/ui";
import { SocialSignIn } from "../components/SocialSignIn";
import { FullPageLoader } from "../components/FullPageLoader";

function scorePassword(password: string) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  return Math.min(score, 4);
}

const STRENGTH = [
  { label: "Too short", tone: "expense" as const },
  { label: "Weak", tone: "expense" as const },
  { label: "Fair", tone: "warn" as const },
  { label: "Good", tone: "brand" as const },
  { label: "Strong", tone: "income" as const },
];

export function Register() {
  const { user, isLoading, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const strength = useMemo(() => scorePassword(password), [password]);

  if (isLoading) return <FullPageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await register(name, email, password);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create account"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start managing your family's finances together."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-brand-600 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Name">
          {(props) => <Input {...props} required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jamie Lee" />}
        </Field>

        <Field label="Email">
          {(props) => (
            <Input
              {...props}
              type="email"
              autoComplete="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
        </Field>

        <Field label="Password">
          {(props) => (
            <div>
              <div className="relative">
                <Input
                  {...props}
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  placeholder="••••••••"
                  className="pr-11"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-subtle transition hover:bg-surface-sunken hover:text-ink"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {password.length > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <ProgressBar value={strength / 4} tone={STRENGTH[strength].tone} className="flex-1" />
                  <span className="w-12 shrink-0 text-2xs font-semibold text-ink-subtle">
                    {STRENGTH[strength].label}
                  </span>
                </div>
              )}
              <p className="mt-1.5 text-xs text-ink-subtle">At least 8 characters.</p>
            </div>
          )}
        </Field>

        <ErrorText>{error}</ErrorText>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <div className="mt-6">
        <SocialSignIn onSignedIn={() => navigate("/dashboard", { replace: true })} />
      </div>
    </AuthShell>
  );
}
