# KARMA — West Bengal Govt Jobs & Vacancy Tracker

**Karma** is a unified public ledger, crawler dashboard, and real-time notification engine tracking government recruitment drives, exam calendars, admit cards, and results across various departments of the West Bengal Government. 

It is designed to be highly portable, zero-cost to run in production, and provides a modern dark-themed interactive dashboard featuring a retro-styled crawl terminal and countdown timers.

---

## 🏛️ Project Architecture

Karma is built using a **hybrid fallback architecture** that supports two distinct operation modes:

```
                  +--------------------------------------------+
                  |            Karma Web App Client            |
                  +---------------------+----------------------+
                                        |
                                        v
                 (Automatic Connection Probe on Startup)
                                        |
                 +----------------------+----------------------+
                 |                                             |
                 v (Localhost active?)                         v (Localhost offline?)
    +------------+------------+                   +------------+------------+
    |   Live Express Backend   |                   |    Static CDN Database   |
    |   (http://localhost:3000)|                   |    (./scrapedJobs.json)  |
    +------------+------------+                   +------------+------------+
                 |                                             |
                 v                                             v
       (Real-Time Scrapes)                           (Pushed by GitHub Cron)
```

1. **Development / Local Live Mode:** 
   - Uses an **Express.js** backend ([server.js](file:///d:/Projects/karma/server.js)) running on port `3000`.
   - The browser makes direct REST API requests to trigger on-demand sweeps (`POST /api/scan`) and retrieve records.
   - Persistence is stored in [scrapedJobs.json](file:///d:/Projects/karma/scrapedJobs.json).
2. **Production / CDN Static Mode (Cloudflare Pages):**
   - The browser cannot call `localhost`. It automatically falls back to fetching `scrapedJobs.json` as a relative static asset file.
   - A **GitHub Actions scheduled workflow** runs the scraping routine twice daily, commits the database updates back to the repository, and triggers an automatic Cloudflare Pages CDN build.
   - Access to manual scans is gracefully restricted with explanatory browser terminal logs to avoid browser CORS/network errors.

---

## 🚀 Key Features

* **Government Portal Crawlers:** Cheerio-powered scrapers parsing live, server-rendered announcements and tables on:
  - **WBPSC** (Public Service Commission, West Bengal)
  - **WBPRB** (West Bengal Police Recruitment Board)
  - **WBHEALTH** (Health & Family Welfare Department)
* **PDF Detail Enrichment:** Dynamically downloads official notification PDFs and parses their text using `pdf-parse` to extract missing metadata (vacancies, qualifications, age limits, pay scale, start/closing dates).
* **Smart Pruning & Filters:** Automatically filters out non-vacancy notices (e.g. general instructions, rejected candidates lists, answer keys) and retains only open registrations, admit cards, and date extensions within a **3-month rolling window**.
* **Modern Retro Dashboard:**
  - Segmented progress bar reflecting status breakdowns.
  - Interactive chip filters for sectors (Admin, Police, Health).
  - Living countdown clocks for registration deadlines.
  - Glowing, animated overlay notifications for new discoveries.

---

## 💻 Local Setup & Development

### Prerequisites
- [Node.js](https://nodejs.org/) v18.0.0 or higher.
- NPM (packaged with Node).

### Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/sayanpal1524/karma.git
cd karma
npm install
```

### Run the Monorepo Development Environment
Spins up both the frontend dev server (`http-server` on port `8000`) and the crawler API backend (`Express` on port `3000`) concurrently in a single shell:
```bash
npm run dev
```
Open your browser and navigate to: 👉 **[http://127.0.0.1:8000/](http://127.0.0.1:8000/)**

### Run Scraper Standalone
To manually trigger the scraping pipeline, run the CLI utility directly:
```bash
node runScraper.js
```
This will scrape the portals, run the 3-month cleanup filter, merge changes, and save the updated output directly to `scrapedJobs.json`.

---

## ☁️ Production Deployment (Cloudflare Pages)

1. **Frontend Hosting:** Connect your repository to **Cloudflare Pages**. Set the build command to empty/blank and output directory to `./` (root).
2. **Scheduled Actions Workflow:** Ensure the scheduled scraper action at `.github/workflows/scrape.yml` is enabled. It runs at **10:30 AM** and **5:30 PM IST** (5:00 AM and 12:00 PM UTC) Monday to Saturday:
   - Scrapes the portals.
   - Merges results into `scrapedJobs.json`.
   - Commits and pushes the file back to git.
   - Cloudflare Pages detects the commit, rebuilds, and updates the public website automatically.

---

## 🔮 Future Plans & Roadmap

- [ ] **WBBPE & WBSSC Integrations:** Expand Cheerio parsers to cover the Primary Education Board and School Service Commission portals.
- [ ] **Telegram / Email Notification Alerts:** Connect a webhook channel so candidates get notified instantly in Telegram when a new recruitment is scraped.
- [ ] **OCR Scanning:** Implement Tesseract/OCR libraries to extract details from scanned government image-only PDFs.
- [ ] **Hiring Trends Analytics:** Add a data visualizer tab showing trends in state job openings, average vacancies, and department hiring speeds.
- [ ] **Mobile App Wrapper:** Create a simple Capacitor/React Native wrapper to offer job tracking as a native Android app.
