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

export type CnbcVideo = {
  id: string;
  title: string;
  thumbnail: string | null;
  published: string | null;
};
export async function getCnbcVideos(): Promise<CnbcVideo[]> {
  return (await jsonOrThrow(await fetch("/api/news/videos"))).data;
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
