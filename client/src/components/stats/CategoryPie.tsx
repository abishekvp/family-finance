import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "../../lib/format";
import { Money } from "../figures";

export interface CategorySlice {
  key: string;
  name: string;
  color: string;
  amount: number;
  fraction: number;
}

function CustomTooltip({ active, payload, currency }: { active?: boolean; payload?: any[]; currency: string }) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  return (
    <div className="glass glass-solid rounded-xl px-3 py-2 text-xs shadow-lift">
      <p className="mb-0.5 font-semibold text-ink">{entry.name}</p>
      <p className="tnum font-bold text-ink">{formatCurrency(entry.value, currency)}</p>
    </div>
  );
}

export function CategoryPie({
  slices,
  currency,
  metricLabel = "Total",
}: {
  slices: CategorySlice[];
  currency: string;
  metricLabel?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const total = slices.reduce((s, v) => s + v.amount, 0);
  const data = slices.map((s) => ({ name: s.name, value: s.amount, color: s.color }));

  return (
    <div className="relative h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={64}
            outerRadius={100}
            paddingAngle={3}
            stroke="none"
            onMouseEnter={(_, index) => setActiveIndex(index)}
            onMouseLeave={() => setActiveIndex(null)}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.name}
                fill={entry.color}
                opacity={activeIndex === null || activeIndex === index ? 1 : 0.32}
                style={{ transition: "opacity 150ms ease" }}
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip currency={currency} />} />
        </PieChart>
      </ResponsiveContainer>

      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xs font-semibold uppercase tracking-wide text-ink-subtle">
          {activeIndex !== null ? data[activeIndex].name : metricLabel}
        </p>
        <p className="tnum mt-1 text-xl font-extrabold text-ink">
          <Money amount={activeIndex !== null ? data[activeIndex].value : total} currency={currency} compact />
        </p>
      </div>
    </div>
  );
}
