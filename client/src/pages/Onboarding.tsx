import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { getErrorMessage } from "../api/errors";
import { Button, Card, ErrorText, Input, Label } from "../components/ui";

const CURRENCIES = ["USD", "EUR", "GBP", "INR", "CAD", "AUD"];

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
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold">Create your family workspace</h1>
        <p className="mb-6 text-sm text-slate-500">
          This is where your household's shared accounts, budgets, and categories will live. You can invite other
          members once it's set up.
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="family-name">Family name</Label>
            <Input
              id="family-name"
              placeholder="The Smiths"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="currency">Default currency</Label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <ErrorText>{error}</ErrorText>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create family"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
