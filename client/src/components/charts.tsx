import type { ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "../lib/theme";
import { formatCurrency } from "../lib/format";
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

interface TooltipRow {
  name?: string | number;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
  payload?: Record<string, unknown>;
}

/** The hover card: the bucket's label, then each series with its value in ink, keyed by a colour swatch. */
export function ChartTooltip({
  active,
  payload,
  label,
  currency,
  labelFormatter,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string | number;
  currency: string;
  labelFormatter?: (label: string | number, row?: Record<string, unknown>) => ReactNode;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload;
  return (
    <div className="glass glass-solid min-w-[160px] rounded-xl px-3 py-2.5 text-xs shadow-lift">
      <p className="mb-1.5 font-semibold text-ink">{labelFormatter && label !== undefined ? labelFormatter(label, row) : label}</p>
      <ul className="space-y-1">
        {payload.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span aria-hidden className="h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
              {p.name}
            </span>
            <span className="tnum font-semibold text-ink">{formatCurrency(Number(p.value) || 0, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Axis ticks are always short ("₹85K", "₹1.2M"), so the axis stays narrow. */
function axisMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, notation: "compact", maximumFractionDigits: 1 }).format(value);
  } catch {
    return String(Math.round(value));
  }
}

function axisProps(axis: string) {
  return { stroke: axis, tick: { fill: axis, fontSize: 11 }, tickLine: false, axisLine: false } as const;
}

/* ------------------------------------------------------------- cash flow */

export interface CashflowPoint {
  label: string;
  /** Longer label for the tooltip ("March 2026"). */
  full: string;
  income: number;
  expense: number;
  net: number;
}

/** Income and spending side by side per period, with the net as a line on the same money axis. */
export function CashflowChart({ data, currency, height = 280 }: { data: CashflowPoint[]; currency: string; height?: number }) {
  const c = useChartPalette();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barGap={2} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.axis)} />
          <YAxis {...axisProps(c.axis)} width={56} tickFormatter={(v: number) => axisMoney(v, currency)} />
          <ReferenceLine y={0} stroke={c.axis} strokeOpacity={0.5} />
          <Tooltip
            cursor={{ fill: c.cursor }}
            content={<ChartTooltip currency={currency} labelFormatter={(_, row) => String(row?.full ?? "")} />}
          />
          <Bar dataKey="income" name="Income" fill={c.income} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Bar dataKey="expense" name="Spending" fill={c.expense} radius={[4, 4, 0, 0]} maxBarSize={22} />
          <Line
            dataKey="net"
            name="Net"
            type="monotone"
            stroke={c.net}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 3, strokeWidth: 2, fill: c.surface }}
            activeDot={{ r: 5, strokeWidth: 2, fill: c.surface }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------ simple bars */

/** One series of bars, e.g. spending by weekday or by account. */
export function SimpleBars({
  data,
  currency,
  name,
  color,
  height = 220,
  layout = "vertical-bars",
}: {
  data: { label: string; value: number; full?: string }[];
  currency: string;
  name: string;
  color: string;
  height?: number;
  /** "vertical-bars" stands bars on the x axis; "horizontal-bars" runs them from the y axis (long labels). */
  layout?: "vertical-bars" | "horizontal-bars";
}) {
  const c = useChartPalette();
  const horizontal = layout === "horizontal-bars";
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap="24%">
          <CartesianGrid vertical={horizontal} horizontal={!horizontal} stroke={c.grid} />
          {horizontal ? (
            <>
              <XAxis type="number" {...axisProps(c.axis)} tickFormatter={(v: number) => axisMoney(v, currency)} />
              <YAxis type="category" dataKey="label" {...axisProps(c.axis)} width={110} />
            </>
          ) : (
            <>
              <XAxis dataKey="label" {...axisProps(c.axis)} />
              <YAxis {...axisProps(c.axis)} width={56} tickFormatter={(v: number) => axisMoney(v, currency)} />
            </>
          )}
          <Tooltip
            cursor={{ fill: c.cursor }}
            content={<ChartTooltip currency={currency} labelFormatter={(label, row) => String(row?.full ?? label)} />}
          />
          <Bar dataKey="value" name={name} fill={color} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={horizontal ? 18 : 28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------- stacked bars */

/** Categories stacked per period: how the mix of spending shifts over time. */
export function StackedBars({
  data,
  series,
  currency,
  height = 280,
}: {
  data: Record<string, number | string>[];
  series: { key: string; label: string; color: string }[];
  currency: string;
  height?: number;
}) {
  const c = useChartPalette();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.axis)} />
          <YAxis {...axisProps(c.axis)} width={56} tickFormatter={(v: number) => axisMoney(v, currency)} />
          <Tooltip
            cursor={{ fill: c.cursor }}
            content={<ChartTooltip currency={currency} labelFormatter={(label, row) => String(row?.full ?? label)} />}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="stack"
              fill={s.color}
              // A 2px surface gap between stacked segments; only the top one is rounded.
              stroke={c.surface}
              strokeWidth={1}
              radius={i === series.length - 1 ? [4, 4, 0, 0] : 0}
              maxBarSize={32}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ------------------------------------------------------------- pace lines */

/** Running totals through a period against the one before — "are we spending faster than last month?". */
export function PaceChart({
  data,
  currentLabel,
  previousLabel,
  currency,
  color,
  height = 260,
}: {
  data: { label: string; current: number | null; previous: number | null }[];
  currentLabel: string;
  previousLabel: string;
  currency: string;
  color: string;
  height?: number;
}) {
  const c = useChartPalette();
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" {...axisProps(c.axis)} minTickGap={16} />
          <YAxis {...axisProps(c.axis)} width={56} tickFormatter={(v: number) => axisMoney(v, currency)} />
          <Tooltip cursor={{ stroke: c.axis, strokeDasharray: "3 3" }} content={<ChartTooltip currency={currency} />} />
          <Line dataKey="previous" name={previousLabel} type="monotone" stroke={c.axis} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls={false} />
          <Line
            dataKey="current"
            name={currentLabel}
            type="monotone"
            stroke={color}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, strokeWidth: 2, fill: c.surface }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
