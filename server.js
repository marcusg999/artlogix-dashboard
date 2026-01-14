// ============================================================================
// ARTLOGIX AI - DASHBOARD API SERVER
// ============================================================================
// File: server/index.js
// Express.js API for triggering agents and fetching stats

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
app.use(express.static('public')); // Serve dashboard HTML

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Store running jobs
const runningJobs = new Map();

// ============================================================================
// ROUTES
// ============================================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Get system stats
app.get('/api/stats', async (req, res) => {
  try {
    // Get total prospects
    const { count: totalProspects } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true });

    // Get hot leads (90+)
    const { count: hotLeads } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('lead_score', 90);

    // Get qualified (80-89)
    const { count: qualifiedLeads } = await supabase
      .from('prospects')
      .select('*', { count: 'exact', head: true })
      .gte('lead_score', 80)
      .lt('lead_score', 90);

    // Get most recent prospect
    const { data: latestProspect } = await supabase
      .from('prospects')
      .select('created_at')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    // Get prospects by agent type
    const { data: byType } = await supabase
      .from('prospects')
      .select('client_type');

    const typeBreakdown = {};
    byType?.forEach(p => {
      typeBreakdown[p.client_type] = (typeBreakdown[p.client_type] || 0) + 1;
    });

    res.json({
      totalProspects: totalProspects || 0,
      hotLeads: hotLeads || 0,
      qualifiedLeads: qualifiedLeads || 0,
      lastRun: latestProspect?.created_at || null,
      typeBreakdown,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
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

// Run specific agent
app.post('/api/run-agent', async (req, res) => {
  const { agentId, agentName } = req.body;

  if (!agentId) {
    return res.status(400).json({ error: 'Agent ID required' });
  }

  // Check if already running
  if (runningJobs.has(agentId)) {
    return res.status(409).json({
      error: 'Agent already running',
      jobId: runningJobs.get(agentId).jobId
    });
  }

  const jobId = `${agentId}-${Date.now()}`;

  // Create job tracking
  runningJobs.set(agentId, {
    jobId,
    agentId,
    agentName,
    startTime: new Date(),
    status: 'running'
  });

  res.json({
    message: `Starting ${agentName || agentId}`,
    jobId,
    status: 'running'
  });

  // Run agent asynchronously
  runAgentAsync(agentId, jobId);
});

// Run all agents
app.post('/api/run-all', async (req, res) => {
  const jobId = `all-${Date.now()}`;

  res.json({
    message: 'Starting all agents',
    jobId,
    status: 'running'
  });

  // Run all agents asynchronously
  runAllAgentsAsync(jobId);
});

// Get job status
app.get('/api/job/:jobId', (req, res) => {
  const { jobId } = req.params;
  
  // Search for job in running jobs
  for (const [agentId, job] of runningJobs.entries()) {
    if (job.jobId === jobId) {
      return res.json(job);
    }
  }

  res.status(404).json({ error: 'Job not found' });
});

// Get activity logs
app.get('/api/logs', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;

    // Get recent outreach logs
    const { data: logs, error } = await supabase
      .from('outreach_log')
      .select(`
        *,
        prospects (name, client_type, lead_score)
      `)
      .order('sent_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    res.json({
      logs: logs || [],
      count: logs?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// ============================================================================
// AGENT EXECUTION
// ============================================================================

async function runAgentAsync(agentId, jobId) {
  const job = runningJobs.get(agentId);
  
  try {
    console.log(`[${jobId}] Starting agent: ${agentId}`);

    // Run the agent script
    // Adjust path to your agents file
    const command = `cd /Users/marcusgray/artlogix-ai && npm run agents`;
    
    const { stdout, stderr } = await execAsync(command, {
      timeout: 3600000 // 1 hour timeout
    });

    console.log(`[${jobId}] Agent completed:`, stdout);

    if (job) {
      job.status = 'completed';
      job.endTime = new Date();
      job.output = stdout;
      
      // Clean up after 5 minutes
      setTimeout(() => {
        runningJobs.delete(agentId);
      }, 300000);
    }

  } catch (error) {
    console.error(`[${jobId}] Agent failed:`, error);
    
    if (job) {
      job.status = 'failed';
      job.endTime = new Date();
      job.error = error.message;
      
      // Clean up after 5 minutes
      setTimeout(() => {
        runningJobs.delete(agentId);
      }, 300000);
    }
  }
}

async function runAllAgentsAsync(jobId) {
  try {
    console.log(`[${jobId}] Starting all agents`);

    const command = `cd /Users/marcusgray/artlogix-ai && npm run agents`;
    
    const { stdout, stderr } = await execAsync(command, {
      timeout: 7200000 // 2 hour timeout for all agents
    });

    console.log(`[${jobId}] All agents completed:`, stdout);

  } catch (error) {
    console.error(`[${jobId}] All agents failed:`, error);
  }
}

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║          ARTLOGIX AI - DASHBOARD API                       ║
║                                                            ║
║  API Server: http://localhost:${PORT}                      ║
║  Dashboard: http://localhost:${PORT}/                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
  console.log('🚀 Server ready for agent control');
  console.log('📊 Dashboard available at http://localhost:' + PORT);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  app.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});