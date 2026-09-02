# ArtLogix AI Dashboard

Local web dashboard for the [ArtLogix AI](https://github.com/marcusg999/artlogixai) agent
system. It runs the agents, shows the prospects they find, and exports them to PDF.

This is a **local tool**. It needs a Node server (`server.js`) and a checkout of the agents
repo on the same machine — it is not designed to be hosted.

## Setup

**Prerequisites:** Node.js 20+, a Supabase project, and the
[artlogixai](https://github.com/marcusg999/artlogixai) repo cloned and configured (its own
README covers the API keys it needs).

```bash
git clone https://github.com/marcusg999/artlogix-dashboard
cd artlogix-dashboard
npm install

cat > .env << 'EOF'
PORT=3001
SUPABASE_URL=your-supabase-url
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
# AGENTS_DIR=/path/to/artlogixai   # only if the agents repo isn't a sibling directory
EOF

npm start        # or: npm run dev  (nodemon)
```

Open **http://localhost:3001**.

| Variable | Required | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | yes | The database the agents write prospects to |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Service-role key — a publishable (`sb_publishable_…`) key won't work |
| `PORT` | no | Defaults to `3001` |
| `AGENTS_DIR` | no | Path to the agents repo. Defaults to `../artlogixai` |

The server exits immediately with a named error if a required variable is missing.

### Directory layout it expects

```
parent/
├── artlogixai/          # the agents repo (with its own .env)
└── artlogix-dashboard/  # this repo
```

If your layout differs, point `AGENTS_DIR` at the agents checkout.

## Using it

### Running the agents

Click **▶️ Run All Agents**. The server runs `npm run agents` in `AGENTS_DIR`, which scrapes
every source — 38 museums, 111 galleries, auctions, fairs, collector searches, press — and
writes prospects straight to Supabase.

A full run takes **20+ minutes**, and over an hour if you've lowered `FIRECRAWL_RPM` in the
agents repo. While it runs:

- A status banner shows elapsed time, agent cards stay highlighted, and the Run buttons are
  disabled.
- Agent progress streams into the activity log — agents starting and finishing, prospects
  being saved, rate-limit warnings, the Firecrawl usage summary, and errors.
- The stat tiles and prospects table refresh as results land, since prospects are saved per
  agent rather than all at the end.
- The same output also streams to the terminal running `npm start`, prefixed with the job id.

If the run exits non-zero the log says **"Run failed: …"** rather than reporting success.
Reloading the page reattaches to a run already in flight.

Two things worth knowing:

- **Every Run button runs everything.** The agents scrape all sources in one process, so
  there is no per-agent entry point — the per-card ▶️ Run buttons and Run All do the same
  thing. The enable/disable toggles are display state only.
- **Runs cost API credits** (Firecrawl and Anthropic). Concurrent runs are de-duplicated:
  triggering while one is in flight returns HTTP 409 and follows the existing run.

### Exporting to PDF

**⬇ Download PDF** exports the prospects table as
`artlogix-prospects-YYYY-MM-DD.pdf` — name, type, lead score, status, contact email, phone,
estimated value, and timeline. It exports the rows currently shown, so filter first if you
want a subset.

Contact email and phone are only populated when the agents ran with contact scraping enabled
(`SCRAPE_CONTACTS` is on by default in the agents repo; turning it off uses roughly 4x fewer
Firecrawl requests but leaves those columns empty).

## API

```
GET  /api/health                       # { status: "online", ... }
GET  /api/stats                        # prospect counts + type breakdown
GET  /api/prospects?limit=&minScore=   # prospects, newest first
POST /api/run-agent                    # start a run  → 409 if one is in flight
GET  /api/run-agent/:agentId?since=    # run status + output appended after `since`
```

## Troubleshooting

**Stats show 0 / the table is empty.** No prospects in Supabase yet. Run the agents and watch
the activity log — if the run ends with a `🔥 Firecrawl:` line reporting rate limits, that is
a Firecrawl plan limit, not a bug; the agents repo's README explains how to slow the run down.

**"Failed to fetch prospects".** The server couldn't reach Supabase. Check `SUPABASE_URL` and
that `SUPABASE_SERVICE_ROLE_KEY` is the *service-role* key — a publishable key is blocked by
row-level security.

**A run fails instantly.** The agents repo is missing its own `.env`, or `AGENTS_DIR` points
at the wrong place. The activity log carries the agents' own error message.

**PDF button does nothing.** It should now always say why. jsPDF loads from a CDN, so a script
blocker or being offline will stop it — the dashboard reports that rather than failing
silently.

**Port already in use.** Set `PORT=3002` in `.env`, or `lsof -ti:3001 | xargs kill`.

## License

MIT
