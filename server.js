// ============================================================================
// ARTLOGIX AI - DASHBOARD API SERVER
// ============================================================================
// File: server.js (Railway-safe)

import express from 'express'
import cors from 'cors'
import { spawn } from 'child_process'
import fs from 'fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

dotenv.config()

// ---------------------------------------------------------------------------
// ENV VALIDATION (FAIL FAST)
// --------------------------------------------------------------------------

const REQUIRED_ENVS = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
]

for (const key of REQUIRED_ENVS) {
  if (!process.env[key]) {
    console.error(`❌ Missing required env var: ${key}`)
    process.exit(1)
  }
}


// ---------------------------------------------------------------------------
// SETUP
// ---------------------------------------------------------------------------

const app = express()
const PORT = process.env.PORT || 3001

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Directory of the ArtLogix agents repo (where `npm run agents` is defined).
// Defaults to a sibling `artlogixai` checkout; override with AGENTS_DIR.
const AGENTS_DIR = process.env.AGENTS_DIR || path.resolve(__dirname, '..', 'artlogixai')

// How long a run may take before it is killed.
//
// This was an hour, which is less than a full run can possibly take. Firecrawl
// is paced at FIRECRAWL_RPM (8 by default, so 7.5s between every request) and
// every request is serialised: ~605 requests for 38 museums, 110 galleries and
// the smaller sources, plus their contact pages, is 1h16m of scraping before a
// single Claude call. Runs were being SIGTERMed partway through and reported as
// "exited with code null", which names neither the signal nor the cause.
//
// Six hours is a ceiling for a stuck run, not a target — a healthy full run
// finishes well inside it. Lower RUN_TIMEOUT_MINUTES for a narrower region, or
// raise it if the pace is slowed further.
const RUN_TIMEOUT_MS = Math.max(1, Number(process.env.RUN_TIMEOUT_MINUTES) || 360) * 60_000

// Variables the agents child must inherit as-is: the shell and npm need them to
// start the process at all, long before the agents' own dotenv could supply them.
const PROCESS_CRITICAL_ENV = new Set([
  'PATH', 'HOME', 'SHELL', 'PWD', 'TMPDIR', 'USER', 'LOGNAME', 'LANG', 'NODE'
])

/**
 * Builds the environment for an agents run.
 *
 * A child process inherits this server's environment, and dotenv deliberately
 * refuses to overwrite a variable that is already set. Together those meant the
 * dashboard's .env — loaded at startup, and easily months out of date — silently
 * won every key it shared with the agents' own .env: the agents read their file
 * and then discarded what they had read. A stale ANTHROPIC_API_KEY here failed
 * every extraction call with 401 while the working key sat unread in
 * artlogixai/.env, so runs scraped normally and produced nothing.
 *
 * Forcing the agents' dotenv to override everything would fix the credentials
 * and break the run controls, clobbering the window and region chosen in the UI.
 * So instead this drops exactly the keys the agents' .env defines, leaving their
 * dotenv to fill those in itself. The dashboard still supplies anything their
 * file leaves out, and the caller re-applies per-run choices on top.
 *
 * Returns the deferred key *names* for the run log — never their values.
 */
function agentEnvironment() {
  const env = { ...process.env }
  const deferred = []

  let owned
  try {
    owned = dotenv.parse(fs.readFileSync(path.join(AGENTS_DIR, '.env')))
  } catch {
    // No readable .env beside the agents: there is nothing to defer to, so pass
    // ours through unchanged rather than starving the run of credentials.
    return { env, deferred }
  }

  for (const key of Object.keys(owned)) {
    if (PROCESS_CRITICAL_ENV.has(key)) continue
    if (!(key in env)) continue
    delete env[key]
    deferred.push(key)
  }

  return { env, deferred: deferred.sort() }
}

// Middleware
app.use(cors())
app.use(express.json())
app.use(express.static('public'))

// ---------------------------------------------------------------------------
// SUPABASE CLIENT (SERVICE ROLE)
// ---------------------------------------------------------------------------

console.log('Railway ENV check:', {
  url: process.env.SUPABASE_URL ? '✅' : '❌',
  serviceRole: process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅' : '❌'
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false }
  }
);





