#!/usr/bin/env python3
"""Yahoo Finance fetch sidecar for the Node app.

yfinance uses curl_cffi to impersonate a browser's TLS fingerprint, which is
what Yahoo's bot-detection actually checks — plain Node/requests get 429'd. Node
shells out to this script for real Yahoo data.

Usage:
    yf_fetch.py chart <SYMBOL> <range>          -> {"quote": {...}, "series": {...}}
    yf_fetch.py multi <range> <SYM1> <SYM2> ...  -> {"<SYM>": {closes, volumes, timestamp}, ...}

Ranges: 1y | 5y | 5d (mapped to yfinance periods). All output is JSON on stdout;
errors go to stderr with a non-zero exit.
"""
import json
import sys


def to_unix(index):
    # pandas DatetimeIndex -> list of unix seconds
    return [int(ts.timestamp()) for ts in index.to_pydatetime()]


def cmd_chart(symbol, period):
    import yfinance as yf

    t = yf.Ticker(symbol)
    h = t.history(period=period, interval="1d", auto_adjust=True)
    if h is None or h.empty:
        raise SystemExit(f"no data for {symbol}")

    closes = [float(x) for x in h["Close"].tolist()]
    series = {
        "timestamp": to_unix(h.index),
        "open": [float(x) for x in h["Open"].tolist()],
        "high": [float(x) for x in h["High"].tolist()],
        "low": [float(x) for x in h["Low"].tolist()],
        "close": closes,
        "volume": [int(x) for x in h["Volume"].fillna(0).tolist()],
    }

    price = closes[-1]
    prev = closes[-2] if len(closes) > 1 else price
    one_year = closes[-252:]

    high52 = low52 = currency = name = None
    try:
        fi = t.fast_info
        high52 = float(getattr(fi, "year_high", None) or max(one_year))
        low52 = float(getattr(fi, "year_low", None) or min(one_year))
        currency = getattr(fi, "currency", None) or "USD"
    except Exception:
        high52, low52, currency = max(one_year), min(one_year), "USD"
    try:
        info = t.get_info()
        name = info.get("longName") or info.get("shortName")
    except Exception:
        name = None

    quote = {
        "ticker": symbol,
        "name": name or symbol,
        "price": price,
        "changePct": ((price - prev) / prev * 100) if prev else None,
        "high52": high52,
        "low52": low52,
        "currency": currency or "USD",
    }
    return {"quote": quote, "series": series}


def cmd_multi(period, symbols):
    import yfinance as yf

    data = yf.download(
        symbols,
        period=period,
        interval="1d",
        auto_adjust=True,
        group_by="ticker",
        threads=True,
        progress=False,
    )
    out = {}
    single = len(symbols) == 1
    for sym in symbols:
        try:
            if single:
                close = data["Close"]
                vol = data.get("Volume")
                idx = data.index
            else:
                sub = data[sym]
                close = sub["Close"]
                vol = sub.get("Volume")
                idx = sub.index
            mask = close.notna()
            close = close[mask]
            if close.empty:
                continue
            closes = [float(x) for x in close.tolist()]
            volumes = (
                [int(x) for x in vol[mask].fillna(0).tolist()] if vol is not None else []
            )
            out[sym] = {
                "closes": closes,
                "volumes": volumes,
                "timestamp": to_unix(close.index if hasattr(close, "index") else idx[mask]),
            }
        except Exception:
            continue
    return out


def cmd_quote(symbols):
    """Fast last price + previous close per symbol (for live minute updates)."""
    import yfinance as yf

    data = yf.download(
        symbols,
        period="5d",
        interval="1d",
        auto_adjust=True,
        group_by="ticker",
        threads=True,
        progress=False,
    )
    out = {}
    single = len(symbols) == 1
    for sym in symbols:
        try:
            close = data["Close"] if single else data[sym]["Close"]
            close = close[close.notna()]
            if close.empty:
                out[sym] = None
                continue
            vals = [float(x) for x in close.tolist()]
            price = vals[-1]
            prev = vals[-2] if len(vals) > 1 else price
            out[sym] = {"price": price, "prevClose": prev}
        except Exception:
            out[sym] = None
    return out


