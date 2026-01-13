# ArtLogix AI Dashboard - Quick Start

## 🚀 5-Minute Setup

### Option 1: View Dashboard Locally (No Server)

```bash
# Just open the HTML file in your browser
open artlogix-dashboard.html
```

**Note:** This is view-only. To run agents, use Option 2.

---

### Option 2: Run with API Server (Recommended)

```bash
# 1. Create project directory
mkdir artlogix-dashboard
cd artlogix-dashboard

# 2. Copy files
cp /path/to/artlogix-dashboard.html public/index.html
cp /path/to/server.js server.js
cp /path/to/package.json package.json

# 3. Install dependencies
npm install

# 4. Create .env file
cat > .env << 'EOF'
PORT=3001
SUPABASE_URL=your-url-here
SUPABASE_SERVICE_KEY=your-key-here
FIRECRAWL_API_KEY=your-key-here
ANTHROPIC_API_KEY=your-key-here
RESEND_API_KEY=your-key-here
FROM_EMAIL=your-email-here
EOF

# 5. Start server
npm start
```

Open: **http://localhost:3001**

---

## 📁 File Structure

```
artlogix-dashboard/
├── public/
│   └── index.html          # Dashboard UI
├── server.js               # API server
├── package.json            # Dependencies
├── .env                    # Configuration (create this)
└── README.md              # This file
```

---

## ✨ Features

### Dashboard Capabilities

- **📊 Real-time Stats**: View prospects, hot leads, qualified leads
- **🎛️ Agent Controls**: Enable/disable individual agents
- **▶️ Run Agents**: Execute all or single agents with one click
- **📝 Activity Log**: Monitor agent execution in real-time
- **⚙️ Configuration**: Set API endpoints and webhooks
- **📱 Responsive**: Works on desktop, tablet, and mobile

### API Endpoints

Once running, your API provides:

```
http://localhost:3001/                    - Dashboard UI
http://localhost:3001/api/health          - Health check
http://localhost:3001/api/stats           - System statistics
http://localhost:3001/api/prospects       - Recent prospects
http://localhost:3001/api/run-agent       - Run specific agent
http://localhost:3001/api/run-all         - Run all agents
```

---

## 🔧 Configuration

### 1. Configure API Endpoint

Open dashboard → Click **⚙️ Configure**

Set API Endpoint:
- Local: `http://localhost:3001/api`
- Production: `https://your-app.railway.app/api`

### 2. Link to Your Agents

The server needs to run your agent code. Update `server.js`:

```javascript
// Find this line (around line 171):
const command = `cd ${process.cwd()} && npm run agents`;

// Change to your agents directory:
const command = `cd /path/to/artlogixai && npm run agents`;
```

### 3. Optional: Add Slack Notifications

In dashboard config, add your Slack webhook URL for real-time alerts.

---

## 🎨 Dashboard Preview

```
╔════════════════════════════════════════════╗
║                                            ║
║   ArtLogix AI - Agent Control Dashboard   ║
║                                            ║
║   Total Prospects: 347    Hot Leads: 58   ║
║   Qualified: 114         Last Run: 12m ago║
║                                            ║
║   ┌─────────────────────────────────┐    ║
║   │ Museum Agent        [ENABLED]   │    ║
║   │ 38 sources | 0 prospects        │    ║
║   │ [▶️ Run]    [📊 Logs]            │    ║
║   └─────────────────────────────────┘    ║
║                                            ║
║   [▶️ Run All Agents]                     ║
║                                            ║
╚════════════════════════════════════════════╝
```

---

## 📊 Using the Dashboard

### Running Agents

**Run All Agents:**
1. Click "▶️ Run All Agents" button
2. Watch activity log for progress
3. Check stats for results

**Run Single Agent:**
1. Find agent card (Museum, Gallery, etc.)
2. Click "▶️ Run" button on that agent
3. Monitor in activity log

**Enable/Disable Agents:**
- Toggle the switch on any agent card
- Disabled agents won't run when "Run All" is clicked

### Monitoring Results

**View Stats:**
- Top cards show: Total prospects, Hot leads, Qualified leads
- Updates automatically after each run

**View Prospects:**
- Stats are pulled from your Supabase database
- Visit Supabase dashboard for detailed prospect lists

**Activity Log:**
- Shows real-time agent execution
- Displays success/failure messages
- Automatically scrolls to show latest

---

## 🌐 Deployment

### GitHub Pages (Frontend Only)

```bash
# Quick deploy to GitHub Pages
git init
git add .
git commit -m "Add dashboard"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/artlogix-dashboard.git
git push -u origin main

# Enable GitHub Pages in repo settings
```

Dashboard will be live at:
`https://YOUR-USERNAME.github.io/artlogix-dashboard/`

### Railway (Full Stack)

```bash
# Deploy to Railway
railway login
railway init
railway variables set SUPABASE_URL="..."
railway variables set SUPABASE_SERVICE_KEY="..."
# ... (set all env variables)
railway up
```

Dashboard will be live at:
`https://your-app.railway.app`

See **DASHBOARD-DEPLOYMENT-GUIDE.md** for complete deployment instructions.

---

## 🐛 Troubleshooting

### "Cannot connect to API"
- Check server is running: `npm start`
- Verify API endpoint in dashboard config
- Test health: `curl http://localhost:3001/api/health`

### "Agents won't run"
- Verify environment variables in `.env`
- Check agent code path in `server.js`
- Look at server console for error messages

### "Stats showing 0"
- Check Supabase connection
- Verify prospects exist in database
- Run `npm run agents` manually first to populate data

### Port already in use
```bash
# Change port in .env
PORT=3002

# Or kill existing process
lsof -ti:3001 | xargs kill
```

---

## 📚 Next Steps

1. ✅ Get dashboard running locally
2. ✅ Run agents via dashboard
3. ✅ Deploy to Railway/Fly.io
4. ✅ Set up daily cron job
5. ✅ Configure Slack notifications
6. ✅ Customize branding

See **DASHBOARD-DEPLOYMENT-GUIDE.md** for detailed guides on each step.

---

## 💡 Pro Tips

- **Mobile Access**: Dashboard is fully responsive - control agents from your phone
- **Bookmarks**: Bookmark your production dashboard URL for quick access
- **Notifications**: Set up Slack webhook to get alerts for hot leads (90+)
- **Monitoring**: Check dashboard daily to see new prospects
- **Optimization**: Disable underperforming agents to save API costs

---

## 📞 Support

**Need Help?**
- Review: DASHBOARD-DEPLOYMENT-GUIDE.md for detailed instructions
- Check: Server console logs for error messages
- Test: Run agents manually with `npm run agents` first

**Working great?**
Time to scale! Deploy to production and let it run daily to generate 350+ leads/month.

---

🎉 **Enjoy your beautiful new dashboard!**