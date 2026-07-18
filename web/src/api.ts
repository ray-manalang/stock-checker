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
