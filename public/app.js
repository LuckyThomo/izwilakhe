// IzwiLakhe front end. Plain JavaScript, no build step.
const $ = (s) => document.querySelector(s);
const main = $("#main");
// Like replaceChildren, but skips empty values so conditions can be written inline.
const show = (...kids) => main.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    method: opts.method || (opts.body ? "POST" : "GET"),
    headers: opts.body ? { "Content-Type": "application/json" } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2600);
}

// Small dialog: ask({ title, text, input, options, confirm, danger }) -> value | true | null
function ask({ title, text, input, options, confirm = "Save", danger }) {
  return new Promise((resolve) => {
    const dlg = $("#dlg");
    let field = null;
    if (input !== undefined) field = h("input", { type: "text", value: input, maxLength: 200 });
    if (options) field = h("select", {}, options.map((o) => h("option", { value: o.id }, o.name)));
    const done = (v) => { dlg.close(); resolve(v); };
    const form = h("form", { onsubmit: (e) => { e.preventDefault(); done(field ? field.value : true); } },
      h("h3", {}, title),
      text && h("p", { class: "hint", style: "margin:0 0 12px" }, text),
      field,
      h("div", { class: "row end", style: "margin-top:18px" },
        h("button", { type: "button", class: "btn quiet", onclick: () => done(null) }, "Cancel"),
        h("button", { class: "btn" + (danger ? " quiet danger" : "") }, confirm)));
    dlg.replaceChildren(form);
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
    if (field) { field.focus(); field.select?.(); }
  });
}

// ---------- display mode: auto (follow the device), dark, white ----------
function theme() {
  try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; }
}
function setTheme(t) {
  try { localStorage.setItem("theme", t); } catch {}
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}
setTheme(theme());

// ---------- state & navigation ----------
let me = { owner: false, publicAccess: false };
let view = "study";
const TABS = [["study", "Study"], ["history", "History"], ["programs", "Church Programs"], ["costs", "Costs"]];

function drawNav() {
  const nav = $("#nav");
  const tabs = me.owner ? TABS : me.publicAccess ? [TABS[0]] : [];
  nav.replaceChildren(
    ...tabs.map(([id, name]) => h("button", { "aria-current": view === id ? "page" : null, onclick: () => go(id) }, name)),
    me.owner
      ? h("button", { onclick: async () => { await api("/logout", { method: "POST" }); await boot(); } }, "Sign out")
      : h("button", { "aria-current": view === "login" ? "page" : null, onclick: () => go("login") }, "Sign in"),
    h("select", { "aria-label": "Display mode", onchange: (e) => setTheme(e.target.value) },
      h("option", { value: "auto" }, "Auto"), h("option", { value: "dark" }, "Dark"), h("option", { value: "light" }, "White")));
  nav.querySelector("select").value = theme();
}
function go(id) {
  view = id;
  drawNav();
  ({ study: drawStudy, history: () => drawLibrary("history"), programs: () => drawLibrary("programs"), costs: drawCosts, login: drawLogin })[id]();
  window.scrollTo(0, 0);
}
async function boot() {
  me = await api("/me");
  go(me.owner || me.publicAccess ? "study" : "login");
}

// ---------- sign in ----------
function drawLogin() {
  const pw = h("input", { type: "password", id: "pw", autocomplete: "current-password" });
  const err = h("p", { class: "error", hidden: true });
  show(
    h("div", { class: "hero" }, h("h1", {}, "Welcome"), h("p", {}, me.publicAccess ? "Sign in to reach your saved studies and church programs." : "This study tool is private for now. Please sign in."), h("div", { class: "rule" })),
    h("form", { class: "card narrow", onsubmit: async (e) => {
      e.preventDefault();
      try { await api("/login", { body: { password: pw.value } }); await boot(); }
      catch (x) { err.textContent = x.message; err.hidden = false; }
    } }, h("label", { for: "pw" }, "Password"), pw, err, h("div", { class: "row", style: "margin-top:16px" }, h("button", { class: "btn" }, "Sign in"))));
  pw.focus();
}

