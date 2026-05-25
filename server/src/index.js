import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { analyzeTicker } from "./analyze.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT) || 3001;
const staticDir = process.env.STATIC_DIR
  ? path.resolve(process.env.STATIC_DIR)
  : null;

app.use(cors({ origin: process.env.CORS_ORIGIN ?? true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    llm: Boolean(process.env.GEMINI_API_KEY?.trim()),
  });
});

app.post("/api/analyze", async (req, res) => {
  const ticker = req.body?.ticker;
  if (!ticker || typeof ticker !== "string") {
    return res.status(400).json({ error: "ticker is required" });
  }

  try {
    const result = await analyzeTicker(ticker);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Analysis failed";
    res.status(500).json({ error: message });
  }
});

if (staticDir) {
  app.use(express.static(staticDir));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

app.listen(port, "0.0.0.0", () => {
  console.log(
    staticDir
      ? `Stock Checker listening on http://0.0.0.0:${port} (UI + API)`
      : `API listening on http://0.0.0.0:${port}`,
  );
});
