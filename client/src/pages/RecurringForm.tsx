import { useEffect, useState, FormEvent } from "react";
import { useParams, useNavigate, useOutletContext } from "react-router-dom";
import { api } from "../api/client";
import type { RecurringTransaction, Account, Category, Budget, RecurringFrequency } from "../api/types";
import { Button, Card, Field, Input, Select, ErrorText, Toggle } from "../components/ui";
import type { LayoutContext } from "../components/Layout";

export function RecurringForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== "new";
  const { family } = useOutletContext<LayoutContext>();
  const navigate = useNavigate();

  const [type, setType] = useState<"EXPENSE" | "INCOME">("EXPENSE");
  const [amount, setAmount] = useState("");
  const [payee, setPayee] = useState("");
  const [frequency, setFrequency] = useState<RecurringFrequency>("MONTHLY");
  const [day, setDay] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [notes, setNotes] = useState("");
  const [isActive, setIsActive] = useState(true);
  
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<Account[]>(`/families/${family.id}/accounts`),
      api.get<Category[]>(`/families/${family.id}/categories`)
    ]).then(([accRes, catRes]) => {
      setAccounts(accRes.data.filter(a => a.type !== "PERSON"));
      setCategories(catRes.data);
      if (accRes.data.length > 0 && !accountId) setAccountId(accRes.data[0].id);
    });

    if (isEdit && id) {
      api.get<RecurringTransaction[]>(`/families/${family.id}/recurring`)
        .then(res => {
          const rule = res.data.find(r => r.id === id);
          if (rule) {
            setType(rule.type);
            setAmount(String(rule.amount));
            setPayee(rule.payee || "");
            setFrequency(rule.frequency);
            setDay(rule.nextDate);
            setAccountId(rule.accountId);
            setCategoryId(rule.categoryId || "");
            setNotes(rule.notes || "");
            setIsActive(rule.isActive);
          }
        });
    }
  }, [family.id, id, isEdit]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const data = {
        type, amount: Number(amount), accountId, categoryId: categoryId || null,
        payee: payee || null, notes: notes || null, frequency, isActive,
        ...(isEdit ? { nextDate: day } : { startDate: day })
      };
      if (isEdit) {
        await api.patch(`/families/${family.id}/recurring/${id}`, data);
      } else {
        await api.post(`/families/${family.id}/recurring`, data);
      }
      navigate("/recurring");
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <Card>
      <h2 className="text-xl font-bold mb-4">{isEdit ? "Edit" : "New"} Repeating Payment</h2>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="flex gap-4">
          <label><input type="radio" checked={type === "EXPENSE"} onChange={() => setType("EXPENSE")} /> Expense</label>
          <label><input type="radio" checked={type === "INCOME"} onChange={() => setType("INCOME")} /> Income</label>
        </div>
        <Field label="Amount">{(props) => <Input {...props} type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} required />}</Field>
        <Field label="Name">{(props) => <Input {...props} value={payee} onChange={e => setPayee(e.target.value)} required />}</Field>
        <Field label="Notes">{(props) => <Input {...props} value={notes} onChange={e => setNotes(e.target.value)} />}</Field>
        <Field label="Frequency">
          {(props) => (
            <Select {...props} value={frequency} onChange={e => setFrequency(e.target.value as any)}>
              <option value="MONTHLY">Monthly</option>
              <option value="YEARLY">Yearly</option>
              <option value="WEEKLY">Weekly</option>
            </Select>
          )}
        </Field>
        <Field label={isEdit ? "Next Date" : "Start Date"}>{(props) => <Input {...props} type="date" value={day} onChange={e => setDay(e.target.value)} required />}</Field>
        <Field label="Account">
          {(props) => (
            <Select {...props} value={accountId} onChange={e => setAccountId(e.target.value)} required>
              <option value="">Select Account</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Category">
          {(props) => (
            <Select {...props} value={categoryId} onChange={e => setCategoryId(e.target.value)}>
              <option value="">None</option>
              {categories.filter(c => c.type === type).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        {isEdit && <Toggle checked={isActive} onChange={setIsActive} label="Active" />}
        <ErrorText>{error}</ErrorText>
        <div className="flex gap-4 pt-4">
          <Button type="submit">Save</Button>
          <Button type="button" variant="secondary" onClick={() => navigate("/recurring")}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
