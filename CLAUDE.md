# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A personal stock analysis tool: **web UI + Node API** (primary), with legacy **Google Apps Script + Sheet** code kept at the repo root.

## Primary app (web)

```bash
npm install
cp server/.env.example server/.env   # set GEMINI_API_KEY
npm run dev                          # API :3001, UI :5173
```

- `server/` — Express API: Yahoo Finance quotes (free, no key) + Gemini API (same as `asUtility`)
- `web/` — Vite + React UI

See [README.md](./README.md) for env vars and deployment notes.

## Legacy Apps Script (optional)

Numbered `01 -` … `05 -` files deploy via [clasp](https://github.com/google/clasp). Sheet-based UI uses checkboxes and `GOOGLEFINANCE` via temporary spreadsheets. LLM uses `asUtility.SubmitRequestToGCPAPI` → Gemini `generateContent`; the web app calls the same Gemini API with `GEMINI_API_KEY` in `server/.env`.
