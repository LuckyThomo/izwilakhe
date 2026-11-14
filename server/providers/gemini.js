import { GoogleGenAI } from "@google/genai";
import { config } from "../config.js";

let client;
export async function callGemini({ model, system, user, schema }) {
  client ??= new GoogleGenAI({ apiKey: config.keys.gemini });
  const res = await client.models.generateContent({
    model,
    contents: user,
    config: { systemInstruction: system, responseMimeType: "application/json" },
  });
  const data = schema.parse(JSON.parse(res.text));
  const u = res.usageMetadata || {};
  return {
    data,
    tokensIn: u.promptTokenCount || 0,
    tokensOut: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
  };
}
