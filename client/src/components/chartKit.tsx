import type { ReactNode } from "react";
import { useTheme } from "../lib/theme";
import { cn } from "./ui";

/**
 * Chart colours. A validated categorical palette (fixed order, colour-blind separated in both modes)
 * rather than the app's green/red, which can't be told apart under deuteranopia. Dark mode gets its own
 * steps of the same hues, not an inverted copy. Slot 1 is income, slot 2 spending, slot 3 net.
 */
const SERIES = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

const CHROME = {
  light: { grid: "rgb(226 230 241)", axis: "rgb(134 143 164)", cursor: "rgba(13, 17, 34, 0.05)", surface: "#ffffff" },
  dark: { grid: "rgb(40 47 76)", axis: "rgb(112 122 146)", cursor: "rgba(233, 237, 249, 0.06)", surface: "#12162a" },
};

export function useChartPalette() {
  const { resolved } = useTheme();
  const series = SERIES[resolved];
  return { series, income: series[0], expense: series[1], net: series[2], ...CHROME[resolved] };
}

/* ------------------------------------------------------------------- frame */

export function ChartCard({
  title,
  subtitle,
  actions,
  legend,
  children,
  className = "",
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  legend?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("glass flex min-w-0 flex-col rounded-2xl p-5", className)}>
      <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-ink-subtle">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </header>
      {legend && <div className="mb-3">{legend}</div>}
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  );
}

/** A legend that names every series, so identity never rests on colour alone. */
export function Legend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-muted">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          {item.dashed ? (
            <span aria-hidden className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: item.color }} />
          ) : (
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
          )}
          {item.label}
        </li>
      ))}
    </ul>
  );
}