// ---------- text with highlight and underline ----------
const esc = (t) => { const d = document.createElement("div"); d.textContent = t; return d.innerHTML; };
// Keeps only text, <mark> and <u>; everything else is reduced to its text.
function clean(html) {
  const t = document.createElement("template");
  t.innerHTML = html;
  const walk = (node) => {
    for (const c of [...node.childNodes]) {
      if (c.nodeType === 1) {
        walk(c);
        if (c.tagName === "MARK" || c.tagName === "U") for (const a of [...c.attributes]) c.removeAttribute(a.name);
        else c.replaceWith(...c.childNodes);
      } else if (c.nodeType !== 3) c.remove();
    }
  };
  walk(t.content);
  const d = document.createElement("div");
  d.append(t.content);
  d.normalize();
  return d.innerHTML;
}
function wrapRange(range, tag) {
  const el = document.createElement(tag);
  el.append(range.extractContents());
  range.insertNode(el);
  return el;
}
// A range covering the first occurrence of `str` in the element's text.
function rangeForText(el, str) {
  const at = el.textContent.indexOf(str);
  if (!str || at < 0) return null;
  const range = document.createRange();
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let seen = 0, started = false;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const end = seen + n.length;
    if (!started && at < end) { range.setStart(n, at - seen); started = true; }
    if (started && at + str.length <= end) { range.setEnd(n, at + str.length - seen); return range; }
    seen = end;
  }
  return null;
}
function editableSelection() {
  const sel = getSelection();
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  const node = range.commonAncestorContainer;
  const p = (node.nodeType === 1 ? node : node.parentElement)?.closest("p[data-i]");
  return p && p.isContentEditable ? { range, p } : null;
}

// ---------- study ----------
const LANGS = { en: { name: "English", tag: "Box 1", refs: "Supporting verses" }, zu: { name: "isiZulu", tag: "Box 2", refs: "Amavesi asekelayo" } };

function studyText(study, lang) {
  const out = [`*${study.reference[lang]}*`, ""];
  for (const s of study.sections) {
    const x = s[lang];
    out.push(`*${x.title}*`, x.paragraph);
    if (x.references.length) out.push(`(${x.references.join("; ")})`);
    out.push("");
  }
  return out.join("\n").trim();
}

function studyBox(study, lang, editing) {
  const L = LANGS[lang];
  const text = () => studyText(study, lang);
  return h("section", { class: "card box " + lang, lang: lang === "zu" ? "zu" : "en" },
    h("header", {},
      h("div", {}, h("div", { class: "tag" }, L.tag), h("h2", {}, `${L.name} · ${study.reference[lang]}`)),
      h("span", { class: "spacer" }),
      h("button", { class: "btn small", onclick: async () => { await navigator.clipboard.writeText(text().replaceAll("*", "")); toast("Copied"); } }, "Copy"),
      h("a", { class: "btn small", target: "_blank", rel: "noopener", href: "https://wa.me/?text=" + encodeURIComponent(text()),
        onclick: (e) => { e.currentTarget.href = "https://wa.me/?text=" + encodeURIComponent(text()); } }, "WhatsApp")),
    h("div", { class: "inner", tabIndex: 0, "aria-label": `${L.name} study text` }, study.sections.map((s, i) =>
      h("div", { class: "section" },
        h("h3", { contentEditable: editing ? "true" : "inherit", oninput: (e) => { s[lang].title = e.currentTarget.textContent.trim(); },
          onkeydown: (e) => { if (e.key === "Enter") e.preventDefault(); } }, s[lang].title),
        h("p", { "data-i": i, "data-lang": lang, contentEditable: editing ? "true" : "inherit", innerHTML: clean(s[lang].html ?? esc(s[lang].paragraph)),
          oninput: (e) => syncParagraph(study, e.currentTarget), onkeydown: (e) => { if (e.key === "Enter") e.preventDefault(); } }),
        s[lang].references.length ? h("ul", { class: "refs", "aria-label": L.refs }, s[lang].references.map((r) => h("li", {}, r))) : null))));
}

// Copies what is on screen in a paragraph back into the study's data.
function syncParagraph(study, p) {
  const x = study.sections[Number(p.dataset.i)][p.dataset.lang];
  x.html = clean(p.innerHTML);
  x.paragraph = p.textContent.trim();
}

