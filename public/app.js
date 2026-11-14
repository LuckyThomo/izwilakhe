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
    h("div", { class: "inner" }, study.sections.map((s) =>
      h("div", { class: "section" },
        h("h3", {}, s[lang].title),
        h("p", { contentEditable: editing ? "true" : "inherit", oninput: (e) => { s[lang].paragraph = e.currentTarget.innerText.trim(); } }, s[lang].paragraph),
        s[lang].references.length ? h("ul", { class: "refs", "aria-label": L.refs }, s[lang].references.map((r) => h("li", {}, r))) : null))));
}

// Renders a study (both boxes). `extra` is a row of buttons shown above the boxes.
function studyView(study, extra, editing = false) {
  return h("div", {},
    h("div", { class: "study-head" }, h("h1", {}, study.reference.en), h("p", {}, study.reference.zu), h("div", { class: "rule" })),
    h("div", { class: "row end no-print" }, extra, h("button", { class: "btn quiet small", onclick: () => window.print() }, "Print / PDF")),
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
    if (me.owner && savedIn) extra = h("span", { class: "hint" }, `Saved in History › ${savedIn.name}`);
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
async function drawLibrary(kind) {
  const isHistory = kind === "history";
  const noun = isHistory ? "study" : "document";
  let folders = [], current = null, term = "";
  const side = h("div", { class: "card" });
  const pane = h("div", { class: "card" });
  show(
    h("div", { class: "hero" }, h("h1", {}, isHistory ? "History" : "Church Programs"),
      h("p", {}, isHistory ? "Your saved studies, kept in folders and listed alphabetically." : "Your own folders and documents for church programs, orders of service and notes."), h("div", { class: "rule" })),
    h("div", { class: "lib" }, side, pane));

  const others = () => folders.filter((f) => f.id !== current?.id);
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
            h("span", { class: "row" },
              h("button", { class: "btn quiet small", onclick: async () => {
                const title = await ask({ title: "Rename", input: it.title });
                if (title?.trim()) { await api("/items/" + it.id, { method: "PATCH", body: { title } }); await drawItems(); }
              } }, "Rename"),
              h("button", { class: "btn quiet small", onclick: async () => {
                const id = await ask({ title: `Copy "${it.title}"`, text: "Choose the folder to paste the copy into.", options: folders, confirm: "Copy here" });
                if (id) { await api(`/items/${it.id}/copy`, { body: { folderId: Number(id) } }); await load(); toast("Copied"); }
              } }, "Copy"),
              others().length ? h("button", { class: "btn quiet small", onclick: async () => {
                const id = await ask({ title: `Move "${it.title}"`, text: "Choose the folder to move it to.", options: others(), confirm: "Move" });
                if (id) { await api("/items/" + it.id, { method: "PATCH", body: { folderId: Number(id) } }); await load(); toast("Moved"); }
              } }, "Move") : null,
              h("button", { class: "btn quiet small danger", onclick: async () => {
                if (await ask({ title: `Delete "${it.title}"?`, text: "This cannot be undone.", confirm: "Delete", danger: true })) { await api("/items/" + it.id, { method: "DELETE" }); await load(); }
              } }, "Delete")))))
        : h("p", { class: "empty" }, term ? "Nothing in this folder matches your search." : isHistory ? "No studies saved here yet. Choose this folder on the Study page to save one." : "No documents here yet."));
  }

  async function openItem(id) {
    const it = await api("/items/" + id);
    const back = h("button", { class: "btn quiet small", onclick: () => drawLibrary(kind).then(() => {}) }, "‹ Back to " + (isHistory ? "History" : "Church Programs"));
    if (it.body.type === "study") {
      const draw = (editing) => {
        const actions = editing
          ? [h("button", { class: "btn small", onclick: async () => { await api("/items/" + id, { method: "PATCH", body: { body: it.body } }); toast("Changes saved"); draw(false); } }, "Save changes"),
             h("button", { class: "btn quiet small", onclick: () => openItem(id) }, "Cancel")]
          : [h("button", { class: "btn quiet small", onclick: () => draw(true) }, "Edit text")];
        show(h("div", { class: "row no-print" }, back, h("span", { class: "hint" }, it.title)), studyView(it.body, actions, editing));
      };
      draw(false);
    } else {
      const title = h("input", { type: "text", value: it.title, maxLength: 200, "aria-label": "Title" });
      const text = h("textarea", { value: it.body.text || "", "aria-label": "Document text", placeholder: "Write or paste here…" });
      const save = async () => { await api("/items/" + id, { method: "PATCH", body: { title: title.value, body: { type: "doc", text: text.value } } }); toast("Saved"); };
      show(
        h("div", { class: "row no-print" }, back),
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
      h("td", {}, r.status === "error" ? "Failed" : r.cached ? "Saved copy" : "New study"),
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
