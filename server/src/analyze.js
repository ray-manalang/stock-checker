import { fetchQuote } from "./stocks.js";
import { buildAnalysisPrompt } from "./prompt.js";
import { callLlm } from "./llm.js";
import { parseAnalysis } from "./parseAnalysis.js";

export async function analyzeTicker(ticker) {
  const quote = await fetchQuote(ticker);
  const prompt = buildAnalysisPrompt(quote);
  const rawAnalysis = await callLlm(prompt);
  const analysis = parseAnalysis(rawAnalysis);

  return { quote, analysis };
}
