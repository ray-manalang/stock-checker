import type { CheckResponse } from "./types";

export type WatchItem = { ticker: string; addedAt: string };
export type Alert = {
  id: number;
  ticker: string;
  targetLow: number | null;
  targetHigh: number | null;
  status: string;
  createdAt: string;
  triggeredAt: string | null;
};

async function jsonOrThrow(res: Response) {
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}

export async function getWatchlist(): Promise<WatchItem[]> {
  return (await jsonOrThrow(await fetch("/api/watchlist"))).data;
}

export type WatchQuote = {
  ticker: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
};
export async function getWatchlistQuotes(): Promise<WatchQuote[]> {
  return (await jsonOrThrow(await fetch("/api/watchlist/quotes"))).data;
}

export type TapeItem = WatchQuote & {
  source: "watch" | "scan" | "index";
  label?: string;
};
export async function getTape(): Promise<TapeItem[]> {
  return (await jsonOrThrow(await fetch("/api/tape"))).data;
}

export type Quote = { price: number | null; changePct: number | null };
export async function getQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  if (!symbols.length) return {};
  const qs = encodeURIComponent(symbols.join(","));
  return (await jsonOrThrow(await fetch(`/api/quotes?symbols=${qs}`))).data;
}

export type CnbcVideo = {
  id: string;
  title: string;
  thumbnail: string | null;
  published: string | null;
  source?: string;
};
export async function getCnbcVideos(force = false): Promise<CnbcVideo[]> {
  const url = force ? "/api/news/videos?force=1" : "/api/news/videos";
  return (await jsonOrThrow(await fetch(url))).data;
}

// ---------- video sources ----------
export type VideoSource = { channelId: string; label: string };
export async function getVideoSources(): Promise<VideoSource[]> {
  return (await jsonOrThrow(await fetch("/api/news/sources"))).data;
}
export async function addVideoSource(url: string, label?: string): Promise<VideoSource[]> {
  return (
    await jsonOrThrow(
      await fetch("/api/news/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, label }),
      }),
    )
  ).data;
}
export async function removeVideoSource(channelId: string): Promise<VideoSource[]> {
  return (
    await jsonOrThrow(
      await fetch(`/api/news/sources/${encodeURIComponent(channelId)}`, { method: "DELETE" }),
    )
  ).data;
}
export async function addToWatchlist(ticker: string): Promise<WatchItem[]> {
  return (
    await jsonOrThrow(
      await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      }),
    )
  ).data;
}
export async function removeFromWatchlist(ticker: string): Promise<WatchItem[]> {
  return (
    await jsonOrThrow(
      await fetch(`/api/watchlist/${encodeURIComponent(ticker)}`, { method: "DELETE" }),
    )
  ).data;
}

export type RecentCheck = {
  ticker: string;
  name: string | null;
  verdictLabel: string | null;
  verdictTone: string | null;
  price: number | null;
  llm: boolean;
  checkedAt: string;
};

export async function getRecentChecks(): Promise<RecentCheck[]> {
  return (await jsonOrThrow(await fetch("/api/checks"))).data;
}

export type Usage = {
  llm: boolean;
  calls: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
};

export async function getUsage(): Promise<Usage> {
  return jsonOrThrow(await fetch("/api/usage"));
}

export async function refreshLayer(layer: "macro" | "scanner" | "analyst"): Promise<void> {
  await jsonOrThrow(await fetch(`/api/refresh/${layer}`, { method: "POST" }));
}

