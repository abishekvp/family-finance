import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { AuthShell } from "../components/AuthShell";
import { Button, ErrorText, Field, Input, Select } from "../components/ui";

const CURRENCIES = [
  { code: "USD", name: "US Dollar" },
  { code: "EUR", name: "Euro" },
  { code: "GBP", name: "British Pound" },
  { code: "INR", name: "Indian Rupee" },
  { code: "CAD", name: "Canadian Dollar" },
  { code: "AUD", name: "Australian Dollar" },
];

export function Onboarding() {
  const { refreshUser } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      await api.post("/families", { name, currency });
      await refreshUser();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(getErrorMessage(err, "Unable to create family"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <AuthShell
      title="Create your family workspace"
      subtitle="This is where your household's shared accounts, budgets and categories will live. You can invite other members once it's set up."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Family name">
          {(props) => (
            <Input {...props} placeholder="The Smiths" required value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>

        <Field label="Default currency">
          {(props) => (
            <Select {...props} value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <div className="flex items-start gap-2.5 rounded-xl bg-brand-soft px-3.5 py-3 text-xs text-ink-muted">
          <Sparkles size={15} className="mt-0.5 shrink-0 text-brand-600" />
          <span>We'll set you up with a starter set of income and expense categories — edit or remove them anytime.</span>
        </div>

        <ErrorText>{error}</ErrorText>

        <Button type="submit" size="lg" className="w-full" loading={isSubmitting}>
          {isSubmitting ? "Creating…" : "Create family"}
        </Button>
      </form>
    </AuthShell>
  );
}
