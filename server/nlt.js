// Fetches the passage text from Tyndale's NLT API so the models read the real
// words. The text is used as reading material only and is never displayed.
import { config } from "./config.js";

export async function fetchNlt(passage) {
  const limit = config.keys.nlt ? 500 : 50;
  if (passage.verses > limit) return null;
  const [a, b = a] = passage.osis.split("-");
  const [book, c1, v1] = a.split(".");
  const [, c2, v2] = b.split(".");
  const ref = a === b ? a : c1 === c2 ? `${book}.${c1}.${v1}-${v2}` : `${book}.${c1}.${v1}-${c2}.${v2}`;
  const url = `https://api.nlt.to/api/passages?version=NLT&ref=${encodeURIComponent(ref)}&key=${encodeURIComponent(config.keys.nlt || "TEST")}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<a class="a-tn"[\s\S]*?<\/a>/gi, " ")
      .replace(/<span class="tn"[\s\S]*?<\/span>\s*<\/span>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#8217;|&rsquo;/g, "'").replace(/&[a-z#0-9]+;/gi, " ")
      .replace(/\s+/g, " ").trim();
    return text.length >= 40 && text.length < 60000 ? text : null;
  } catch {
    return null;
  }
}
