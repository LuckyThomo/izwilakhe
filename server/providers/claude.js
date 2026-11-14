import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";

let client;
export async function callClaude({ model, system, user, schema, effort }) {
  client ??= new Anthropic({ timeout: 8 * 60 * 1000 });
  const res = await client.messages.parse({
    model,
    max_tokens: 16000,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort, format: zodOutputFormat(schema) },
  });
  if (res.stop_reason === "refusal") throw new Error(`${model} declined to answer this passage.`);
  if (res.stop_reason === "max_tokens" || !res.parsed_output) throw new Error(`${model} returned an incomplete answer.`);
  const u = res.usage;
  return {
    data: res.parsed_output,
    tokensIn: u.input_tokens + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    tokensOut: u.output_tokens,
  };
}