// Highlight or underline the selected words, then repeat it on the matching
// words in the other language's box.
async function format(study, tag) {
  const picked = editableSelection();
  if (!picked) return toast("First select some words in a paragraph.");
  const { range, p } = picked;
  const selection = range.toString().trim();
  if (!selection) return;
  wrapRange(range, tag);
  getSelection().removeAllRanges();
  syncParagraph(study, p);
  const other = document.querySelector(`p[data-i="${p.dataset.i}"][data-lang="${p.dataset.lang === "en" ? "zu" : "en"}"]`);
  if (!other) return;
  toast("Finding the same words in the other box…");
  try {
    const { match } = await api("/match", { body: { source: p.textContent, selection, target: other.textContent } });
    const r = rangeForText(other, match);
    if (!r) return toast("The same words could not be found in the other box. Please mark them there yourself.");
    wrapRange(r, tag);
    syncParagraph(study, other);
    toast("Marked in both boxes");
  } catch (x) { toast(x.message); }
}
// Removes highlight and underline from every marked piece the selection touches.
function clearFormat(study) {
  const picked = editableSelection();
  if (!picked) return toast("First select the marked words.");
  for (const el of [...picked.p.querySelectorAll("mark, u")]) if (picked.range.intersectsNode(el)) el.replaceWith(...el.childNodes);
  picked.p.normalize();
  syncParagraph(study, picked.p);
}

// Renders a study (both boxes). `extra` is a row of buttons shown above the boxes.
function studyView(study, extra, editing = false) {
  return h("div", {},
    h("div", { class: "study-head" }, h("h1", {}, study.reference.en), h("p", {}, study.reference.zu), h("div", { class: "rule" })),
    h("div", { class: "row end no-print" + (editing ? " toolbar" : "") }, extra, h("button", { class: "btn quiet small", onclick: () => window.print() }, "Print / PDF")),
    studyBox(study, "en", editing), studyBox(study, "zu", editing));
}

async function drawStudy() {
  const folders = me.owner ? await api("/folders?kind=history") : [];
  const ref = h("input", { type: "text", id: "ref", placeholder: "Acts 10:20-48", autocomplete: "off", maxLength: 120 });
  const folder = h("select", { id: "folder" }, h("option", { value: "" }, "N/A (do not save)"), folders.map((f) => h("option", { value: f.id }, f.name)));
  const remembered = localStorage.getItem("folder");
  if (remembered && folders.some((f) => String(f.id) === remembered)) folder.value = remembered;
  const fresh = h("input", { type: "checkbox" });
  const btn = h("button", { class: "btn gold" }, "Study this passage");
  const err = h("p", { class: "error", hidden: true });
  const out = h("div", { "aria-live": "polite" });

  const form = h("form", { class: "card narrow no-print", onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true;
    btn.disabled = true;
    localStorage.setItem("folder", folder.value);
    const stage = h("p", {}, "Starting");
    out.replaceChildren(h("div", { class: "progress" }, h("div", { class: "lamp" }), stage, h("p", { class: "hint" }, "A careful study takes a minute or two. Please keep this page open.")));
    try {
      const { jobId } = await api("/studies", { body: { reference: ref.value, folderId: folder.value || null, fresh: fresh.checked } });
      for (;;) {
        await new Promise((r) => setTimeout(r, 1500));
        const j = await api("/studies/" + jobId);
        stage.textContent = j.stage;
        if (j.status === "error") throw new Error(j.error);
        if (j.status === "done") { showResult(j.result, j.itemId); break; }
      }
    } catch (x) {
      out.replaceChildren();
      err.textContent = x.message;
      err.hidden = false;
    }
    btn.disabled = false;
    if (!me.owner) me = await api("/me").catch(() => me), drawLimit();
  } },
    h("label", { for: "ref" }, "Bible passage"), ref,
    h("p", { class: "hint" }, "Type the book, chapter and verses. Nothing else is needed."),
    me.owner && [h("label", { for: "folder" }, "Save in History folder"), folder,
      h("label", { class: "check" }, fresh, "Prepare a fresh study, even if this passage was studied before")],
    err,
    h("div", { class: "row", style: "margin-top:18px" }, btn));

  const limit = h("p", { class: "hint", style: "text-align:center" });
  const drawLimit = () => { limit.textContent = me.owner ? "" : `Studies left for you today: ${me.remaining} of ${me.limit}`; };
  drawLimit();

  function showResult(study, itemId) {
    const savedIn = itemId && folders.find((f) => String(f.id) === folder.value);
    let extra = null;
    if (me.owner && savedIn) extra = [h("span", { class: "hint" }, `Saved in History › ${savedIn.name}`),
      h("button", { class: "btn quiet small", onclick: () => { view = "history"; drawNav(); drawLibrary("history", itemId); } }, "Edit, highlight or underline")];
    else if (me.owner && folders.length) extra = h("button", { class: "btn quiet small", onclick: async (e) => {
      const id = await ask({ title: "Save this study", text: "Choose the History folder.", options: folders, confirm: "Save" });
      if (!id) return;
      await api("/items", { body: { folderId: id, title: study.reference.en, body: { type: "study", ...study } } });
      e.target.replaceWith(h("span", { class: "hint" }, "Saved in History"));
    } }, "Save to History…");
    out.replaceChildren(studyView(study, extra));
    out.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  show(
    me.testMode && h("p", { class: "notice narrow" }, "Test mode is on: no AI is being called and the text shown is placeholder text."),
    h("div", { class: "hero no-print" }, h("h1", {}, "Understand the passage"), h("p", {}, "Enter a Bible passage to see who wrote it, where and when, what was happening, and what it says to us today. In English and isiZulu."), h("div", { class: "rule" })),
    form, limit, out);
  ref.focus();
}

