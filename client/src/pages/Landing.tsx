import { Navigate, Link } from "react-router-dom";
import {
  ArrowRight,
  Layers,
  PieChart,
  PiggyBank,
  ShieldCheck,
  Smartphone,
  Target,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button, Card } from "../components/ui";
import { Logo, LogoLockup } from "../components/Logo";

const FEATURES = [
  {
    icon: Users,
    title: "Shared and private, side by side",
    body: "Common household accounts sit next to accounts only you can see — one balance sheet, two levels of privacy.",
  },
  {
    icon: PieChart,
    title: "Every rupee accounted for",
    body: "Daily, calendar, monthly and total views over the same ledger, so nothing slips through unnoticed.",
  },
  {
    icon: PiggyBank,
    title: "Budgets that track themselves",
    body: "Set a monthly limit per category and watch it fill up automatically as transactions come in.",
  },
  {
    icon: Target,
    title: "Savings goals, together",
    body: "Set a target — a vacation, an emergency fund — and let any family member chip in toward it.",
  },
  {
    icon: ShieldCheck,
    title: "Roles that actually mean something",
    body: "Admins, members and viewers get exactly the reach they should — enforced on the server, not just hidden in the UI.",
  },
  {
    icon: Smartphone,
    title: "One app, every device",
    body: "An installable web app and a native Android build, both talking to the same account in real time.",
  },
];

const STEPS = [
  {
    title: "Create your family",
    body: "Set up a workspace in seconds, with a starter set of income and expense categories.",
  },
  {
    title: "Invite your household",
    body: "Bring in the rest of the family with a role that fits — Admin, Member, or Viewer.",
  },
  {
    title: "Track, budget, save",
    body: "Log transactions, set budgets, and put money toward shared goals — all from one ledger.",
  },
];

export function Landing() {
  const { user, isLoading } = useAuth();

  if (isLoading) return null;
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-dvh">
      {/* -------------------------------------------------------------- Nav */}
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/70 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6 lg:px-8">
          <LogoLockup size={34} />
          <div className="flex items-center gap-2">
            <Link to="/login">
              <Button variant="ghost" size="sm">
                Sign in
              </Button>
            </Link>
            <Link to="/register">
              <Button size="sm" icon={<ArrowRight size={14} />}>
                Get started
              </Button>
            </Link>
          </div>
        </div>
      </header>

      {/* -------------------------------------------------------------- Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-16">
          <div className="animate-rise-in">
            <p className="text-2xs font-semibold uppercase tracking-[0.18em] text-brand-600">
              Family Finance
            </p>
            <h1 className="mt-4 text-[2.25rem] font-extrabold leading-[1.08] tracking-tight text-ink sm:text-5xl">
              One ledger for the whole household.{" "}
              <span className="brand-text-gradient">Privacy where it matters.</span>
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-ink-muted">
              Track shared and private accounts, split spending by category, budget without the
              spreadsheet, and save toward goals together — on the web or on your phone.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/register">
                <Button size="lg" icon={<ArrowRight size={16} />}>
                  Get started free
                </Button>
              </Link>
              <Link to="/login">
                <Button variant="outline" size="lg">
                  Sign in
                </Button>
              </Link>
            </div>
            <p className="mt-5 text-xs text-ink-subtle">
              No credit card. Set up your family workspace in under a minute.
            </p>
          </div>

          <div className="glass ring-gradient relative overflow-hidden rounded-4xl p-6 sm:p-8">
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Logo size={28} />
                <span className="text-sm font-bold text-ink">Overview</span>
              </div>
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-2xs font-semibold text-brand-600">
                The Smiths
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "Net worth", value: "$18,240", tone: "text-ink" },
                { label: "Spent this month", value: "$2,145", tone: "text-expense" },
              ].map((tile) => (
                <div key={tile.label} className="rounded-2xl bg-surface-sunken/60 p-4">
                  <p className="text-2xs font-medium text-ink-subtle">{tile.label}</p>
                  <p className={`mt-1.5 text-lg font-bold tnum ${tile.tone}`}>{tile.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl bg-surface-sunken/60 p-4">
              <p className="mb-3 text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
                Savings goal
              </p>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="font-semibold text-ink">Family vacation</span>
                <span className="text-ink-subtle">72%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface">
                <div className="brand-gradient h-full w-[72%] rounded-full" />
              </div>
            </div>

            <div className="mt-4 space-y-2.5 rounded-2xl bg-surface-sunken/60 p-4">
              {[
                { name: "Groceries", amount: "-$86.40", color: "#22C55E" },
                { name: "Salary", amount: "+$3,200.00", color: "#0EA5E9" },
              ].map((row) => (
                <div key={row.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 text-ink">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />
                    {row.name}
                  </span>
                  <span className={`tnum font-medium ${row.amount.startsWith("-") ? "text-expense" : "text-income"}`}>
                    {row.amount}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- Features */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
            Everything a household needs to manage money together
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-ink-muted">
            Built for families, not just individuals — with the privacy controls that a shared
            workspace actually needs.
          </p>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <Card key={f.title}>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand-600">
                  <Icon size={18} />
                </span>
                <h3 className="mt-4 text-sm font-bold text-ink">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{f.body}</p>
              </Card>
            );
          })}
        </div>
      </section>

      {/* -------------------------------------------------------------- How it works */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="glass rounded-4xl p-8 sm:p-12">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-2xl font-extrabold tracking-tight text-ink sm:text-3xl">
              Up and running in three steps
            </h2>
          </div>
          <div className="mt-10 grid grid-cols-1 gap-8 sm:grid-cols-3">
            {STEPS.map((step, i) => (
              <div key={step.title}>
                <span className="grid h-9 w-9 place-items-center rounded-full brand-gradient text-sm font-bold text-white">
                  {i + 1}
                </span>
                <h3 className="mt-4 text-sm font-bold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------------------- Platforms */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <Card className="flex flex-col items-center gap-6 text-center sm:flex-row sm:justify-between sm:text-left">
          <div className="flex items-center gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-brand-soft text-brand-600">
              <Layers size={22} />
            </span>
            <div>
              <h3 className="text-base font-bold text-ink">Web, installable app, and Android</h3>
              <p className="mt-1 text-sm text-ink-muted">
                Use it in the browser, install it as a PWA, or grab the native Android build —
                your data stays in sync everywhere.
              </p>
            </div>
          </div>
          <Link to="/register" className="shrink-0">
            <Button icon={<ArrowRight size={16} />}>Create your family workspace</Button>
          </Link>
        </Card>
      </section>

      {/* -------------------------------------------------------------- Footer */}
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-sm text-ink-subtle sm:flex-row sm:px-6 lg:px-8">
          <LogoLockup size={26} />
          <div className="flex items-center gap-5">
            <Link to="/login" className="hover:text-ink">
              Sign in
            </Link>
            <Link to="/register" className="hover:text-ink">
              Create account
            </Link>
            <Link to="/privacy" className="hover:text-ink">
              Privacy
            </Link>
          </div>
          <p>&copy; {new Date().getFullYear()} Family Finance</p>
        </div>
      </footer>
    </div>
  );
}
