export type Tone = "up" | "down" | "warn" | "neutral";

export type Word = { word: string; tone: Tone };

export type Quote = {
  ticker: string;
  name: string;
  price: number;
  changePct: number | null;
  high52: number | null;
  low52: number | null;
  currency: string;
};

export type Indicators = {
  price: number | null;
  rsi14: number | null;
  ema10: number | null;
  ema50: number | null;
  sma50: number | null;
  sma200: number | null;
  aboveSma50: boolean | null;
  aboveSma200: boolean | null;
  emaCrossUp: boolean | null;
  volatility30: number | null;
  drawdownFromHigh: number | null;
  pctOfRange: number | null;
  return3m: number | null;
  return1y: number | null;
  relativeStrength: number | null;
};

export type Glance = {
  timing: Word;
  quality: Word;
  price: Word;
  trend: Word;
  volatility: Word;
  drawdown: Word;
};

export type Verdict = { label: string; tone: Tone; signal: string };

export type Analysis = {
  signal: "BUY" | "HOLD" | "SELL";
  confidence: number;
  verdict_plain: string;
  buy_zone: { low: number; high: number };
  trend: string;
  bull: string[];
  bear: string[];
  invalidation: string;
  dimensions: {
    growth: number;
    profitability: number;
    balance_sheet: number;
    valuation: number;
    moat: number;
  };
  fundamental_score: number;
};

export type CheckResponse = {
  quote: Quote;
  series: { timestamp: number[]; close: number[] };
  indicators: Indicators;
  glance: Glance;
  verdict: Verdict;
  confidence: number;
  why: string;
  buyZone: { low: number; high: number } | null;
  analysis: Analysis | null;
  llm: boolean;
  cached?: boolean;
  quarterEnd?: string;
  llmError?: string | null;
  asOf: string;
};
