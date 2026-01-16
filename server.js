// ============================================================================
// ARTLOGIX AI - DASHBOARD API SERVER
// ============================================================================
// File: server.js (Railway-safe)

import express from 'express'
import cors from 'cors'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'


cat > temp.js << 'EOF'
import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

// DEBUG: Log environment variables (remove after fixing)
console.log('🔍 Environment Check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_SERVICE_KEY:', process.env.SUPABASE_SERVICE_KEY ? '✅ Set' : '❌ Missing');
console.log('PORT:', process.env.PORT || '3001');

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;
EOF

# This shows what we need to add - but let me create the full fix
Actually, let's do a complete fix with better error handling:
bashcd ~/artlogix-ai/artlogix-dashboard

# Backup current server.js
cp server.js server.js.backup

# Create new server.js with better error handling
cat > server.js << 'EOF'
import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const execAsync = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Check for required environment variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ Missing required environment variables!');
  console.error('SUPABASE_URL:', SUPABASE_URL ? '✅' : '❌ MISSING');
  console.error('SUPABASE_SERVICE_KEY:', SUPABASE_KEY ? '✅' : '❌ MISSING');
  console.error('');
  console.error('Please set these in Railway Dashboard -> Variables tab');
  process.exit(1);
}

// Create Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Store running jobs
const runningJobs = new Map();

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    supabase: SUPABASE_URL ? 'connected' : 'not configured'
  });
});

// Get system stats
app.get('/api/stats', async (req, res) => {
  try {
    const { count: totalProspects } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true });

    const { count: hotLeads } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('lead_score', 90);

    const { count: qualifiedLeads } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('lead_score', 80)
      .lt('lead_score', 90);

    const { data: latestProspect } = await supabase
      .from('prospects')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    res.json({
      totalProspects: totalProspects || 0,
      hotLeads: hotLeads || 0,
      qualifiedLeads: qualifiedLeads || 0,
      lastRun: latestProspect?.created_at || null,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats', details: error.message });
  }
});

// Get recent prospects
app.get('/api/prospects', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    const minScore = parseInt(req.query.minScore) || 0;

    const { data: prospects, error } = await supabase
      .from('prospects')
      .select('*')
      .gte('lead_score', minScore)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({
      prospects: prospects || [],
      count: prospects?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching prospects:', error);
    res.status(500).json({ error: 'Failed to fetch prospects' });
  }
});

// Run all agents
app.post('/api/run-all', async (req, res) => {
  res.json({
    message: 'Agent execution not available in this deployment',
    note: 'Run agents locally with: npm run agents'
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║          ARTLOGIX AI - DASHBOARD API                       ║
║  Server: http://localhost:${PORT}                           ║
╚════════════════════════════════════════════════════════════╝
  `);
  console.log('✅ Supabase connected');
  console.log('🚀 Server ready');
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  process.exit(0);
});
EOF

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

const execAsync = promisify(exec)
const app = express()
const PORT = process.env.PORT || 3001

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

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

async function runAgentAsync(agentId, jobId) {
  const job = runningJobs.get(agentId)

  try {
    console.log(`[${jobId}] Running agent ${agentId}`)

    const command = `npm run agents`

    const { stdout } = await execAsync(command, {
      cwd: __dirname,
      timeout: 60 * 60 * 1000
    })

    job.status = 'completed'
    job.output = stdout
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