// ---------------------------------------------------------------------------
// JOB TRACKING
// ---------------------------------------------------------------------------

const runningJobs = new Map()

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/api/health', (_, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  })
})

// ---------------------------------------------------------------------------
// STATS
// ---------------------------------------------------------------------------

app.get('/api/stats', async (_, res) => {
  try {
    const { count: totalProspects } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })

    const { count: hotLeads } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('lead_score', 90)

    const { count: qualifiedLeads } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('lead_score', 80)
      .lt('lead_score', 90)

    const { data: latestProspect } = await supabase
      .from('prospects')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // How many could actually be contacted. The agents cap an unreachable
    // prospect below 60, so this is the number that decides whether a run was
    // worth its Firecrawl spend — the headline count on its own hides a table
    // full of dead ends.
    const { count: reachable } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .or('contact_email.not.is.null,contact_phone.not.is.null,contact_name.not.is.null')

    const { data: byType } = await supabase
      .from('prospects')
      .select('client_type')

    const typeBreakdown = {}
    byType?.forEach(p => {
      typeBreakdown[p.client_type] =
        (typeBreakdown[p.client_type] || 0) + 1
    })

    res.json({
      totalProspects: totalProspects || 0,
      reachable: reachable || 0,
      hotLeads: hotLeads || 0,
      qualifiedLeads: qualifiedLeads || 0,
      lastRun: latestProspect?.created_at || null,
      typeBreakdown,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    console.error('Stats error:', err)
    res.status(500).json({ error: 'Failed to fetch stats' })
  }
})

// ---------------------------------------------------------------------------
// PROSPECTS
// ---------------------------------------------------------------------------

app.get('/api/prospects', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 50
    const minScore = Number(req.query.minScore) || 0

    const { data, error } = await supabase
      .from('prospects')
      .select('*')
      .gte('lead_score', minScore)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error

    res.json({
      prospects: data || [],
      count: data?.length || 0,
      timestamp: new Date().toISOString()
    })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Failed to fetch prospects' })
  }
})

// ---------------------------------------------------------------------------
// AGENT EXECUTION (RAILWAY SAFE)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RUN AGENTS
// ---------------------------------------------------------------------------
//
// Kicks off `npm run agents` in the ArtLogix agents repo (AGENTS_DIR) in the
// background and returns immediately. The agents run ALL sources (museums,
// 111 galleries, auctions, fairs, collectors, press) and write straight to
// Supabase — this can take several minutes and consumes Firecrawl/Anthropic
// credits, so it is de-duplicated per agentId while a run is in flight.

// How far ahead a run looks. Mirrors the agents' own clamp so the dashboard
// can't ask for a window the agents would silently reject.
const MIN_HORIZON_MONTHS = 1
const MAX_HORIZON_MONTHS = 60

