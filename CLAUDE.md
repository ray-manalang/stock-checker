# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal stock analysis tool: **web UI + Node API** (primary), with legacy **Google Apps Script + Sheet** code kept at the repo root.

## Commands

```bash
# Development (API :3001 + UI :5173, with hot reload)
npm install
cp server/.env.example server/.env   # set GEMINI_API_KEY
npm run dev

# Run tests (unit + live fetch; Gemini test skipped if no API key)
npm test

# Production build
npm run build        # builds web/dist
npm start            # serves API + static UI on PORT (default 3001)

# Docker
docker compose up --build
```

## Architecture

**Request flow** for `POST /api/analyze`:
1. `server/src/analyze.js` — orchestrates the pipeline
2. `server/src/stocks.js` — fetches 1-year daily chart from Yahoo Finance (no key needed); returns `{ ticker, price, high52, low52, currency }`
3. `server/src/prompt.js` — builds the Gemini prompt with derived metrics (% of 52-week range, distances from high/low)
4. `server/src/llm.js` — calls `gemini-2.5-flash` via REST; model overridable with `GEMINI_MODEL` env var
5. `server/src/parseAnalysis.js` — parses the strict 4-field LLM response into `{ trend, buyZone, signal, reasoning, raw }`

**Dual-mode server**: when `STATIC_DIR` is set, `server/src/index.js` serves the built React app and acts as a combined UI+API server (production/Docker mode). Without it, it's API-only and Vite proxies to it in dev.

**Web app** (`web/`) is a single-component React app (`App.tsx`). `web/src/api.ts` calls `POST /api/analyze` and `web/src/types.ts` defines `Quote`, `Analysis`, and `AnalyzeResponse`.

**Docker**: multi-stage build — `web-build` stage runs `npm run build`, production stage copies only `server/src` and `web/dist`. Exposes port 3001 internally; `docker-compose.yml` maps to host port 8088.

## Legacy Apps Script (optional)

Numbered `01 -` … `05 -` files deploy via [clasp](https://github.com/google/clasp). Sheet-based UI uses checkboxes and `GOOGLEFINANCE` via temporary spreadsheets. LLM uses `asUtility.SubmitRequestToGCPAPI` → Gemini `generateContent`; the web app calls the same Gemini API with `GEMINI_API_KEY` in `server/.env`.
