# IzwiLakhe (izwilakhe.online)

A Bible-study web app. Enter a passage and it prepares an eight-part background
study (the writer, where he was, who was with him, the world around him, why he wrote, the events
leading up to it, what was on his heart, and the message for us), each part with
supporting verse references, in English and in isiZulu.

## How a study is made

1. The passage is checked by code; only a real Bible passage is accepted.
2. The passage text is read from the World English Bible (public domain, bundled with the app, no network needed) as reading material for the models; it is never displayed.
3. Three writers (Claude Sonnet, ChatGPT and Gemini) each draft the study independently.
4. Claude Opus reviews the drafts, may send questions back at most twice, then writes the final study.
5. Every supporting reference is checked by code to exist in the Bible; Zulu book names come from a fixed table in `server/bible.js`.
6. Claude Opus translates the final English into isiZulu.
7. The tokens and cost of every step are recorded and shown on the owner's Costs page.

A passage that was studied before is served from the saved copy at no cost.

## Features

- Study page with a "Save in History folder" choice (N/A saves nothing).
- History: folders and studies with rename, copy, move, delete, search, alphabetical order, and text editing.
- Church Programs: your own folders and documents.
- Copy, WhatsApp share and Print / PDF.
- Auto, Dark and White display modes.
- Owner sign-in with no limit; visitors (when `PUBLIC_ACCESS=true`) get 3 studies a day.

## Run on a server (Docker)

```bash
cp .env.example .env
```

Fill in `.env`, then:

```bash
docker compose up -d --build
```

The app listens on `127.0.0.1:3080`. Point the domain at it with the server's
web server; `deploy/nginx.conf` is an example. It does not touch other sites on
the same server.

## Run locally without AI keys

Set `MOCK_AI=true` in `.env` (placeholder text, no AI calls), have a MySQL or
MariaDB database available, then `npm install` and `npm start`.

## Settings

All settings are in `.env`; see `.env.example` for each one. The section titles
and the instructions given to the models are in `server/prompts.js`.
