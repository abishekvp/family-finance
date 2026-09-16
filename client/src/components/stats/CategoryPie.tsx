import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { formatCurrency } from "../../lib/format";

export interface CategorySlice {
  key: string;
  name: string;
  color: string;
  amount: number;
  fraction: number;
}

export function CategoryPie({ slices, currency }: { slices: CategorySlice[]; currency: string }) {
  const data = slices.map((s) => ({ name: s.name, value: s.amount, color: s.color }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={2}>
            {data.map((entry) => (
              <Cell key={entry.name} fill={entry.color} stroke="none" />
            ))}
          </Pie>
          <Tooltip
            formatter={(value, name) => [formatCurrency(Number(value), currency), String(name)]}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
