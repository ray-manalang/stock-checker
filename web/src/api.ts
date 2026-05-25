import type { AnalyzeResponse } from "./types";

export async function analyzeTicker(ticker: string): Promise<AnalyzeResponse> {
  const res = await fetch("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Analysis failed");
  }

  return data as AnalyzeResponse;
}
