import "dotenv/config";
import express from "express";
import cors from "cors";
import { analyzeTicker } from "./analyze.js";

const app = express();
const port = Number(process.env.PORT) || 3001;

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

app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
