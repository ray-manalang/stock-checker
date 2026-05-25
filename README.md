# Stock Checker

Personal stock analysis tool: a small web UI, free Yahoo Finance quotes, and Gemini analysis (same API as the legacy `asUtility` Apps Script library).

The original Google Sheets + Apps Script flow still lives in the repo root (`01 -` … `05 -` files) but is no longer required.

## Stack

| Piece | Cost |
|-------|------|
| **Web UI** (`web/`) | Free — Vite + React, runs locally |
| **API** (`server/`) | Free — Node + Express |
| **Quotes** | Free — Yahoo Finance chart API (no API key) |
| **AI** | Free — Google Gemini API ([AI Studio](https://aistudio.google.com/apikey)) |

## Quick start

1. Install dependencies from the repo root:

   ```bash
   npm install
   ```

2. Configure the API:

   ```bash
   cp server/.env.example server/.env
   ```

   Edit `server/.env` and set `GEMINI_API_KEY` to the same value as your Apps Script Script Property `GEMINI_API_KEY` (from the `asUtility` library).

3. Run tests (quotes always; Gemini only if key is set):

   ```bash
   npm test
   ```

4. Run locally (API on `:3001`, UI on `:5173` with proxy):

   ```bash
   npm run dev
   ```

5. Open [http://localhost:5173](http://localhost:5173), enter a ticker (e.g. `AAPL`), and click **Analyze**.

## Gemini model

Defaults to `gemini-2.5-flash`. Override in `server/.env`:

```
GEMINI_MODEL=gemini-2.5-flash
```

## Production (still free)

- **Local only:** `npm run dev` — simplest for a personal tool.
- **Static UI:** `npm run build` in `web/`, serve `web/dist` from GitHub Pages or Cloudflare Pages (free).
- **API:** Run `npm run start` on any machine you already have.

## Project layout

```
server/          Express API — quotes + Gemini
web/             React UI
01 - Menu.js     Legacy Apps Script (optional)
02 - …           Legacy analysis + GOOGLEFINANCE helpers
```
