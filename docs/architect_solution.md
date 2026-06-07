# Architectural Specification - Karma Monorepo Concurrency & Navigation Fixes

**Author**: Senior Solution Architect  
**Version**: 1.2.0  
**Target Platform**: Karma West Bengal Jobs & Vacancy Portal  
**Deployment Model**: Hybrid Monorepo (Express Backend + Static Frontend Dev-Server)

---

## Executive Summary & System Architecture

As a senior software architect, my primary goal is to deliver developer environments that are **robust**, **self-contained**, **highly portable**, and **single-command executable**. The previous architecture required running the frontend statically (via standard Python `http.server` or manual file execution) while running the Node.js backend standalone in another terminal instance. This split execution is error-prone, hard to coordinate, and creates CORS or port collision friction.

To address this, we have refactored Karma into a unified, lightweight **Monorepo Structure** served and executed concurrently under a single runtime environment.

### Unified Monorepo Blueprint

```
                     +----------------------------------------+
                     |         Karma Developer Workspace      |
                     |             (d:\Projects\karma)        |
                     +-------------------+--------------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
              [Dev Dependencies]                    [REST Core Scripts]
                       |                                   |
         +-------------+-------------+             +-------+-------+
         |                           |             |               |
   concurrently                 http-server     server.js      index.js
(Concurrently Execution)      (Dev Web-Server)  (Express Port)  (Frontend)
         |                           |             |               |
         +-------------+-------------+             +-------+-------+
                       |                                   |
                       +-----------------+-----------------+
                                         |
                                         v
                      +------------------+------------------+
                      |         Single CLI Startup          |
                      |            "npm run dev"            |
                      +------------------+------------------+
                                         |
                       +-----------------+-----------------+
                       |                                   |
                       v                                   v
             +---------+---------+               +---------+---------+
             |  BACKEND SCAN SERVICE |               | FRONTEND WEB PORTAL |
             |  (http://localhost:3000) |               | (http://127.0.0.1:8000) |
             +-------------------+---------+     +---------+---------+
                                 ^                         |
                                 |        AJAX API Calls   |
                                 +-------------------------+
```

---

## 1. Unified Workspace Run Script Configuration

We have restructured the project [package.json](file:///d:/Projects/karma/package.json) to declare two lightweight devDependencies:
1.  **`http-server`**: A high-performance, command-line static file server running in Node.js. It runs on port `8000` with the cache disabled (`-c-1`), ensuring the browser never serves stale assets during active edits. This replaces the python system dependency.
2.  **`concurrently`**: Spins up both the Node.js Express server and the `http-server` static file dev-server concurrently under a single terminal shell. It isolates, labels, and beautifully color-codes output logs from both threads.

### Modified package.json Scripts Block
```json
  "scripts": {
    "server": "node server.js",
    "frontend": "http-server -p 8000 -c-1",
    "dev": "concurrently -n \"BACKEND,FRONTEND\" -c \"cyan,magenta\" \"npm run server\" \"npm run frontend\""
  }
```

---

## 2. Navigations & Button Tab Fixes (The Blank Page Issue)

### Root Cause Diagnosis
When inspecting the detailed job overlay drawer in Chrome or Edge, users reported that clicking the **"Apply Online"** action button opened an empty/blank page. 
Our architectural investigation pinpointed a subtle markup discrepancy:
1.  In [index.html](file:///d:/Projects/karma/index.html), the anchor link was defined with `target="_blank"` to ensure active links open in a new tab:
    ```html
    <a href="#" target="_blank" id="drawer-link-apply" class="...">...</a>
    ```
2.  In the original JavaScript, when a notice was in a **"Coming Soon"** (`soon`) or **"Closed"** (`closed`) state, the engine correctly removed the `href` attribute to prevent redirection (`btnApply.removeAttribute("href");`).
3.  However, because the `target="_blank"` attribute **remained attached to the markup anchor**, modern browsers interpreted the user's click on the disabled button as a request to open a new tab on the current null location, resulting in a **blank browser tab (`about:blank`)**.

### Implemented Architectural Fix
We refactored [index.js](file:///d:/Projects/karma/index.js) inside the `openJobDetailDrawer(jobId)` panel binder:
*   For **Active States** (`open`, `admit`, `results`):
    *   Set the `href` to the official department apply URL.
    *   Explicitly append `.setAttribute("target", "_blank")` to guarantee correct redirections.
*   For **Deactivated States** (`soon`, `closed`):
    *   Explicitly set the `href` to `javascript:void(0);` (the standard JavaScript void protocol).
    *   Explicitly strip out target redirection via `.removeAttribute("target")`.
This prevents disabled buttons from opening empty browser windows and ensures active apply links redirect correctly.

---

## 3. Developer Commands & Operational Guide

Follow these steps to run both frontend and backend together in a unified terminal shell:

### Installation
Open your terminal in the workspace directory `d:\Projects\karma` and run:
```bash
npm install
```
This installs Express, node-cron, http-server, and concurrently.

### Dev Portal Startup
Execute the single dev command:
```bash
npm run dev
```

### Server Logs Output
The console will display color-coded concurrently logs:
```
[BACKEND]   KARMA BACKEND CRAWLER SERVER STARTED
[BACKEND]   Live port: http://localhost:3000
[FRONTEND]  Starting up http-server, serving ./
[FRONTEND]  Available on:
[FRONTEND]    http://127.0.0.1:8000
[FRONTEND]  Hit CTRL-C to stop the servers
```

### Accessing the Tracker
Open your web browser and navigate to:
👉 **[http://127.0.0.1:8000/](http://127.0.0.1:8000/)**

Clicking any active job link (like WBPSC Clerkship or TET Primary) will redirect you to the official West Bengal portal in a new tab, and clicking a coming-soon or closed link will remain completely static and secure without opening blank pages.