// ---------- History & Church Programs (same folder/item library) ----------
async function drawLibrary(kind, openId) {
  const isHistory = kind === "history";
  const noun = isHistory ? "study" : "document";
  let folders = [], current = null, term = "";
  const side = h("div", { class: "card" });
  const pane = h("div", { class: "card" });
  show(
    h("div", { class: "hero" }, h("h1", {}, isHistory ? "History" : "Church Programs"),
      h("p", {}, isHistory ? "Your saved studies, kept in folders and listed alphabetically." : "Your own folders and documents for church programs, orders of service and notes."), h("div", { class: "rule" })),
    h("div", { class: "lib" }, side, pane));

  async function load(keepId) {
    folders = await api("/folders?kind=" + kind);
    current = folders.find((f) => f.id === (keepId ?? current?.id)) || folders[0] || null;
    drawSide();
    await drawItems();
  }

  function drawSide() {
    side.replaceChildren(
      h("div", { class: "row" }, h("h3", {}, "Folders"), h("span", { class: "spacer" }),
        h("button", { class: "btn small", onclick: async () => {
          const name = await ask({ title: "New folder", input: "", confirm: "Create" });
          if (!name?.trim()) return;
          const { id } = await api("/folders", { body: { kind, name } });
          await load(id);
        } }, "New folder")),
      folders.length
        ? h("ul", { class: "list" }, folders.map((f) => h("li", {},
            h("button", { class: "folder", "aria-current": f.id === current?.id ? "true" : null, onclick: () => { term = ""; current = f; drawSide(); drawItems(); } },
              h("span", {}, f.name), h("span", { class: "n" }, f.count)))))
        : h("p", { class: "empty" }, "No folders yet."));
  }

  async function drawItems() {
    if (!current) return pane.replaceChildren(h("p", { class: "empty" }, "Create a folder to begin."));
    const items = await api(`/items?folder=${current.id}&q=${encodeURIComponent(term)}`);
    const search = h("input", { type: "search", placeholder: `Search in ${current.name}`, value: term, "aria-label": "Search this folder" });
    let timer;
    search.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { term = search.value; await drawItems(); const s = pane.querySelector("input[type=search]"); s.focus(); s.setSelectionRange(term.length, term.length); }, 300); };
    const f = current;
    pane.replaceChildren(
      h("div", { class: "row" }, h("h2", {}, f.name), h("span", { class: "spacer" }),
        !isHistory && h("button", { class: "btn small", onclick: async () => {
          const title = await ask({ title: "New document", input: "", confirm: "Create" });
          if (!title?.trim()) return;
          const { id } = await api("/items", { body: { folderId: f.id, title, body: { type: "doc", text: "" } } });
          openItem(id);
        } }, "New document"),
        h("button", { class: "btn quiet small", onclick: async () => {
          const name = await ask({ title: "Rename folder", input: f.name });
          if (name?.trim()) { await api("/folders/" + f.id, { method: "PATCH", body: { name } }); await load(); }
        } }, "Rename"),
        h("button", { class: "btn quiet small", onclick: async () => { const { id } = await api(`/folders/${f.id}/copy`, { method: "POST" }); await load(id); toast("Folder copied"); } }, "Copy"),
        h("button", { class: "btn quiet small danger", onclick: async () => {
          if (await ask({ title: `Delete "${f.name}"?`, text: `The folder and the ${f.count} ${noun}${f.count === 1 ? "" : "s"} inside it will be deleted. This cannot be undone.`, confirm: "Delete", danger: true })) { await api("/folders/" + f.id, { method: "DELETE" }); current = null; await load(); }
        } }, "Delete")),
      h("div", { style: "margin-top:14px" }, search),
      items.length
        ? h("ul", { class: "list" }, items.map((it) => h("li", { class: "item" },
            h("button", { class: "name", onclick: () => openItem(it.id) }, it.title),
            h("small", {}, new Date(it.updated_at).toLocaleDateString()),
            itemActions(it, () => load()))))
        : h("p", { class: "empty" }, term ? "Nothing in this folder matches your search." : isHistory ? "No studies saved here yet. Choose this folder on the Study page to save one." : "No documents here yet."));
  }

  // Rename, copy, move and delete for one study or document. Used both in the
  // folder's list and on the opened study or document itself.
  function itemActions(it, after) {
    const elsewhere = folders.filter((f) => f.id !== it.folder_id);
    return h("span", { class: "row" },
      h("button", { class: "btn quiet small", onclick: async () => {
        const title = await ask({ title: "Rename", input: it.title });
        if (title?.trim()) { await api("/items/" + it.id, { method: "PATCH", body: { title } }); await after("renamed"); }
      } }, "Rename"),
      h("button", { class: "btn quiet small", onclick: async () => {
        const id = await ask({ title: `Copy "${it.title}"`, text: "Choose the folder to paste the copy into.", options: folders, confirm: "Copy here" });
        if (id) { await api(`/items/${it.id}/copy`, { body: { folderId: Number(id) } }); toast("Copied"); await after("copied"); }
      } }, "Copy"),
      elsewhere.length ? h("button", { class: "btn quiet small", onclick: async () => {
        const id = await ask({ title: `Move "${it.title}"`, text: "Choose the folder to move it to.", options: elsewhere, confirm: "Move" });
        if (id) { await api("/items/" + it.id, { method: "PATCH", body: { folderId: Number(id) } }); toast("Moved"); await after("moved"); }
      } }, "Move") : null,
      h("button", { class: "btn quiet small danger", onclick: async () => {
        if (await ask({ title: `Delete "${it.title}"?`, text: "This cannot be undone.", confirm: "Delete", danger: true })) { await api("/items/" + it.id, { method: "DELETE" }); await after("deleted"); }
      } }, "Delete"));
  }

  async function openItem(id, startEditing = false) {
    const it = await api("/items/" + id);
    const here = folders.find((f) => f.id === it.folder_id);
    const actions = () => itemActions(it, (what) => (what === "deleted" ? drawLibrary(kind) : openItem(id)));
    const hold = (fn) => ({ onmousedown: (e) => e.preventDefault(), onclick: fn }); // keep the text selection when a button is pressed
    const back = h("button", { class: "btn quiet small", onclick: () => drawLibrary(kind).then(() => {}) }, "‹ Back to " + (isHistory ? "History" : "Church Programs"));
    if (it.body.type === "study") {
      const draw = (editing) => {
        const tools = editing
          ? [h("button", { class: "btn quiet small", ...hold(() => format(it.body, "mark")) }, "Highlight"),
             h("button", { class: "btn quiet small", ...hold(() => format(it.body, "u")) }, "Underline"),
             h("button", { class: "btn quiet small", ...hold(() => clearFormat(it.body)) }, "Clear marking"),
             h("span", { class: "spacer" }),
             h("button", { class: "btn gold", onclick: async () => { await api("/items/" + id, { method: "PATCH", body: { body: it.body } }); toast("Saved"); draw(false); } }, "Save"),
             h("button", { class: "btn quiet small", onclick: () => openItem(id) }, "Cancel")]
          : [h("button", { class: "btn small", onclick: () => draw(true) }, "Edit, highlight or underline")];
        show(h("div", { class: "row no-print" }, back, h("span", { class: "hint" }, `${here?.name ?? ""} › ${it.title}`), h("span", { class: "spacer" }), !editing && actions()),
          editing && h("p", { class: "hint no-print", style: "margin:12px 0 0" }, "Type in any heading or paragraph to change it. To highlight or underline, select words and press the button; the same words are then marked in the other box. Press Save when you are done; nothing is kept until you do."),
          studyView(it.body, tools, editing));
      };
      draw(startEditing);
    } else {
      const title = h("input", { type: "text", value: it.title, maxLength: 200, "aria-label": "Title" });
      const text = h("textarea", { value: it.body.text || "", "aria-label": "Document text", placeholder: "Write or paste here…" });
      const save = async () => { await api("/items/" + id, { method: "PATCH", body: { title: title.value, body: { type: "doc", text: text.value } } }); toast("Saved"); };
      show(
        h("div", { class: "row no-print" }, back, h("span", { class: "hint" }, `${here?.name ?? ""} › ${it.title}`), h("span", { class: "spacer" }), actions()),
        h("div", { class: "card", style: "margin-top:14px" },
          h("label", {}, "Title"), title, h("label", {}, "Text"), text,
          h("div", { class: "row no-print", style: "margin-top:14px" },
            h("button", { class: "btn", onclick: save }, "Save"),
            h("button", { class: "btn quiet", onclick: async () => { await navigator.clipboard.writeText(text.value); toast("Copied"); } }, "Copy all"),
            h("a", { class: "btn quiet", target: "_blank", rel: "noopener", href: "#", onclick: (e) => { e.currentTarget.href = "https://wa.me/?text=" + encodeURIComponent(`*${title.value}*\n\n${text.value}`); } }, "WhatsApp"),
            h("button", { class: "btn quiet", onclick: () => window.print() }, "Print / PDF"))));
    }
    window.scrollTo(0, 0);
  }

  await load();
  if (openId) await openItem(openId, true);
}