export async function getAlerts(): Promise<Alert[]> {
  return (await jsonOrThrow(await fetch("/api/alerts"))).data;
}
export async function createAlert(
  ticker: string,
  targetLow: number | null,
  targetHigh: number | null = null,
): Promise<Alert[]> {
  return (
    await jsonOrThrow(
      await fetch("/api/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, targetLow, targetHigh }),
      }),
    )
  ).data;
}
export async function updateAlert(
  id: number,
  targetLow: number | null,
  targetHigh: number | null = null,
): Promise<Alert[]> {
  return (
    await jsonOrThrow(
      await fetch(`/api/alerts/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLow, targetHigh }),
      }),
    )
  ).data;
}
export async function deleteAlert(id: number): Promise<Alert[]> {
  return (await jsonOrThrow(await fetch(`/api/alerts/${id}`, { method: "DELETE" }))).data;
}

// ---------- settings (risk tolerance) ----------
export type RiskTolerance = "conservative" | "balanced" | "aggressive";
export type Settings = {
  riskTolerance: RiskTolerance;
  riskProfiles: Record<string, { label: string }>;
};
export async function getSettings(): Promise<Settings> {
  return jsonOrThrow(await fetch("/api/settings"));
}
export async function updateSettings(
  patch: Partial<Pick<Settings, "riskTolerance">>,
): Promise<{ riskTolerance: RiskTolerance }> {
  return jsonOrThrow(
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  );
}

// ---------- watchlist buy-signals ----------
export type WatchSignal = {
  ticker: string;
  lastVerdict: string | null;
  lastLabel: string | null;
  lastCheckedAt: string | null;
  notifiedAt: string | null;
};
export async function getWatchSignals(): Promise<WatchSignal[]> {
  return (await jsonOrThrow(await fetch("/api/watchlist/signals"))).data;
}

// ---------- holdings ----------
export type HoldingNote = { kind: string; title?: string; text: string };
export type HoldingSource = { source: string; shares: number; costBasis: number | null };
export type SectorAllocation = { sector: string; value: number; count: number; pct: number | null };
export type Holding = {
  ticker: string;
  name: string | null;
  sector: string;
  shares: number;
  costBasis: number | null;
  sources: HoldingSource[];
  price: number | null;
  changePct: number | null;
  marketValue: number | null;
  costValue: number | null;
  gainLoss: number | null;
  gainLossPct: number | null;
  concentrationPct: number | null;
  taxAdvantaged: boolean;
  signal: string | null;
  notes: HoldingNote[];
};
export type Portfolio = {
  positions: Holding[];
  bySector: SectorAllocation[];
  totalValue: number;
  totalCost: number;
  unrealized: number | null;
  unrealizedPct: number | null;
  count: number;
  sources: string[];
  asOf: string | null;
};
export type HoldingsResponse = {
  data: Portfolio;
  demo: boolean;
  macro: { zone: string; sizingPct: number | null } | null;
};
export async function getHoldings(): Promise<HoldingsResponse> {
  return jsonOrThrow(await fetch("/api/holdings"));
}

export type CsvMapping = {
  ticker: string | null;
  shares: string | null;
  costBasis: string | null;
  costBasisMode: "pershare" | "total";
  source: string | null;
};
export type HoldingsPreview = {
  headers: string[];
  sample: Record<string, string>[];
  rowCount: number;
  suggestedMapping: CsvMapping;
};
export async function previewHoldings(csv: string): Promise<HoldingsPreview> {
  return (
    await jsonOrThrow(
      await fetch("/api/holdings/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv }),
      }),
    )
  ).data;
}
export type ImportSummary = {
  imported: number;
  positions: number;
  skipped: number;
  skippedSymbols: string[];
  asOf: string;
};
export async function importHoldings(
  csv: string,
  mapping: CsvMapping,
  asOf?: string,
): Promise<ImportSummary> {
  return jsonOrThrow(
    await fetch("/api/holdings/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, mapping, asOf }),
    }),
  );
}
export async function setHoldingTax(ticker: string, taxAdvantaged: boolean): Promise<void> {
  await jsonOrThrow(
    await fetch(`/api/holdings/${encodeURIComponent(ticker)}/tax`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taxAdvantaged }),
    }),
  );
}

// ---------- backtest report ----------
export type Backtest = {
  windowDays: number;
  logged: number;
  since: string | null;
  graded: number;
  ready: boolean;
  overall: number | null;
  buckets: Record<string, { total: number; correct: number; hitRate: number | null }>;
};
export async function getBacktest(): Promise<Backtest> {
  return (await jsonOrThrow(await fetch("/api/backtest"))).data;
}

export async function checkTicker(
  ticker: string,
  opts: { deep?: boolean; fresh?: boolean } = {},
): Promise<CheckResponse> {
  const params = new URLSearchParams();
  if (opts.deep === false) params.set("deep", "0");
  if (opts.fresh) params.set("fresh", "1");
  const qs = params.toString();
  const res = await fetch(`/api/check/${encodeURIComponent(ticker)}${qs ? `?${qs}` : ""}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Check failed");
  return data as CheckResponse;
}
