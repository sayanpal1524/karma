# Architectural Solution Specification: Resolving Cloudflare Deployment & Crawler Sandbox Sim Issue

**Author:** Senior Solution Architect  
**Status:** Under Review  
**Target Platform:** Cloudflare Pages / Cloudflare Workers  
**Project:** Karma — West Bengal Government Jobs Tracker

---

## 1. Executive Summary & Root Cause Analysis (RCA)

When you host your static files (HTML, CSS, JavaScript) on **Cloudflare Pages**, the frontend code compiles and runs entirely **inside the visitor's web browser** (client-side execution). 

Currently, the crawler engine operates under a **hybrid fallback model** defined in [index.js](file:///d:/Projects/karma/index.js):
1. Upon loading, the browser executes `probeBackendServer()` which sends a network request to `http://localhost:3000/api/jobs`.
2. When running locally (via `npm run dev`), the local Node.js Express server is active on `localhost:3000` and responds with the current database records stored in [scrapedJobs.json](file:///d:/Projects/karma/scrapedJobs.json).
3. Once deployed to Cloudflare Pages:
   - **Endpoint Inreachability:** The deployed browser code attempts to fetch `http://localhost:3000/api/jobs`. This resolves to the *visitor's* local computer, where no backend server is running.
   - **Reversion to Sandbox Sim:** The fetch fails, triggering the catch block in `probeBackendServer()`. The system automatically reverts to **Offline Sandbox Mode**, loading an empty `JOBS_DATA` array and displaying **"SANDBOX SIM"** in the retro-terminal UI.

### Why the Current Express + node-cron Scraper Backend Cannot Run Directly on Cloudflare Pages:
- **No Long-Running Processes:** Cloudflare Pages hosting is designed for static assets. Cloudflare Workers (its serverless function equivalent) are ephemeral (spin up on request, execute, and shutdown). Background schedulers like `node-cron` require a persistent, running CPU loop which does not exist in serverless environments.
- **Read-Only / Ephemeral Filesystem:** The backend writes scraped data to [scrapedJobs.json](file:///d:/Projects/karma/scrapedJobs.json) using standard Node.js `fs` APIs (`fs.writeFileSync`). Serverless environments do not have a persistent local disk; any writes are lost immediately upon function termination.

---

## 2. Recommended Architectural Approaches

To make the crawler functional on the web, you must adapt the storage, execution, and scheduling to fit cloud-native or decoupled patterns. Below are the three best architectural approaches, ordered by implementation simplicity and cost-efficiency.

### Approach A: Static Hosting + GitHub Actions Scraper Schedule (Recommended)
*Zero-Cost, Zero-Infrastructure Overhead, Extremely Portable*

Instead of a live, running server, you let **GitHub Actions** (which is free for open-source repositories) run the crawler script on a cron schedule (e.g., twice a day).

```
                      +---------------------------------------+
                      |         GitHub Actions Runner         |
                      |   (Triggered by scheduled Cron Job)   |
                      +-------------------+-------------------+
                                          |
                                          v  (Runs scraper.js)
                      +---------------------------------------+
                      |       Merge new notices into          |
                      |          scrapedJobs.json             |
                      +-------------------+-------------------+
                                          |
                                          v  (Auto git commit & push)
                      +---------------------------------------+
                      |           GitHub Repository           |
                      +-------------------+-------------------+
                                          |
                                          v  (Triggers Auto-Build)
                      +---------------------------------------+
                      |        Cloudflare Pages CDN           |
                      |   (Serves index.html + scrapedJobs)   |
                      +-------------------+-------------------+
                                          |
                                          v  (HTTP fetch relative path)
                      +---------------------------------------+
                      |           Visitor's Browser           |
                      +---------------------------------------+
```

#### Detailed Workflow
1. **GitHub Action Cron:** A configuration file (`.github/workflows/scrape.yml`) runs on a schedule matching your current cron expression (`30 10,17 * * 1-6`).
2. **Scrape Execution:** The runner checkouts the code, runs `npm install`, and executes a lightweight script that runs `scraper.js` directly, fetching the government websites.
3. **Database Write:** The results are merged, and the updated `scrapedJobs.json` file is written back to the repository.
4. **Git Commit:** The Action commits the updated `scrapedJobs.json` file back to the repository branch.
5. **Autodeploy:** Cloudflare Pages detects the new commit and automatically rebuilds and redeploys the site in less than 30 seconds.
6. **Frontend Simplification:** The frontend in `index.js` is modified to fetch `./scrapedJobs.json` as a relative static asset file instead of hitting `localhost:3000/api/jobs`.

#### Pros & Cons
- **Pros:**
  - **100% Free:** No database, VM, serverless, or bandwidth fees.
  - **No Infrastructure to Maintain:** No running servers, databases, or API keys.
  - **High Performance:** Serving `scrapedJobs.json` as a static file from Cloudflare's CDN edge is blazingly fast.
  - **No CORS Issues:** The browser requests a relative file from the same domain.
- **Cons:**
  - **Manual Scan Limitations:** The "Force Portal Scan" button on the UI cannot perform a real-time crawl instantly. (It can trigger a GitHub Repository Dispatch API event, but it takes 1-2 minutes for the GitHub runner to spin up and compile the code).

---

### Approach B: Cloudflare-Native Serverless Monorepo (Workers + Workers KV)
*100% Cloudflare Stack, Real-Time Manual Crawling Support*

Convert the Node.js backend into a **Cloudflare Worker** paired with **Cloudflare KV** (Key-Value) storage, and set up a **Cloudflare Cron Trigger**.

```
+--------------------------+        HTTP request        +--------------------------+
|  Cloudflare Pages Web    | -------------------------> |  Cloudflare Worker API   |
|  (Frontend static files) |                            |  (Replaces server.js)    |
+--------------------------+                            +------------+-------------+
                                                                     |
                                  +----------------------------------+----------------------------------+
                                  | (Scheduled Cron Trigger)                                            | (REST calls)
                                  v                                                                     v
                    +---------------------------+                                         +---------------------------+
                    |    Cheerio Web Scraper    |                                         |   Read/Write operations   |
                    | (Pulls from WB PSC/PRB/etc) |                                        |    to Cloudflare KV       |
                    +-------------+-------------+                                         +-------------+-------------+
                                  |                                                                     |
                                  +----------------------------------+----------------------------------+
                                                                     |
                                                                     v
                                                       +---------------------------+
                                                       |   Cloudflare KV Store     |
                                                       | (Stores scrapedJobs JSON) |
                                                       +---------------------------+
```

#### Detailed Workflow
1. **Ditch server.js:** Replace `express` and `node-cron` with a Cloudflare Worker file (typically `index.js` inside a serverless project).
2. **KV Database Store:** Instead of `fs.writeFileSync`, you use the Cloudflare Workers runtime global binding for your KV namespace (e.g. `await KARMA_KV.put("scraped_jobs", JSON.stringify(jobs))`).
3. **Workers Cron Trigger:** Set a schedule in `wrangler.toml` that calls the scraper handler function twice daily to scrape, merge, and save data to KV.
4. **API endpoints:** The Worker exposes:
   - `GET /api/jobs` -> Returns KV value for `"scraped_jobs"`.
   - `POST /api/scan` -> Initiates the scraper immediately (supports real-time force crawls).
5. **CORS / Routing Configuration:** Map the Worker to a subroute of your Cloudflare Pages project (e.g., `yourdomain.com/api/*`) using Cloudflare Pages Functions or Workers routing, preventing CORS completely.

#### Pros & Cons
- **Pros:**
  - **Fully Serverless:** Scales automatically with zero server maintenance.
  - **Real-Time Force Scans:** The "Force Portal Scan" button works immediately, executing live crawls on demand.
  - **Generous Free Tier:** Cloudflare Workers allows 100,000 requests/day, and KV allows 1,000 write operations/day.
- **Cons:**
  - **Code Refactoring Required:** Scraper code needs to be customized to run under the Cloudflare Workers V8 isolate environment (e.g. no Node.js filesystem `fs` access, custom fetch handling, handling execution timeouts which are typically 30 seconds for HTTP requests).

---

### Approach C: Decoupled Multi-Service Deployment (Cloudflare Pages + External Backend VM)
*Traditional Monorepo Separation, Least Code Modification*

Keep the frontend on Cloudflare Pages, but host the Express crawler backend `server.js` on a free/cheap cloud container service that supports long-running Node processes (like **Render**, **Railway**, or **Fly.io**).

#### Detailed Workflow
1. **Backend Deployment:** Deploy your existing Express app to Railway or Render. The environment will run `server.js` constantly.
2. **Persistent Storage:** Attach a small persistent volume disk to the container so that `scrapedJobs.json` does not disappear when the container restarts, OR configure a free PostgreSQL/MongoDB database to store findings.
3. **Scheduler:** The existing `node-cron` code continues to run in the background.
4. **Frontend API URL:** In `index.js`, replace `http://localhost:3000` with your deployed backend URL (e.g., `https://karma-backend.onrender.com`).
5. **CORS Configuration:** Configure the CORS headers in `server.js` to allow requests from your Cloudflare Pages domain name.

#### Pros & Cons
- **Pros:**
  - **Almost Zero Code Changes:** The current `server.js`, `scraper.js`, and database structures remain completely unchanged.
  - **Keeps Node-Cron:** Native `node-cron` works out-of-the-box.
- **Cons:**
  - **Cold Starts:** Free tiers on Render/Railway sleep after 15 minutes of inactivity. When a visitor opens your tracker, it could take 30-50 seconds for the backend to wake up, causing the dashboard to appear offline or delay data load.
  - **Infrastructure Cost:** Non-sleeping VMs or DB allocations generally cost $5-$10/month.

---

## 3. Recommended Approach Implementation Blueprints

If you choose the **GitHub Actions Scheduled Scraper (Approach A)**, here is the exact implementation plan to execute it in the repository:

### Step 1: Create GitHub Actions Workflow File
Create a new file `.github/workflows/scrape.yml` in the codebase:
```yaml
name: Scheduled Government Jobs Scraper

on:
  schedule:
    # Run at 10:30 AM and 5:30 PM, Monday to Saturday (UTC values adjusted for Indian Standard Time - IST)
    # IST is UTC+5:30. 
    # 10:30 AM IST -> 05:00 UTC
    # 05:30 PM IST -> 12:00 UTC
    - cron: '0 5,12 * * 1-6'
  workflow_dispatch: # Allows manual trigger from GitHub UI

jobs:
  scrape:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout Repository
        uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-node: '18'
          cache: 'npm'

      - name: Install Dependencies
        run: npm ci

      - name: Execute Scraper Task
        run: node -e "
          const { scrapeWBPSCNotifications, scrapeWBPSCAdvertisements, scrapeWBPRBRecruitments, scrapeWBHEALTHRecruitments, mergeScrapedData } = require('./scraper');
          const fs = require('fs');
          const path = require('path');
          const DB_PATH = path.join(process.cwd(), 'scrapedJobs.json');

          async function run() {
            console.log('Initiating scheduled scrape run...');
            const [notifications, advertisements, wbprbNotices, wbhealthNotices] = await Promise.all([
              scrapeWBPSCNotifications(),
              scrapeWBPSCAdvertisements(),
              scrapeWBPRBRecruitments(),
              scrapeWBHEALTHRecruitments()
            ]);

            let currentJobs = [];
            try {
              currentJobs = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
            } catch (e) {
              console.log('No database found, initializing empty cache');
            }

            const { newEntries } = mergeScrapedData(currentJobs, notifications, advertisements, wbprbNotices, wbhealthNotices);
            if (newEntries.length > 0) {
              const updatedJobs = [...newEntries, ...currentJobs];
              fs.writeFileSync(DB_PATH, JSON.stringify(updatedJobs, null, 2), 'utf8');
              console.log(newEntries.length + ' new jobs found and written to database.');
            } else {
              console.log('No new jobs found. Database remains up-to-date.');
            }
          }
          run().catch(err => {
            console.error(err);
            process.exit(1);
          });
        "

      - name: Commit and Push Changes
        run: |
          git config --global user.name "Karma-Scraper-Bot"
          git config --global user.email "bot@karma-tracker.org"
          git add scrapedJobs.json
          git diff --quiet && git diff --staged --quiet || (git commit -m "chore(data): automated jobs database refresh [skip ci]" && git push)
```

### Step 2: Refactor Frontend Probe Logic in [index.js](file:///d:/Projects/karma/index.js)
Modify `probeBackendServer()` inside the frontend codebase to fetch the local `scrapedJobs.json` when the live server isn't found. Currently, it reverts to `JOBS_DATA` which is empty. Instead, it should query the static file directly so that the Cloudflare hosted page remains updated with the last pushed data.

```javascript
  // --- HYBRID FALLBACK CONNECTION PROBE ---
  async function probeBackendServer() {
    writeConsoleLine("[SYSTEM] Booting Karma Core engine v1.5...", "stamp");
    
    const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const backendUrl = isLocalhost ? "http://localhost:3000/api/jobs" : "./scrapedJobs.json";
    
    writeConsoleLine(`[SYSTEM] Probing backend crawler data at ${backendUrl}...`, "info");

    const connectionStatus = document.getElementById("scan-connection-status");
    const indicator = document.querySelector(".scanner-indicator");

    try {
      const response = await fetch(backendUrl);
      if (response.ok) {
        state.jobs = await response.json();
        
        if (isLocalhost) {
          state.mode = "live";
          writeConsoleLine("[SYSTEM] Connected successfully to Live Local Backend!", "success");
          if (connectionStatus) {
            connectionStatus.innerText = "LIVE PORTAL";
            connectionStatus.style.color = "var(--color-open)";
          }
        } else {
          state.mode = "static-cached";
          writeConsoleLine("[SYSTEM] Operating under CDN Serverless Static Mode.", "success");
          writeConsoleLine("[DATABASE] Loaded live parsed government notices ledger.", "success");
          if (connectionStatus) {
            connectionStatus.innerText = "CDN STATIC";
            connectionStatus.style.color = "var(--color-open)";
          }
        }
        
        if (indicator) {
          indicator.style.backgroundColor = "var(--color-open)";
        }
      } else {
        throw new Error("HTTP error status " + response.status);
      }
    } catch (err) {
      // Revert automatically to Sandbox Simulation Mode
      state.jobs = JSON.parse(JSON.stringify(JOBS_DATA)); 
      state.mode = "sandbox";

      writeConsoleLine("[SYSTEM] Remote data source unreachable.", "warning");
      writeConsoleLine("[SYSTEM] Reverting automatically to Offline Sandbox Mode.", "warning");
      
      if (connectionStatus) {
        connectionStatus.innerText = "SANDBOX SIM";
        connectionStatus.style.color = "var(--primary)";
      }
      if (indicator) {
        indicator.style.backgroundColor = "var(--primary)";
      }
    }

    updateStatsAndProgress();
    renderAllJobs();
  }
```

### Step 3: Handle Manual Scan Trigger for "CDN Static" Mode
In [index.js](file:///d:/Projects/karma/index.js), update the force scanner click event so that when the user is in static mode on Cloudflare, clicking **"Force Portal Scan"** gives a helpful system message informing the user how the background crawler schedule operates, rather than just running a local sandbox animation.

---

## 4. Architectural Decision Matrix

| Dimension | Approach A: GitHub Actions | Approach B: Cloudflare Workers + KV | Approach C: Decoupled Backend (Render/Railway) |
| :--- | :--- | :--- | :--- |
| **Operating Cost** | **Free ($0)** | **Free ($0)** (under 100k daily requests) | **Free to Low ($0 - $7/mo)** |
| **Setup Complexity** | **Low** (Write 1 workflow file) | **High** (Refactor file writes to KV binds, migrate wrangler) | **Medium** (Deploy server container) |
| **Real-Time Crawling** | No (scheduled updates only) | Yes (executes on-demand) | Yes (depends on server warm-up) |
| **Database Setup** | None (uses JSON file in git repo) | Workers KV Namespace | Filesystem Persistent Disk or SQL |
| **Cold Starts** | None | None | Yes (Free containers spin down) |

---

### Recommended Selection:
For a project of this nature, **Approach A (GitHub Actions Scheduler)** is highly recommended. It maintains the monorepo architecture, incurs no operational costs, requires very few lines of code to change, and leverages Cloudflare Pages' native deployment mechanism perfectly.