// ---------- costs ----------
const usd = (v, d = 2) => (v == null ? "—" : "$" + Number(v).toFixed(d));
async function drawCosts() {
  const { totals: t, runs } = await api("/costs");
  const rows = [];
  for (const r of runs) {
    const detail = h("tr", { class: "steps", hidden: true }, h("td", { colSpan: 6 },
      r.error && h("p", { class: "error", style: "margin:0 0 8px" }, r.error),
      r.steps.length ? h("table", {},
        h("thead", {}, h("tr", {}, ["Step", "Model"].map((x) => h("th", {}, x)), ["Tokens in", "Tokens out", "Seconds", "Cost"].map((x) => h("th", { class: "num" }, x)))),
        h("tbody", {}, r.steps.map((s) => h("tr", {}, h("td", {}, s.label + (s.error ? " (failed)" : "")), h("td", {}, s.model),
          h("td", { class: "num" }, s.tokensIn.toLocaleString()), h("td", { class: "num" }, s.tokensOut.toLocaleString()),
          h("td", { class: "num" }, (s.ms / 1000).toFixed(1)), h("td", { class: "num" }, s.cost == null ? "price not set" : usd(s.cost, 4))))))
        : h("span", { class: "hint" }, r.cached ? "Served from a saved copy; no AI was called." : "No steps recorded.")));
    rows.push(h("tr", {},
      h("td", {}, new Date(r.created_at).toLocaleString()),
      h("td", {}, r.ref_en),
      h("td", {}, r.requester === "owner" ? "You" : "Visitor"),
      h("td", {}, r.ref_en === "Highlight match" ? "Marking" : r.status === "error" ? "Failed" : r.cached ? "Saved copy" : "New study"),
      h("td", { class: "num" }, r.cached ? usd(0) : r.cost_usd == null ? "price not set" : usd(r.cost_usd, 4)),
      h("td", {}, h("button", { class: "btn quiet small", onclick: () => { detail.hidden = !detail.hidden; } }, "Steps"))), detail);
  }
  show(
    h("div", { class: "hero" }, h("h1", {}, "Costs"), h("p", {}, "The measured cost of every study, in US dollars. Only you can see this page."), h("div", { class: "rule" })),
    Number(t.unpriced) > 0 && h("p", { class: "notice" }, `${t.unpriced} ${Number(t.unpriced) === 1 ? "study has" : "studies have"} a step with no price set, so the totals below leave ${Number(t.unpriced) === 1 ? "it" : "them"} out. Set the OpenAI and Gemini prices in the server settings to include them.`),
    h("div", { class: "tiles" },
      h("div", { class: "tile" }, h("b", {}, usd(t.today)), h("span", {}, "Today")),
      h("div", { class: "tile" }, h("b", {}, usd(t.month)), h("span", {}, "This month")),
      h("div", { class: "tile" }, h("b", {}, usd(t.total)), h("span", {}, "All time")),
      h("div", { class: "tile" }, h("b", {}, usd(t.average, 3)), h("span", {}, "Average per new study")),
      h("div", { class: "tile" }, h("b", {}, String(t.studies)), h("span", {}, `Studies (${Number(t.cached || 0)} from saved copies)`))),
    h("div", { class: "card scroll" }, runs.length
      ? h("table", {}, h("thead", {}, h("tr", {}, ["When", "Passage", "Who", "Kind"].map((x) => h("th", {}, x)), h("th", { class: "num" }, "Cost"), h("th", {}, ""))), h("tbody", {}, rows))
      : h("p", { class: "empty" }, "No studies yet.")));
}

boot().catch((e) => show(h("p", { class: "error" }, e.message)));