// Restrict a run to sources in one region. Mirrors resolveRegionFilter() in the
// agents repo so the dashboard can't send a value they'd ignore.
function resolveRegion(raw) {
  const value = String(raw ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  if (value === 'california' || value === 'ca') return 'california'
  if (value === 'los-angeles' || value === 'la' || value === 'losangeles') return 'los-angeles'
  return null
}

function resolveHorizonMonths(raw) {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.min(MAX_HORIZON_MONTHS, Math.max(MIN_HORIZON_MONTHS, Math.floor(parsed)))
}

app.post('/api/run-agent', (req, res) => {
  const agentId = req.body?.agentId || 'all'

  // Choosing the window in the dashboard beats editing the agents' .env and
  // restarting: it is passed to this run's process only, leaving .env alone.
  // Omitted (or unusable) means the agents fall back to their own default.
  const horizonMonths = resolveHorizonMonths(req.body?.horizonMonths)
  const region = resolveRegion(req.body?.region)

  const existing = runningJobs.get(agentId)
  if (existing && existing.status === 'running') {
    return res.status(409).json({
      status: 'already_running',
      agentId,
      jobId: existing.jobId,
      startTime: existing.startTime,
      horizonMonths: existing.horizonMonths ?? null,
      region: existing.region ?? null
    })
  }

  const jobId = `${agentId}-${Date.now()}`
  runningJobs.set(agentId, {
    jobId,
    agentId,
    status: 'running',
    startTime: new Date(),
    horizonMonths,
    region
  })

  // Fire and forget — the client polls GET /api/run-agent/:agentId for status.
  runAgentAsync(agentId, jobId, horizonMonths, region)

  res.json({
    status: 'started',
    agentId,
    jobId,
    horizonMonths,
    region,
    message: `Agents are running (cwd: ${AGENTS_DIR}`
      + `${horizonMonths ? `, looking ${horizonMonths} months ahead` : ''}`
      + `${region ? `, ${region} only` : ''}). `
      + `Results are written to Supabase.`,
    timestamp: new Date().toISOString()
  })
})

// Poll a run's status.
//
// A run's output reaches hundreds of KB and the dashboard polls this every few
// seconds to show live progress, so the whole buffer must not be re-sent each
// time. Callers pass ?since=<offset> and get only what was appended after it,
// plus the new absolute offset to send next time.
// Whether anything is running, without asking for a job by name.
//
// The page calls this on every load to reattach to a run in progress. It used
// to ask `/api/run-agent/all`, which 404s when no job exists — the normal state
// — so every page load logged a console error the code then deliberately
// ignored. An error that is always there is one nobody reads when it matters.
app.get('/api/run-agent', (_, res) => {
  const running = [...runningJobs.values()].find(job => job.status === 'running')
  if (!running) return res.json({ status: 'idle' })

  res.json({
    jobId: running.jobId,
    agentId: running.agentId,
    status: running.status,
    startTime: running.startTime,
    horizonMonths: running.horizonMonths ?? null,
    region: running.region ?? null,
    outputLength: (running.outputOffset || 0) + (running.output || '').length
  })
})

app.get('/api/run-agent/:agentId', (req, res) => {
  const job = runningJobs.get(req.params.agentId)
  if (!job) return res.status(404).json({ status: 'not_found' })

  const dropped = job.outputOffset || 0
  const buffer = job.output || ''
  // Never rewind past what is still buffered, and never re-send what the caller
  // already has.
  const from = Math.min(Math.max(Number(req.query.since) || 0, dropped), dropped + buffer.length)

  res.json({
    jobId: job.jobId,
    agentId: job.agentId,
    status: job.status,
    startTime: job.startTime,
    endTime: job.endTime,
    horizonMonths: job.horizonMonths ?? null,
    region: job.region ?? null,
    error: job.error,
    output: buffer.slice(from - dropped),
    outputLength: dropped + buffer.length
  })
})

// A detached child would otherwise survive this server and keep scraping with
// nothing watching it or saving its status.
const liveRuns = new Set()

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const stop of liveRuns) stop('SIGTERM')
    process.exit(0)
  })
}

