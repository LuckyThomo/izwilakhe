// Stand-in for the real models, used only when MOCK_AI=true (testing without keys).
import { SECTIONS } from "../prompts.js";

const REFS = ["Acts 10:34-35", "Romans 2:11", "Luke 1:1-4", "Acts 1:1-2", "Colossians 4:14", "2 Timothy 4:11", "Acts 28:30-31", "Hezekiah 4:2"];
const para = (who, s) =>
  `[TEST TEXT from ${who}] This paragraph stands in for the section "${s.en}". It is long enough to show how a real paragraph of four to ten lines will sit on the page, with its supporting references beneath it. No AI model was called to produce it, and nothing in it should be read as a statement about the Bible.`;

export async function callMock({ role, schema, user }) {
  await new Promise((r) => setTimeout(r, 400));
  let data;
  if (role === "translate") {
    const list = JSON.parse(user.slice(user.indexOf("[")));
    data = { paragraphs: list.map((p) => "[UMBHALO WOKUHLOLA] " + p) };
  } else if (role === "repair") {
    data = { sections: SECTIONS.map((s) => ({ key: s.key, references: ["John 3:16", "Psalm 119:105", "Romans 10:17"] })) };
  } else {
    const sections = SECTIONS.map((s, i) => ({
      key: s.key,
      paragraph: para(role, s),
      // The last section deliberately carries a reference that does not exist,
      // so the automatic check and repair step are exercised.
      references: i === 6 ? ["Hezekiah 4:2", "Acts 10:99", "Romans 2:11"] : [REFS[i], REFS[(i + 1) % 7]],
    }));
    if (role === "review") {
      const ask = /remaining: 2/.test(user);
      data = ask
        ? { decision: "ask", questions_for_writer_a: ["Which sources place the writer here?"], questions_for_writer_b: [], sections: [] }
        : { decision: "finalize", questions_for_writer_a: [], questions_for_writer_b: [], sections };
    } else data = { sections, uncertainties: ["Test uncertainty."] };
  }
  return { data: schema.parse(data), tokensIn: 2500, tokensOut: 4000 };
}
