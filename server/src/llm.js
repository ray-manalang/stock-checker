const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";

const DEFAULT_MODEL =
  process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

/** Same contract as asUtility.SubmitRequestToGCPAPI (Gemini generateContent). */
export async function callLlm(prompt) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com/apikey and add it to server/.env",
    );
  }

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.8,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const bodyText = await res.text();

  if (!res.ok) {
    let detail = bodyText.slice(0, 300);
    try {
      const errJson = JSON.parse(bodyText);
      detail = errJson?.error?.message ?? detail;
    } catch {
      /* use raw slice */
    }
    throw new Error(`Gemini request failed (${res.status}): ${detail}`);
  }

  let json;
  try {
    json = JSON.parse(bodyText);
  } catch {
    throw new Error("Gemini returned non-JSON response");
  }

  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    const blockReason = json?.promptFeedback?.blockReason;
    throw new Error(
      blockReason
        ? `Gemini blocked the response: ${blockReason}`
        : "Gemini returned no text in candidates",
    );
  }

  return text;
}
