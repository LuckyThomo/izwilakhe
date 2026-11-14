// Bible reference parsing and validation. References are checked by code against
// the real chapter/verse structure of the Bible, never taken on trust from an AI.
import { bcv_parser } from "bible-passage-reference-parser/esm/bcv_parser.js";
import * as en from "bible-passage-reference-parser/esm/lang/en.js";

// [OSIS code, English name, isiZulu name]. Zulu names follow the common Zulu Bible
// book titles; edit this table to correct any name.
export const BOOKS = [
  ["Gen", "Genesis", "UGenesise"], ["Exod", "Exodus", "U-Eksodusi"], ["Lev", "Leviticus", "ULevitikusi"],
  ["Num", "Numbers", "UNumeri"], ["Deut", "Deuteronomy", "UDuteronomi"], ["Josh", "Joshua", "UJoshuwa"],
  ["Judg", "Judges", "AbAhluleli"], ["Ruth", "Ruth", "URuthe"], ["1Sam", "1 Samuel", "1 USamuweli"],
  ["2Sam", "2 Samuel", "2 USamuweli"], ["1Kgs", "1 Kings", "1 AmaKhosi"], ["2Kgs", "2 Kings", "2 AmaKhosi"],
  ["1Chr", "1 Chronicles", "1 IziKronike"], ["2Chr", "2 Chronicles", "2 IziKronike"], ["Ezra", "Ezra", "U-Ezra"],
  ["Neh", "Nehemiah", "UNehemiya"], ["Esth", "Esther", "U-Esteri"], ["Job", "Job", "UJobe"],
  ["Ps", "Psalm", "AmaHubo"], ["Prov", "Proverbs", "IzAga"], ["Eccl", "Ecclesiastes", "UmShumayeli"],
  ["Song", "Song of Songs", "IsiHlabelelo SeziHlabelelo"], ["Isa", "Isaiah", "U-Isaya"], ["Jer", "Jeremiah", "UJeremiya"],
  ["Lam", "Lamentations", "IsiLilo"], ["Ezek", "Ezekiel", "UHezekeli"], ["Dan", "Daniel", "UDaniyeli"],
  ["Hos", "Hosea", "UHoseya"], ["Joel", "Joel", "UJoweli"], ["Amos", "Amos", "U-Amose"],
  ["Obad", "Obadiah", "U-Obadiya"], ["Jonah", "Jonah", "UJona"], ["Mic", "Micah", "UMika"],
  ["Nah", "Nahum", "UNahume"], ["Hab", "Habakkuk", "UHabakuki"], ["Zeph", "Zephaniah", "UZefaniya"],
  ["Hag", "Haggai", "UHagayi"], ["Zech", "Zechariah", "UZakariya"], ["Mal", "Malachi", "UMalaki"],
  ["Matt", "Matthew", "NgokukaMathewu"], ["Mark", "Mark", "NgokukaMarku"], ["Luke", "Luke", "NgokukaLuka"],
  ["John", "John", "NgokukaJohane"], ["Acts", "Acts", "IzEnzo"], ["Rom", "Romans", "KwabaseRoma"],
  ["1Cor", "1 Corinthians", "1 KwabaseKorinte"], ["2Cor", "2 Corinthians", "2 KwabaseKorinte"],
  ["Gal", "Galatians", "KwabaseGalathiya"], ["Eph", "Ephesians", "Kwabase-Efesu"], ["Phil", "Philippians", "KwabaseFilipi"],
  ["Col", "Colossians", "KwabaseKolose"], ["1Thess", "1 Thessalonians", "1 KwabaseThesalonika"],
  ["2Thess", "2 Thessalonians", "2 KwabaseThesalonika"], ["1Tim", "1 Timothy", "1 KuThimothewu"],
  ["2Tim", "2 Timothy", "2 KuThimothewu"], ["Titus", "Titus", "KuThithu"], ["Phlm", "Philemon", "KuFilemoni"],
  ["Heb", "Hebrews", "KumaHeberu"], ["Jas", "James", "EkaJakobe"], ["1Pet", "1 Peter", "1 EkaPetru"],
  ["2Pet", "2 Peter", "2 EkaPetru"], ["1John", "1 John", "1 EkaJohane"], ["2John", "2 John", "2 EkaJohane"],
  ["3John", "3 John", "3 EkaJohane"], ["Jude", "Jude", "EkaJuda"], ["Rev", "Revelation", "IsAmbulo"],
];
const BY_OSIS = new Map(BOOKS.map(([o, e, z]) => [o, { en: e, zu: z }]));

function newParser() {
  const p = new bcv_parser(en);
  p.set_options({
    osis_compaction_strategy: "bcv",
    consecutive_combination_strategy: "separate",
    sequence_combination_strategy: "separate",
    invalid_passage_strategy: "ignore",
    invalid_sequence_strategy: "ignore",
    book_alone_strategy: "ignore",
  });
  return p;
}
const CHAPTERS = newParser().translation_info("default").chapters;

function point(s) {
  const [book, c, v] = s.split(".");
  return { book, c: Number(c), v: Number(v) };
}

// "Acts.10.20-Acts.10.48" -> { en: "Acts 10:20-48", zu: "IzEnzo 10:20-48", verses: 29 }
function describe(osis) {
  const [a, b = a] = osis.split("-").map(point);
  const names = BY_OSIS.get(a.book);
  if (!names || a.book !== b.book) return null;
  const counts = CHAPTERS[a.book];
  const single = counts.length === 1;
  const wholeChapters = a.v === 1 && b.v === counts[b.c - 1];
  let tail;
  if (wholeChapters && !single) tail = a.c === b.c ? `${a.c}` : `${a.c}-${b.c}`;
  else if (a.c === b.c) tail = a.v === b.v ? `${a.c}:${a.v}` : `${a.c}:${a.v}-${b.v}`;
  else tail = `${a.c}:${a.v}-${b.c}:${b.v}`;
  let verses = 0;
  for (let c = a.c; c <= b.c; c++) {
    const from = c === a.c ? a.v : 1;
    const to = c === b.c ? b.v : counts[c - 1];
    verses += to - from + 1;
  }
  const explicit = a.c === b.c ? `${a.c}:${a.v}-${b.v}` : `${a.c}:${a.v}-${b.c}:${b.v}`;
  return { osis, en: `${names.en} ${tail}`, zu: `${names.zu} ${tail}`, verses, explicit };
}

// Parse free text ("Acts 10 verse 20-48") into exactly one valid passage, or null.
export function parsePassage(text) {
  const p = newParser();
  const found = p.parse(String(text || "").slice(0, 120)).osis_and_indices();
  if (found.length !== 1) return null;
  return describe(found[0].osis);
}

// Validate a reference written by an AI. Rejects anything that does not exist,
// including references the parser would otherwise quietly clamp (e.g. Acts 10:99).
export function checkReference(text) {
  const d = parsePassage(text);
  if (!d) return null;
  const nums = (s) => (s.match(/\d+/g) || []).join(",");
  const given = nums(String(text).trim().replace(/^[1-3]\s?(?=[A-Za-z])/, ""));
  const forms = [nums(d.en.replace(/^[1-3] /, "")), nums(d.explicit)];
  if (!forms.some((f) => f === given || f.endsWith("," + given))) return null;
  return d;
}
