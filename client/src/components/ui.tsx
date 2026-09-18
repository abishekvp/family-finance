import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { AlertCircle, Check, ChevronDown, Loader2, X } from "lucide-react";

/** Tiny class joiner — keeps conditional Tailwind strings readable. */
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/* ------------------------------------------------------------------ surfaces */

export function Card({
  children,
  className = "",
  padded = true,
  as: Tag = "div",
  interactive = false,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  as?: "div" | "section" | "article" | "li";
  interactive?: boolean;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag
      className={cn(
        "glass rounded-2xl",
        padded && "p-5 sm:p-6",
        interactive && "transition duration-200 ease-swift hover:-translate-y-0.5 hover:shadow-lift",
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

/** Header row for a card: title on the left, actions on the right, wraps on narrow screens. */
export function CardHeader({
  title,
  subtitle,
  icon,
  actions,
  className = "",
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-5 flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand-600">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-ink sm:text-lg">{title}</h2>
          {subtitle && <p className="mt-0.5 text-sm text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Divider({ className = "" }: { className?: string }) {
  return <hr className={cn("border-0 border-t border-line", className)} />;
}

/* ------------------------------------------------------------------- buttons */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "outline";
type ButtonSize = "sm" | "md" | "lg";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "brand-gradient text-white shadow-glow-sm hover:shadow-glow hover:brightness-[1.06] active:brightness-95",
  secondary:
    "bg-surface-sunken text-ink ring-1 ring-inset ring-line hover:bg-surface-raised hover:ring-line-strong",
  outline: "bg-transparent text-ink ring-1 ring-inset ring-line-strong hover:bg-surface-sunken",
  ghost: "bg-transparent text-ink-muted hover:bg-surface-sunken hover:text-ink",
  danger: "bg-expense text-white shadow-soft hover:brightness-110 active:brightness-95",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-xs",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-12 gap-2 rounded-xl px-6 text-[0.9375rem]",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  loading = false,
  icon,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      className={cn(
        "inline-flex select-none items-center justify-center whitespace-nowrap font-semibold",
        "transition duration-150 ease-swift disabled:pointer-events-none disabled:opacity-50",
        BUTTON_SIZES[size],
        BUTTON_VARIANTS[variant],
        className
      )}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className = "",
  tone = "neutral",
  size = 34,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "neutral" | "danger" | "brand";
  size?: number;
}) {
  const tones = {
    neutral: "text-ink-subtle hover:bg-surface-sunken hover:text-ink",
    brand: "text-brand-600 hover:bg-brand-soft",
    danger: "text-ink-subtle hover:bg-expense-soft hover:text-expense",
  };
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-lg transition duration-150 ease-swift",
        "disabled:pointer-events-none disabled:opacity-40",
        tones[tone],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- inputs */

export function Label({ className = "", ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[0.8125rem] font-medium text-ink-muted", className)}
      {...props}
    />
  );
}

const FIELD_BASE =
  "w-full rounded-xl border border-line bg-surface/70 px-3.5 text-sm text-ink transition duration-150 ease-swift " +
  "placeholder:text-ink-subtle hover:border-line-strong " +
  "focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 " +
  "disabled:cursor-not-allowed disabled:opacity-60";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, "h-11", className)} {...props} />;
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "min-h-[88px] py-2.5 leading-relaxed", className)} {...props} />;
}

/** Native select with the platform arrow replaced by a chevron that matches the icon set. */
export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className?.includes("w-auto") ? "inline-block" : "block")}>
      <select
        className={cn(FIELD_BASE, "h-11 cursor-pointer appearance-none pr-9", className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        size={15}
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle"
      />
    </div>
  );
}

/** An input with its label, hint and per-field error wired up for screen readers. */
export function Field({
  label,
  hint,
  error,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: { id: string; "aria-describedby": string | undefined }) => ReactNode;
  className?: string;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="mt-1.5 text-xs text-ink-subtle">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-xs font-medium text-expense">
          {error}
        </p>
      )}
    </div>
  );
}

