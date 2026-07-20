import { useEffect, useState } from "react";
import { getQuotes, type Quote } from "./api";

/**
 * One shared live-price poller for the whole app. Every surface (tape,
 * Top-ranked, check card) registers the symbols it shows and reads prices from
 * the same store, updated on a single 60s timer — so they all move together
 * instead of drifting out of sync on independent timers.
 */
const registry = new Map<string, number>(); // symbol -> refcount
let prices: Record<string, Quote> = {};
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function poll() {
  const syms = [...registry.keys()];
  if (!syms.length || inflight) return;
  inflight = true;
  try {
    const q = await getQuotes(syms);
    prices = { ...prices, ...q };
    subs.forEach((f) => f());
  } catch {
    /* keep the last-known prices */
  } finally {
    inflight = false;
  }
}

/** Register `symbols` and return the shared live-price map, re-rendering on update. */
export function useLivePrices(symbols: string[]): Record<string, Quote> {
  const [, bump] = useState(0);
  const key = symbols.join(",");

  useEffect(() => {
    const syms = key ? key.split(",") : [];
    for (const s of syms) registry.set(s, (registry.get(s) ?? 0) + 1);

    const cb = () => bump((n) => n + 1);
    subs.add(cb);
    if (!timer) timer = setInterval(poll, 60000);
    poll(); // fetch immediately for the newly-registered symbols

    return () => {
      subs.delete(cb);
      for (const s of syms) {
        const c = (registry.get(s) ?? 1) - 1;
        if (c <= 0) registry.delete(s);
        else registry.set(s, c);
      }
      if (registry.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, [key]);

  return prices;
}
