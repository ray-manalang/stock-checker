// Static GICS sector map for the large-cap universe (Phase 4.2). Sector-relative
// ranking needs a sector per ticker; pulling it live would mean one Python
// subprocess per name across the whole universe, so the core names are mapped
// here (the same pattern as names.js). Tickers outside this map get a null
// sector and simply don't receive a within-sector rank — graceful, not an error.
// The sidecar also surfaces `sector` on the fundamentals payload, so a name that
// gets a deep-dive can fill this in over time.

export const SECTORS = {
  AAPL: "Information Technology", MSFT: "Information Technology",
  NVDA: "Information Technology", AVGO: "Information Technology",
  ORCL: "Information Technology", ADBE: "Information Technology",
  CRM: "Information Technology", AMD: "Information Technology",
  CSCO: "Information Technology", ACN: "Information Technology",
  TXN: "Information Technology", QCOM: "Information Technology",
  INTC: "Information Technology", INTU: "Information Technology",
  IBM: "Information Technology", NOW: "Information Technology",
  MU: "Information Technology", PANW: "Information Technology",
  APH: "Information Technology", KLAC: "Information Technology",
  SNPS: "Information Technology", CDNS: "Information Technology",

  GOOGL: "Communication Services", META: "Communication Services",
  NFLX: "Communication Services", VZ: "Communication Services",
  T: "Communication Services",

  AMZN: "Consumer Discretionary", TSLA: "Consumer Discretionary",
  HD: "Consumer Discretionary", MCD: "Consumer Discretionary",
  NKE: "Consumer Discretionary", LOW: "Consumer Discretionary",
  BKNG: "Consumer Discretionary", TJX: "Consumer Discretionary",

  WMT: "Consumer Staples", PG: "Consumer Staples", COST: "Consumer Staples",
  KO: "Consumer Staples", PEP: "Consumer Staples", PM: "Consumer Staples",
  MO: "Consumer Staples",

  LLY: "Health Care", UNH: "Health Care", JNJ: "Health Care",
  MRK: "Health Care", ABBV: "Health Care", TMO: "Health Care",
  ABT: "Health Care", DHR: "Health Care", AMGN: "Health Care",
  PFE: "Health Care", ISRG: "Health Care", ELV: "Health Care",
  SYK: "Health Care", MDT: "Health Care", GILD: "Health Care",
  VRTX: "Health Care", REGN: "Health Care", ZTS: "Health Care",
  BSX: "Health Care", CI: "Health Care", BMY: "Health Care",

  "BRK-B": "Financials", JPM: "Financials", V: "Financials",
  MA: "Financials", BAC: "Financials", WFC: "Financials",
  SPGI: "Financials", GS: "Financials", MS: "Financials",
  AXP: "Financials", BLK: "Financials", SCHW: "Financials",
  C: "Financials", MMC: "Financials", CB: "Financials",
  PGR: "Financials", FI: "Financials",

  XOM: "Energy", CVX: "Energy", COP: "Energy", SLB: "Energy",

  CAT: "Industrials", GE: "Industrials", UNP: "Industrials",
  HON: "Industrials", UBER: "Industrials", RTX: "Industrials",
  BA: "Industrials", LMT: "Industrials", ADP: "Industrials",
  ETN: "Industrials", DE: "Industrials",

  LIN: "Materials",
  PLD: "Real Estate", AMT: "Real Estate",
  SO: "Utilities", DUK: "Utilities",
};

export function sectorOf(ticker) {
  return SECTORS[ticker] ?? null;
}