def cmd_fundamentals(symbol):
    """4 quarters of financials + derived ratios (ported from the old analyzer)."""
    import yfinance as yf
    import pandas as pd

    tk = yf.Ticker(symbol)
    income_q = tk.quarterly_income_stmt
    cashflow_q = tk.quarterly_cashflow
    balance_q = tk.quarterly_balance_sheet

    def safe_row(df, *names):
        for n in names:
            if df is not None and n in df.index:
                return df.loc[n].iloc[:4]
        return pd.Series([None] * 4)

    revenue = safe_row(income_q, "Total Revenue", "Revenue")
    net_income = safe_row(income_q, "Net Income", "Net Income Common Stockholders")
    gross_profit = safe_row(income_q, "Gross Profit")
    op_income = safe_row(income_q, "Operating Income", "EBIT")
    op_cashflow = safe_row(cashflow_q, "Operating Cash Flow", "Total Cash From Operating Activities")
    capex = safe_row(cashflow_q, "Capital Expenditure", "Purchase Of PPE")
    total_debt = safe_row(balance_q, "Total Debt", "Long Term Debt")
    equity = safe_row(balance_q, "Stockholders Equity", "Total Stockholder Equity")
    accounts_rec = safe_row(balance_q, "Accounts Receivable", "Net Receivables")

    def pct_list(series):
        return [round(float(v), 2) if v is not None and pd.notna(v) else None for v in series.tolist()]

    def ratio(a, b):
        try:
            return round(float(a) / float(b), 4) if b and float(b) != 0 else None
        except Exception:
            return None

    fcf = []
    for ocf, cx in zip(op_cashflow.tolist(), capex.tolist()):
        try:
            fcf.append(round(float(ocf) + float(cx), 2))
        except Exception:
            fcf.append(None)

    gross_margin = [ratio(g, r) for g, r in zip(gross_profit.tolist(), revenue.tolist())]
    op_margin = [ratio(o, r) for o, r in zip(op_income.tolist(), revenue.tolist())]
    debt_equity = [ratio(d, e) for d, e in zip(total_debt.tolist(), equity.tolist())]
    roe = [ratio(n, e) for n, e in zip(net_income.tolist(), equity.tolist())]
    cfo_ni = [ratio(c, n) for c, n in zip(op_cashflow.tolist(), net_income.tolist())]

    def qoq(vals):
        try:
            curr, prev = float(vals[0]), float(vals[1])
            return round((curr - prev) / abs(prev), 4) if prev != 0 else None
        except Exception:
            return None

    ar_growth, rev_growth = qoq(accounts_rec.tolist()), qoq(revenue.tolist())

    try:
        quarter_end = str(income_q.columns[0].date())
    except Exception:
        quarter_end = None

    financials = {
        "ticker": symbol,
        "quarters": [str(c.date()) if hasattr(c, "date") else str(c) for c in (income_q.columns[:4].tolist() if income_q is not None else [])],
        "revenue": pct_list(revenue),
        "net_income": pct_list(net_income),
        "op_cashflow": pct_list(op_cashflow),
        "fcf": fcf,
        "gross_margin": gross_margin,
        "op_margin": op_margin,
        "debt_equity": debt_equity,
        "roe": roe,
        "cfo_ni_ratio": cfo_ni,
        "ar_growth_vs_rev_growth": {
            "ar_growth": ar_growth,
            "rev_growth": rev_growth,
            "spread": round(ar_growth - rev_growth, 4) if ar_growth is not None and rev_growth is not None else None,
        },
    }
    return {"quarterEnd": quarter_end, "financials": financials}


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: yf_fetch.py chart|fundamentals <sym> <range> | multi <range> <syms...>")
    mode = sys.argv[1]
    period_map = {"1y": "1y", "5y": "5y", "5d": "5d"}
    if mode == "chart":
        symbol, rng = sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "1y"
        result = cmd_chart(symbol, period_map.get(rng, "1y"))
    elif mode == "multi":
        rng = sys.argv[2]
        symbols = sys.argv[3:]
        if not symbols:
            raise SystemExit("multi: no symbols")
        result = cmd_multi(period_map.get(rng, "1y"), symbols)
    elif mode == "quote":
        symbols = sys.argv[2:]
        if not symbols:
            raise SystemExit("quote: no symbols")
        result = cmd_quote(symbols)
    elif mode == "fundamentals":
        result = cmd_fundamentals(sys.argv[2])
    else:
        raise SystemExit(f"unknown mode {mode}")
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
