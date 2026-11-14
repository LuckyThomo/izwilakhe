// Reads the passage text from the World English Bible, a public-domain modern
// English translation bundled with the app. Nothing is fetched over the network,
// so this cannot fail at study time. The text is reading material for the models
// only and is never displayed.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const dir = path.join(path.dirname(createRequire(import.meta.url).resolve("world-english-bible/package.json")), "json");
const FILES = {
  Gen: "genesis", Exod: "exodus", Lev: "leviticus", Num: "numbers", Deut: "deuteronomy", Josh: "joshua", Judg: "judges",
  Ruth: "ruth", "1Sam": "1samuel", "2Sam": "2samuel", "1Kgs": "1kings", "2Kgs": "2kings", "1Chr": "1chronicles",
  "2Chr": "2chronicles", Ezra: "ezra", Neh: "nehemiah", Esth: "esther", Job: "job", Ps: "psalms", Prov: "proverbs",
  Eccl: "ecclesiastes", Song: "songofsolomon", Isa: "isaiah", Jer: "jeremiah", Lam: "lamentations", Ezek: "ezekiel",
  Dan: "daniel", Hos: "hosea", Joel: "joel", Amos: "amos", Obad: "obadiah", Jonah: "jonah", Mic: "micah", Nah: "nahum",
  Hab: "habakkuk", Zeph: "zephaniah", Hag: "haggai", Zech: "zechariah", Mal: "malachi", Matt: "matthew", Mark: "mark",
  Luke: "luke", John: "john", Acts: "acts", Rom: "romans", "1Cor": "1corinthians", "2Cor": "2corinthians",
  Gal: "galatians", Eph: "ephesians", Phil: "philippians", Col: "colossians", "1Thess": "1thessalonians",
  "2Thess": "2thessalonians", "1Tim": "1timothy", "2Tim": "2timothy", Titus: "titus", Phlm: "philemon", Heb: "hebrews",
  Jas: "james", "1Pet": "1peter", "2Pet": "2peter", "1John": "1john", "2John": "2john", "3John": "3john", Jude: "jude",
  Rev: "revelation",
};
const cache = new Map();

export function passageText(passage) {
  try {
    const [a, b = a] = passage.osis.split("-").map((s) => s.split("."));
    const book = a[0];
    if (!cache.has(book)) cache.set(book, JSON.parse(fs.readFileSync(path.join(dir, FILES[book] + ".json"), "utf8")));
    const from = Number(a[1]) * 1000 + Number(a[2]);
    const to = Number(b[1]) * 1000 + Number(b[2]);
    const verses = new Map();
    for (const e of cache.get(book)) {
      if (!e.value || !e.verseNumber) continue;
      const at = e.chapterNumber * 1000 + e.verseNumber;
      if (at < from || at > to) continue;
      const key = `${e.chapterNumber}:${e.verseNumber}`;
      verses.set(key, (verses.get(key) || "") + e.value);
    }
    const text = [...verses].map(([k, v]) => `${k} ${v.replace(/\s+/g, " ").trim()}`).join("\n");
    return text || null;
  } catch {
    return null;
  }
}