async function runAgentAsync(agentId, jobId, horizonMonths, region) {
  const job = runningJobs.get(agentId)

  try {
    console.log(
      `[${jobId}] Running agent ${agentId}` +
      (horizonMonths ? ` (horizon: ${horizonMonths} months)` : '') +
      (region ? ` (region: ${region})` : '')
    )

    const command = `npm run agents`

    // Keep the buffer bounded, tracking how much was dropped so ?since= offsets
    // stay correct across truncation. Initialised before the child starts so the
    // run's own configuration can be recorded ahead of its first line of output.
    const MAX_BUFFERED = 1024 * 1024
    job.output = ''
    job.outputOffset = 0

    const note = line => {
      job.output += `${line}\n`
      console.log(`[${jobId}] ${line}`)
    }

    const { env: agentEnv, deferred } = agentEnvironment()
    if (deferred.length > 0) {
      // Names only. Which file a credential came from is exactly what was
      // impossible to see when a stale key here shadowed a working one there.
      note(`🔑 Reading ${deferred.join(', ')} from the agents' own .env`)
    }

    // spawn rather than exec: exec buffers the child's entire output to hand to a
    // callback, and kills the child when that buffer fills — a real ceiling on a
    // run that logs per source for hours, and one this code does not need, since
    // both pipes are streamed below and the copy kept for the status endpoint is
    // separately bounded. Streaming also means output reaches the terminal as the
    // run happens instead of at the end.
    const child = spawn(command, {
      cwd: AGENTS_DIR,
      shell: true,
      // The command runs through a shell, so the agents are a *grandchild*:
      // shell -> npm -> node. Signalling the shell alone leaves that node
      // process running, holding the pipes open and spending Firecrawl credits
      // long after this server has given up on it — which is what the old
      // one-hour timeout did every time it fired. Detaching makes the child a
      // process-group leader so the whole tree can be signalled together.
      detached: true,
      env: {
        ...agentEnv,
        // Applied last, and left set, so a window or region chosen for this run
        // survives the agents' dotenv — which will not overwrite what is already
        // here. An unset control stays absent, leaving their .env to decide.
        ...(horizonMonths ? { HORIZON_MONTHS: String(horizonMonths) } : {}),
        ...(region ? { REGION: region } : {})
      }
    })

    // Prefix every line (not just the first of each chunk) so the run is easy to
    // follow and grep in a terminal that is also serving HTTP requests.
    const relay = (stream, chunk) => {
      for (const line of String(chunk).replace(/\n$/, '').split('\n')) {
        stream.write(`[${jobId}] ${line}\n`)
      }
    }

    // Append to job.output as it arrives (rather than only at exit) so the
    // dashboard can show the run live instead of waiting for it to finish.
    const capture = (stream, chunk) => {
      job.output += chunk
      if (job.output.length > MAX_BUFFERED) {
        const excess = job.output.length - MAX_BUFFERED
        job.output = job.output.slice(excess)
        job.outputOffset += excess
      }
      relay(stream, chunk)
    }

    child.stdout?.on('data', chunk => capture(process.stdout, chunk))
    child.stderr?.on('data', chunk => capture(process.stderr, chunk))

    // Enforced here rather than by spawn so the reason survives: a killed child
    // reports a null exit code and nothing else, which is how an hour-long
    // timeout came to look like an unexplained crash.
    // Signals the whole process group, so npm and the node process under it go
    // too. Negating the pid addresses the group; ESRCH just means it is already
    // gone, which is the normal race when a run finishes as the timer fires.
    const stopRun = signal => {
      try {
        process.kill(-child.pid, signal)
      } catch (err) {
        if (err.code !== 'ESRCH') console.error(`[${jobId}] Could not send ${signal}:`, err.message)
      }
    }

    liveRuns.add(stopRun)

    let timedOut = false
    const killAt = setTimeout(() => {
      timedOut = true
      note(`⛔ Run exceeded ${RUN_TIMEOUT_MS / 60_000} minutes — stopping it.`)
      stopRun('SIGTERM')
      // A run mid-scrape may not stop on a polite signal.
      setTimeout(() => stopRun('SIGKILL'), 10_000).unref()
    }, RUN_TIMEOUT_MS)

    try {
      await new Promise((resolve, reject) => {
        child.on('error', reject)
        child.on('close', (code, signal) => {
          if (code === 0) return resolve()

          // Prospects are saved per source, so whatever was scraped before this
          // point is already in the table — say so, rather than implying the run
          // produced nothing.
          if (timedOut) {
            return reject(new Error(
              `\`${command}\` ran past the ${RUN_TIMEOUT_MS / 60_000}-minute limit and was stopped. ` +
              `Prospects found before then are saved. Raise RUN_TIMEOUT_MINUTES, ` +
              `narrow the region, or turn off SCRAPE_CONTACTS to finish inside it.`
            ))
          }

          if (signal) {
            return reject(new Error(
              `\`${command}\` was killed by ${signal} — stopped from outside this server ` +
              `(a manual kill, or the machine running out of memory). ` +
              `Prospects found before then are saved.`
            ))
          }

          reject(new Error(`\`${command}\` exited with code ${code}`))
        })
      })
    } finally {
      clearTimeout(killAt)
      liveRuns.delete(stopRun)
    }

    job.status = 'completed'
    job.endTime = new Date()

    setTimeout(() => runningJobs.delete(agentId), 300_000)
  } catch (err) {
    console.error(`[${jobId}] Failed`, err)
    job.status = 'failed'
    job.error = err.message
    job.endTime = new Date()

    setTimeout(() => runningJobs.delete(agentId), 300_000)
  }
}

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║        ARTLOGIX AI – DASHBOARD API (Railway)              ║
╚════════════════════════════════════════════════════════════╝
🚀 Port: ${PORT}
🧠 Supabase: Connected
  `)
})
