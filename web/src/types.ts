export type Quote = {
  ticker: string;
  price: number;
  high52: number | null;
  low52: number | null;
  currency: string;
};

export type Analysis = {
  raw: string;
  trend: string | null;
  buyZone: string | null;
  signal: string | null;
  reasoning: string | null;
};

export type AnalyzeResponse = {
  quote: Quote;
  analysis: Analysis;
};
