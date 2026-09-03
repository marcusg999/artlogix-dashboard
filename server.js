// ============================================================================
// ARTLOGIX AI - DASHBOARD API SERVER
// ============================================================================
// File: server.js (Railway-safe)

import express from 'express'
import cors from 'cors'
import { exec } from 'child_process'
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

  const existing = runningJobs.get(agentId)
  if (existing && existing.status === 'running') {
    return res.status(409).json({
      status: 'already_running',
      agentId,
      jobId: existing.jobId,
      startTime: existing.startTime,
      horizonMonths: existing.horizonMonths ?? null
    })
  }

  const jobId = `${agentId}-${Date.now()}`
  runningJobs.set(agentId, {
    jobId,
    agentId,
    status: 'running',
    startTime: new Date(),
    horizonMonths
  })

  // Fire and forget — the client polls GET /api/run-agent/:agentId for status.
  runAgentAsync(agentId, jobId, horizonMonths)

  res.json({
    status: 'started',
    agentId,
    jobId,
    horizonMonths,
    message: `Agents are running (cwd: ${AGENTS_DIR}`
      + `${horizonMonths ? `, looking ${horizonMonths} months ahead` : ''}). `
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
    error: job.error,
    output: buffer.slice(from - dropped),
    outputLength: dropped + buffer.length
  })
})

async function runAgentAsync(agentId, jobId, horizonMonths) {
  const job = runningJobs.get(agentId)

  try {
    console.log(
      `[${jobId}] Running agent ${agentId}` +
      (horizonMonths ? ` (horizon: ${horizonMonths} months)` : '')
    )

    const command = `npm run agents`

    // execAsync buffers output instead of showing it, so a run triggered from the
    // dashboard was completely opaque: agent progress, warnings and errors all went
    // into job.output and were never displayed. Stream both pipes to this server's
    // console (prefixed with the job id) while still capturing them for the status
    // endpoint, so the terminal running `npm start` shows the run as it happens.
    const child = exec(command, {
      cwd: AGENTS_DIR,
      timeout: 60 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
      // Only override HORIZON_MONTHS when one was chosen, so an unset control
      // leaves whatever the agents' own .env says intact.
      env: horizonMonths
        ? { ...process.env, HORIZON_MONTHS: String(horizonMonths) }
        : process.env
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
    // Keep the buffer bounded, tracking how much was dropped so ?since= offsets
    // stay correct across truncation.
    const MAX_BUFFERED = 1024 * 1024
    job.output = ''
    job.outputOffset = 0

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

    await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', code => {
        code === 0 ? resolve() : reject(new Error(`\`${command}\` exited with code ${code}`))
      })
    })

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
