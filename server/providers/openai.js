import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { config } from "../config.js";

let client;
export async function callOpenAI({ model, system, user, schema, name }) {
  client ??= new OpenAI({ apiKey: config.keys.openai, timeout: 8 * 60 * 1000 });
  const res = await client.responses.parse({
    model,
    instructions: system,
    input: user,
    text: { format: zodTextFormat(schema, name) },
  });
  if (!res.output_parsed) throw new Error(`${model} returned an incomplete answer.`);
  return { data: res.output_parsed, tokensIn: res.usage?.input_tokens || 0, tokensOut: res.usage?.output_tokens || 0 };
}
