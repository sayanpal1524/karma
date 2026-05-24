# Implementation Plan - Node.js Scraper Server Integration

This plan details the addition of a **Node.js backend scraper server** to the Karma West Bengal Job & Vacancies Tracker. 

To enable authentic, scheduled, and on-demand crawls across the 18 departments of the West Bengal Government, the frontend dashboard will be linked to a local Express server. To ensure the application is highly resilient, the frontend features an **Automatic Hybrid Fallback System**—if the backend server is not running, the frontend gracefully falls back to the fully-featured offline simulation mode so the portal remains entirely functional.

---

## Technical Architecture

We created a robust backend service directly within the workspace at `d:\Projects\karma`. 

### Key Decisions
1. **Zero-CORS Restrictions:** The server utilizes lightweight middleware to permit Cross-Origin requests from the client-side (`file:///` or local servers), allowing direct and safe browser communication.
2. **Resilient HTTP Scraper Strategy:** Since government portals frequently go offline, experience high latency, or employ Cloudflare shields, our parsers set real-world headers (such as custom browser `User-Agent` strings) and gracefully fall back to cached records/simulated updates if a target domain is blocked or unreachable.
3. **Hybrid Frontend Design:** The frontend `index.js` automatically probes `localhost:3000`. If it receives a response, it switches to **Live Server Mode** (making API calls to fetch data and trigger crawls). If the server is offline, it activates **Local Sandbox Mode** (falling back to offline simulation).

---

## File Structure & Changes

### [Karma Backend Services]

We created three new files in the workspace:
* `d:\Projects\karma\package.json` - Backend configurations, dependency lists, and run scripts.
* `d:\Projects\karma\server.js` - Lightweight Express backend. Incorporates routing, JSON database read/write, automated cron scanning scheduler, browser-header mimicking scrapers, and dynamic REST endpoints.
* `d:\Projects\karma\scrapedJobs.json` - Local database cache holding the live records of scraped government notices.

We modified two existing files:
* `d:\Projects\karma\index.js` - Updated to integrate the Hybrid Fallback connection probes, trigger server-side scans via AJAX POST requests, and capture the real-time logging stream from the backend.
* `d:\Projects\karma\index.html` - Minor tweaks to display server connection state indicators in the console header.

---

## Verification Plan

### Automated & Manual Verification
1. **Verification of Server Standup**:
   - Run `npm start` in the workspace directory.
   - Verify the server launches on port 3000 and successfully initializes `scrapedJobs.json`.
2. **Verification of Connection State**:
   - Load `index.html` in the browser.
   - Confirm that the terminal scanner logs display `[SYSTEM] Connected successfully to Live Scraper Backend!` when the server is active.
3. **Verification of Live Scanning**:
   - Click "Force Portal Scan" with the server active.
   - Verify that the terminal logs are streamed directly from the Node.js backend.
   - Check `scrapedJobs.json` to confirm that the new notice is appended.
   - Re-open/refresh the page to verify that the newly scanned notices persist from the database.