export function Checkbox({
  label,
  description,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  return (
    <label className={cn("group flex cursor-pointer items-start gap-3", className)}>
      <span className="relative mt-0.5 grid h-5 w-5 shrink-0 place-items-center">
        <input type="checkbox" className="peer sr-only" {...props} />
        <span
          aria-hidden
          className={cn(
            "grid h-5 w-5 place-items-center rounded-md border border-line-strong bg-surface transition duration-150 ease-swift",
            "peer-checked:border-transparent peer-checked:bg-brand-600",
            "peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20",
            // The tick is a descendant, not a sibling, of the peer — reach it explicitly.
            "[&>svg]:opacity-0 peer-checked:[&>svg]:opacity-100"
          )}
        >
          <Check size={13} strokeWidth={3} className="text-white transition-opacity duration-150" />
        </span>
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-subtle">{description}</span>}
      </span>
    </label>
  );
}

export function Radio({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode }) {
  return (
    <label className={cn("group flex cursor-pointer items-center gap-2.5", className)}>
      <span className="relative grid h-5 w-5 shrink-0 place-items-center">
        <input type="radio" className="peer sr-only" {...props} />
        <span
          aria-hidden
          className={cn(
            "h-5 w-5 rounded-full border border-line-strong bg-surface transition duration-150 ease-swift",
            "peer-checked:border-[6px] peer-checked:border-brand-600",
            "peer-focus-visible:ring-4 peer-focus-visible:ring-brand-500/20"
          )}
        />
      </span>
      <span className="text-sm font-medium text-ink">{label}</span>
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        {description && <p className="mt-0.5 text-xs text-ink-subtle">{description}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full transition duration-200 ease-swift disabled:opacity-50",
          checked ? "brand-gradient shadow-glow-sm" : "bg-line-strong"
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all duration-200 ease-swift",
            checked ? "left-[22px]" : "left-0.5"
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ feedback */

export function ErrorText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-expense/25 bg-expense-soft px-3.5 py-2.5 text-sm text-expense"
    >
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function SuccessText({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="flex items-center gap-2 text-sm font-medium text-income">
      <Check size={15} />
      {children}
    </div>
  );
}

export function Spinner({ label = "Loading…", className = "" }: { label?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 py-12", className)}>
      <Loader2 size={22} className="animate-spin text-brand-500" />
      <p className="text-sm text-ink-subtle">{label}</p>
    </div>
  );
}

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={cn("skeleton", className)} style={style} />;
}

/** Placeholder matching the rhythm of a transaction / account list while it loads. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/5" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
  className = "",
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-2xl border border-dashed border-line-strong px-6 py-12 text-center",
        className
      )}
    >
      {icon && (
        <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-brand-soft text-brand-500">
          {icon}
        </span>
      )}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description && <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-ink-subtle">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------------------- atoms */

type BadgeTone = "neutral" | "brand" | "income" | "expense" | "warn" | "info";

const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-sunken text-ink-muted ring-line",
  brand: "bg-brand-soft text-brand-600 ring-brand-500/20",
  income: "bg-income-soft text-income ring-income/20",
  expense: "bg-expense-soft text-expense ring-expense/20",
  warn: "bg-warn-soft text-warn ring-warn/20",
  info: "bg-info-soft text-info ring-info/20",
};

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-wide ring-1 ring-inset",
        BADGE_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Deterministic colour per name, so the same person keeps the same avatar hue everywhere. */
const AVATAR_HUES = [
  "from-indigo-500 to-violet-500",
  "from-sky-500 to-cyan-400",
  "from-emerald-500 to-teal-400",
  "from-amber-500 to-orange-400",
  "from-rose-500 to-pink-500",
  "from-fuchsia-500 to-purple-500",
];

export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const hue = AVATAR_HUES[Math.abs(hashString(name)) % AVATAR_HUES.length];
  return (
    <span
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-gradient-to-br font-bold text-white shadow-soft",
        hue
      )}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function hashString(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash << 5) - hash + value.charCodeAt(i);
  return hash;
}

