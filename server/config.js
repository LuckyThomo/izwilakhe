import fs from "node:fs";
if (fs.existsSync(".env")) process.loadEnvFile(".env");

const env = process.env;
const num = (v) => (v === undefined || v === "" ? null : Number(v));
const bool = (v, d = false) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));

export const config = {
  port: Number(env.PORT || 3080),
  db: {
    host: env.DB_HOST || "127.0.0.1",
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER || "izwilakhe",
    password: env.DB_PASSWORD || "",
    database: env.DB_NAME || "izwilakhe",
    socketPath: env.DB_SOCKET || undefined,
  },
  ownerPassword: env.OWNER_PASSWORD || "",
  sessionSecret: env.SESSION_SECRET || "",
  publicAccess: bool(env.PUBLIC_ACCESS, false),
  visitorDailyLimit: Number(env.VISITOR_DAILY_LIMIT || 3),
  // Optional ceiling on what all visitors together may spend per day (USD). Off when empty.
  visitorDailyBudgetUsd: num(env.VISITOR_DAILY_BUDGET_USD),
  maxVerses: Number(env.MAX_VERSES || 200),
  maxReviewRounds: 2,
  mockAi: bool(env.MOCK_AI, false),
  models: {
    orchestrator: env.ORCHESTRATOR_MODEL || "claude-opus-5-5",
    writerA: env.WRITER_A_MODEL || "claude-sonnet-5-5",
    writerB: env.WRITER_B_MODEL || env.OPENAI_MODEL || "gpt-5.6",
    translator: env.TRANSLATOR_MODEL || env.GEMINI_MODEL || "gemini-2.5-pro",
  },
  // "gemini" or "claude" (Claude = the orchestrator model does the translation).
  translator: (env.TRANSLATOR || "gemini").toLowerCase(),
  keys: { openai: env.OPENAI_API_KEY || "", gemini: env.GEMINI_API_KEY || "", nlt: env.NLT_API_KEY || "" },
  // USD per million tokens [input, output]. Claude prices are the published ones;
  // set the OpenAI and Gemini prices in .env so the cost page can price those steps.
  prices: {
    "claude-opus-5-5": [4, 20],
    "claude-sonnet-5-5": [2, 10],
    openai: [num(env.OPENAI_PRICE_IN), num(env.OPENAI_PRICE_OUT)],
    gemini: [num(env.GEMINI_PRICE_IN), num(env.GEMINI_PRICE_OUT)],
  },
};

export function priceOf(provider, model, tokensIn, tokensOut) {
  const p = config.prices[model] || config.prices[provider];
  if (!p || p[0] == null || p[1] == null) return null;
  return (tokensIn * p[0] + tokensOut * p[1]) / 1e6;
}
