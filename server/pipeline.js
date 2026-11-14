// The study pipeline: two writers draft independently, the orchestrator reviews
// (at most two rounds of questions), writes the final study, references are
// checked by code, and the result is translated into isiZulu.
import { config, priceOf } from "./config.js";
import { checkReference } from "./bible.js";
import { fetchNlt } from "./nlt.js";
import * as P from "./prompts.js";
import { callClaude } from "./providers/claude.js";
import { callOpenAI } from "./providers/openai.js";
import { callGemini } from "./providers/gemini.js";
import { callMock } from "./providers/mock.js";

const providerOf = (model) => (/^claude/.test(model) ? "claude" : /^gemini/.test(model) ? "gemini" : "openai");

async function call(steps, label, role, model, args) {
  const provider = config.mockAi ? "mock" : providerOf(model);
  const started = Date.now();
  const fn = { claude: callClaude, openai: callOpenAI, gemini: callGemini, mock: callMock }[provider];
  let out, lastErr;
  for (let attempt = 0; attempt < 2 && !out; attempt++) {
    try {
      out = await fn({ model, role, ...args });
    } catch (err) {
      lastErr = err;
    }
  }
  const step = { label, provider, model, ms: Date.now() - started };
  if (!out) {
    steps.push({ ...step, tokensIn: 0, tokensOut: 0, cost: 0, error: String(lastErr?.message || lastErr).slice(0, 300) });
    throw lastErr;
  }
  steps.push({ ...step, tokensIn: out.tokensIn, tokensOut: out.tokensOut, cost: config.mockAi ? 0 : priceOf(provider, model, out.tokensIn, out.tokensOut) });
  return out.data;
}

// Put sections in the fixed order and require all seven.
function ordered(sections) {
  const byKey = new Map((sections || []).map((s) => [s.key, s]));
  if (P.SECTIONS.some((s) => !byKey.get(s.key)?.paragraph?.trim())) return null;
  return P.SECTIONS.map((s) => ({ key: s.key, paragraph: byKey.get(s.key).paragraph.trim(), references: byKey.get(s.key).references || [] }));
}

function validRefs(list, passage) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const d = checkReference(raw);
    if (!d || d.osis === passage.osis || seen.has(d.osis)) continue;
    seen.add(d.osis);
    out.push({ en: d.en, zu: d.zu });
  }
  return out.slice(0, 4);
}

export async function runStudy(passage, onStage = () => {}) {
  const steps = [];
  const M = config.models;
  try {
    onStage("Reading the passage");
    const text = await fetchNlt(passage);

    onStage("Two writers are studying the passage");
    const user = P.writerUser(passage, text);
    const draft = (label, model, userMsg) =>
      call(steps, label, "writer", model, { system: P.WRITER_SYSTEM, user: userMsg, schema: P.DraftSchema, name: "draft", effort: "high" })
        .then((d) => (ordered(d.sections) ? d : null))
        .catch(() => null);
    let [a, b] = await Promise.all([draft("Writer A draft", M.writerA, user), draft("Writer B draft", M.writerB, user)]);
    if (!a && !b) throw new Error("Neither writer could produce a draft. Please try again.");

    let final = null;
    for (let round = 0; round <= config.maxReviewRounds && !final; round++) {
      const left = config.maxReviewRounds - round;
      onStage(round === 0 ? "The reviewer is comparing the two drafts" : `The reviewer is checking the answers (round ${round})`);
      const review = await call(steps, `Review ${round + 1}`, "review", M.orchestrator, {
        system: P.REVIEW_SYSTEM, user: P.reviewUser(passage, text, a, b, left), schema: P.ReviewSchema, name: "review", effort: "high",
      });
      const qa = a ? review.questions_for_writer_a.filter(Boolean) : [];
      const qb = b ? review.questions_for_writer_b.filter(Boolean) : [];
      if (review.decision === "ask" && left > 0 && (qa.length || qb.length)) {
        onStage(`The writers are answering the reviewer's questions (round ${round + 1})`);
        const [a2, b2] = await Promise.all([
          qa.length ? draft(`Writer A answers ${round + 1}`, M.writerA, P.followUpUser(passage, a, qa)) : a,
          qb.length ? draft(`Writer B answers ${round + 1}`, M.writerB, P.followUpUser(passage, b, qb)) : b,
        ]);
        a = a2 || a;
        b = b2 || b;
        continue;
      }
      final = ordered(review.sections);
      if (!final && left === 0) throw new Error("The reviewer did not return a complete study. Please try again.");
    }
    if (!final) throw new Error("The reviewer did not return a complete study. Please try again.");

    // References: checked by code. One repair attempt for sections left short.
    let refs = final.map((s) => validRefs(s.references, passage));
    const short = P.SECTIONS.filter((_, i) => refs[i].length < 2).map((s) => s.key);
    if (short.length) {
      onStage("Checking the supporting verses");
      const fix = await call(steps, "Reference repair", "repair", M.orchestrator, {
        system: P.REPAIR_SYSTEM, user: P.repairUser(passage, final, short), schema: P.RepairSchema, name: "references", effort: "low",
      }).catch(() => null);
      for (const f of fix?.sections || []) {
        const i = P.SECTIONS.findIndex((s) => s.key === f.key);
        if (i >= 0 && short.includes(f.key))
          refs[i] = validRefs([...final[i].references.filter((r) => checkReference(r)), ...f.references], passage);
      }
    }

    onStage("Translating into isiZulu");
    const english = final.map((s) => s.paragraph);
    const viaClaude = config.translator === "claude";
    const tr = await call(steps, "Translation", "translate", viaClaude ? M.orchestrator : M.translator, {
      system: P.TRANSLATE_SYSTEM, user: JSON.stringify(english), schema: P.TranslationSchema, name: "translation", effort: "medium",
    });
    const zulu = (tr.paragraphs || []).map((p) => String(p).trim());
    if (zulu.length !== english.length || zulu.some((p) => !p)) throw new Error("The translation came back incomplete. Please try again.");

    const result = {
      reference: { en: passage.en, zu: passage.zu },
      grounded: Boolean(text),
      sections: P.SECTIONS.map((s, i) => ({
        key: s.key,
        en: { title: s.en, paragraph: english[i], references: refs[i].map((r) => r.en) },
        zu: { title: s.zu, paragraph: zulu[i], references: refs[i].map((r) => r.zu) },
      })),
    };
    return { result, steps };
  } catch (err) {
    err.steps = steps;
    throw err;
  }
}

export function totalCost(steps) {
  if (steps.some((s) => s.cost == null)) return null; // a price is not set
  return steps.reduce((n, s) => n + s.cost, 0);
}
