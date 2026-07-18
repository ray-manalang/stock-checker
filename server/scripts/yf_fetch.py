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


def main():
    if len(sys.argv) < 3:
        raise SystemExit("usage: yf_fetch.py chart <sym> <range> | multi <range> <syms...>")
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
    else:
        raise SystemExit(f"unknown mode {mode}")
    json.dump(result, sys.stdout)


if __name__ == "__main__":
    main()
