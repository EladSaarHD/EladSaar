# Receiptify — self-hosted receipt & invoice manager

Receiptify is a private, local clone of [WellyBox](https://www.wellybox.com/). Collect your
business receipts and invoices, let AI extract the vendor / amount / date / tax,
organize everything in a searchable dashboard, and export for accounting — all
running on your own machine. Nothing leaves your computer.

## Features

- **Three ingestion sources**
  - Drag-and-drop **file upload** (images or PDFs)
  - **Watched folder** — anything dropped in a configured folder is auto-imported
  - **Email inbox (IMAP)** — polls your mailbox and pulls receipt/invoice attachments
- **AI extraction** via a pluggable adapter:
  - Default: shell out to the **Codex CLI** for vendor / date / total / currency / tax / category
  - Fallback: offline **Tesseract OCR** (optional dependency)
  - Always **manually editable** — a bad or missing extraction never blocks you
- **Dashboard** with search + filters (vendor, category, date range, amount)
- **Summary reports** — totals by month, category, and top vendors (with charts)
- **ZIP export** of the original files (organized by year/month, plus a `manifest.csv`)
- **Auto-categorization rules** (WellyBox-style vendor/filename → category)
- **Deduplication** by file content hash (and email message id)

## Requirements

- **Node.js 18+**
- **[Codex CLI](https://developers.openai.com/codex/cli)** on your `PATH` (for AI extraction). Optional — the app runs fine in `manual` mode without it.
- Optional system tools:
  - **poppler** (`pdftoppm`) — renders PDF receipts to an image so they can be AI/OCR-extracted (`brew install poppler` / `apt install poppler-utils`). Without it, PDFs are still stored, just filled in manually.
  - **tesseract.js** — offline OCR fallback (`npm install tesseract.js`).

## Setup

```bash
npm install
cp .env.example .env       # then edit .env to taste
npm run build              # build the web UI
npm start                  # → http://localhost:4000
```

For development with hot-reload (API + Vite dev server):

```bash
npm run dev                # API on :4000, UI on :5173
```

## Configuration

Edit `.env` (gitignored). Key settings:

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 4000) |
| `DATA_DIR` | Where receipts + the SQLite DB live (default `./data`) |
| `EXTRACTOR` | `codex` \| `tesseract` \| `manual` |
| `CODEX_COMMAND` / `CODEX_ARGS` | How to invoke Codex. `{image}` and `{prompt}` are substituted. |
| `WATCH_DIR` | Folder to auto-import from (empty = disabled) |
| `IMAP_HOST` / `IMAP_USER` / `IMAP_PASSWORD` / … | Email inbox source (empty host = disabled) |

You can instead copy `config.example.json` → `config.local.json` for a JSON
config that overrides `.env`.

### Confirming the Codex invocation

Codex CLI flags vary by version. Confirm how to pass an image + prompt
non-interactively with:

```bash
codex exec --help
```

Then set `CODEX_ARGS` accordingly, keeping the `{image}` and `{prompt}`
placeholders. The default is:

```
CODEX_ARGS=exec --image {image} {prompt}
```

The adapter is fully command-driven, so you can point it at **any** CLI that
reads an image and prints JSON (e.g. `claude -p`) without touching code.

## Security notes

- The server binds to **127.0.0.1 only** — it is not exposed to your network.
- Secrets (IMAP password) live in `.env` / `config.local.json`, which are
  gitignored. Use an **app-specific password** for email.
- The `/data` folder (your receipts + database) is gitignored.

## How it works

Every source funnels through one pipeline (`server/pipeline/ingest.js`):

```
file → sha256 dedupe → store on disk → extract (Codex→OCR→manual)
     → apply category rules → save row in SQLite
```

## Project layout

```
server/   Express API, SQLite, extraction adapters, ingestion sources
web/      Vite + React dashboard
data/     runtime receipts + receiptify.db (gitignored)
```

## API quick reference

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/receipts/upload` | upload one or more files |
| `GET` | `/api/receipts` | list/filter receipts |
| `GET` | `/api/receipts/:id/file` | stream original file |
| `PATCH` | `/api/receipts/:id` | edit fields |
| `DELETE` | `/api/receipts/:id` | delete |
| `GET` | `/api/reports` | summary aggregations |
| `GET` | `/api/export/zip` | download ZIP of filtered receipts |
| `GET`/`POST`/`DELETE` | `/api/settings/rules` | manage auto-category rules |