/** Category/account colour dot, sized to sit on a text baseline. */
export function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ backgroundColor: color, width: size, height: size, boxShadow: `0 0 0 3px ${color}22` }}
      className="shrink-0 rounded-full"
    />
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  className = "",
}: {
  /** 0–1. Values above 1 are clamped; pass `tone="expense"` to signal the overrun. */
  value: number;
  tone?: "brand" | "income" | "expense" | "warn";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) * 100;
  const tones = {
    brand: "brand-gradient",
    income: "bg-income",
    expense: "bg-expense",
    warn: "bg-warn",
  };
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken", className)}>
      <div
        className={cn("h-full rounded-full transition-[width] duration-500 ease-swift", tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- segmented */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className = "",
  size = "md",
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="tablist"
      className={cn(
        "relative inline-flex rounded-xl border border-line bg-surface-sunken/80 p-1",
        size === "sm" ? "text-xs" : "text-sm",
        className
      )}
    >
      {/* One sliding pill rather than per-option backgrounds — the movement reads as a single object. */}
      <span
        aria-hidden
        className="absolute inset-y-1 rounded-lg bg-surface shadow-soft transition-transform duration-300 ease-swift"
        style={{
          width: `calc((100% - 0.5rem) / ${options.length})`,
          transform: `translateX(calc(${index} * 100%))`,
          left: "0.25rem",
        }}
      />
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          role="tab"
          aria-selected={value === opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            "relative z-10 flex-1 whitespace-nowrap rounded-lg font-semibold transition-colors duration-200",
            size === "sm" ? "px-2.5 py-1" : "px-3.5 py-1.5",
            value === opt.value ? "text-brand-600" : "text-ink-muted hover:text-ink"
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Selectable chip used in pickers (account type, category, filter lists). */
export function Chip({
  selected,
  children,
  className = "",
  color,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean; color?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      style={selected && color ? { backgroundColor: color, borderColor: color } : undefined}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition duration-150 ease-swift",
        selected
          ? color
            ? "border-transparent text-white shadow-soft"
            : "border-transparent brand-gradient text-white shadow-glow-sm"
          : "border-line bg-surface/60 text-ink-muted hover:border-line-strong hover:text-ink",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------- modal */

/**
 * Centred dialog on desktop, bottom sheet on phones. Locks page scroll, closes on Escape
 * and on backdrop click, and restores focus to whatever opened it.
 */
export function Modal({
  title,
  description,
  onClose,
  children,
  className = "",
  footer,
}: {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    panelRef.current?.querySelector<HTMLElement>(
      "input, select, textarea, button:not([aria-label='Close'])"
    )?.focus();

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:p-6 sm:pt-[8vh]">
      <div
        className="absolute inset-0 animate-fade-in bg-slate-950/40 backdrop-blur-sm dark:bg-slate-950/65"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn(
          "glass glass-solid relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-3xl sm:max-w-lg sm:rounded-3xl",
          "animate-sheet-up shadow-float sm:animate-scale-in",
          className
        )}
      >
        {/* Grab handle — reads as a sheet on touch, invisible on desktop. */}
        <div aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-line-strong sm:hidden" />

        <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-4 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-ink">{title}</h2>
            {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
          </div>
          <IconButton label="Close" onClick={onClose} className="-mr-1.5 -mt-1">
            <X size={18} />
          </IconButton>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>

        {footer && (
          <div className="safe-bottom border-t border-line px-5 py-4 sm:px-6">{footer}</div>
        )}
      </div>
    </div>,
    document.body
  );
}

/** Small anchored popover used for filter panels and menus. Closes on outside click / Escape. */
export function Popover({
  onClose,
  children,
  className = "",
  align = "right",
}: {
  onClose: () => void;
  children: ReactNode;
  className?: string;
  align?: "left" | "right";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // `capture` so the close fires before a click inside a re-rendering trigger swallows it.
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={cn(
        "glass glass-solid absolute top-full z-40 mt-2 w-72 animate-scale-in rounded-2xl p-4 shadow-float",
        align === "right" ? "right-0" : "left-0",
        className
      )}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------- toasts */

interface Toast {
  id: number;
  message: string;
  tone: "success" | "error";
}

const ToastContext = createContext<((message: string, tone?: Toast["tone"]) => void) | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const push = useCallback((message: string, tone: Toast["tone"] = "success") => {
    const id = (nextId.current += 1);
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={cn(
              "glass glass-solid pointer-events-auto flex animate-rise-in items-center gap-2.5 rounded-full px-4 py-2.5 text-sm font-medium shadow-float",
              toast.tone === "success" ? "text-ink" : "text-expense"
            )}
          >
            {toast.tone === "success" ? (
              <Check size={16} className="text-income" />
            ) : (
              <AlertCircle size={16} />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns a no-op outside a ToastProvider so components stay usable in isolation. */
export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(() => push ?? (() => undefined), [push]);
}
