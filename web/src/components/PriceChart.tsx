import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { money } from "../lib/format";

const ACCENT = "#5ea2ff";
const UP = "#34c759";

type Point = { i: number; date: string; price: number };

/** Price line with a shaded buy-zone band. */
export function PriceChart({
  timestamps,
  closes,
  buyZone,
  currency = "USD",
}: {
  timestamps: number[];
  closes: number[];
  buyZone?: { low: number; high: number } | null;
  currency?: string;
}) {
  const data: Point[] = closes.map((price, i) => ({
    i,
    date: fmtDate(timestamps[i]),
    price,
  }));
  if (data.length < 2) return <p className="muted center">Not enough price history yet.</p>;

  const prices = closes;
  let lo = Math.min(...prices);
  let hi = Math.max(...prices);
  if (buyZone) {
    lo = Math.min(lo, buyZone.low);
    hi = Math.max(hi, buyZone.high);
  }
  const pad = Math.max((hi - lo) * 0.06, 0.5);

  return (
    <ResponsiveContainer width="100%" height={210}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="pxfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.32} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--hairline-soft)" vertical={false} />
        {buyZone && (
          <ReferenceArea
            y1={buyZone.low}
            y2={buyZone.high}
            fill={UP}
            fillOpacity={0.1}
            stroke={UP}
            strokeOpacity={0.35}
            strokeDasharray="4 4"
          />
        )}
        <XAxis
          dataKey="date"
          axisLine={false}
          tickLine={false}
          minTickGap={48}
          tick={{ fill: "var(--text-3)", fontSize: 11 }}
        />
        <YAxis
          width={58}
          domain={[lo - pad, hi + pad]}
          axisLine={false}
          tickLine={false}
          tick={{ fill: "var(--text-3)", fontSize: 11 }}
          tickFormatter={(v) => money(v, currency)}
        />
        <Tooltip content={<ChartTip currency={currency} />} />
        <Area
          type="monotone"
          dataKey="price"
          stroke={ACCENT}
          strokeWidth={2.5}
          fill="url(#pxfill)"
          dot={false}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ChartTip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: Array<{ payload: Point }>;
  currency: string;
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--hairline)",
        borderRadius: 10,
        padding: "8px 12px",
        fontSize: 12,
      }}
    >
      <div className="muted">{p.date}</div>
      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {money(p.price, currency)}
      </div>
    </div>
  );
}

// Parse a unix-seconds timestamp into a short label without timezone drift.
function fmtDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
