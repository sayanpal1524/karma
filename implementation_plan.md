# Implementation Plan - Karma: West Bengal Job & Vacancy Tracker

Karma is a premium, high-fidelity, and interactive web application that aggregates, tracks, and monitors job and vacancy updates across all official departments of the West Bengal Government. Inspired by the highly premium, detailed, and responsive layout of the reference accountability tracker, Karma features a live portal-scanner simulation, comprehensive metadata cards, statistics dashboards, flexible filter states, and detailed notice timelines.

---

## Technical Architecture

We are creating a high-performance, single-page progressive web application (PWA) using modern standard HTML5, CSS3, and ES6 JavaScript. This maintains the ultra-fast, self-contained portability of the reference tracker (which was saved as a single-page HTML), while delivering exceptional premium aesthetics (glassmorphism, vibrant colors, radar scan animations, and smooth transitions).

### Core Decisions
1. **Data Authenticity:** Pre-populated structured database with genuine West Bengal recruitment notices (WBPSC Clerkship, WBCS, WBPRB Constable/SI, WBHRB Nurse, WBBPE Primary Teacher, etc.) including authentic notice numbers, pay scales, and links.
2. **Live Feed Feature:** Since official WB government portals do not provide unified open APIs, we built a robust **Real-Time Portal Scan Engine Simulator** directly in the client-side. This runs in the browser using advanced async loops, displaying a terminal-style live console (e.g. `[CRAWLING] wbpsc.gov.in...`, `[FOUND] 1 new notice!`). It lets users trigger manual rescans with a gorgeous radar animation, updating the frontend state on the fly.
3. **Fully Responsive:** Responsive design covering mobile drawer navigation and high-density desktop grid layouts.

---

## File Structure & Proposed Changes

### [Karma Web Application Project]

We established a clean, modular structure under the workspace `d:\Projects\karma`:
* `d:\Projects\karma\index.html` - The core application entry point. Holds structure, SVGs, skeleton layouts, modals, and guides.
* `d:\Projects\karma\index.css` - Custom styling sheet. Holds variables, theme definitions, animation keyframes, layout controls, and responsive queries.
* `d:\Projects\karma\index.js` - Application logic. Manages state, the Live Scanner engine, active filtering, modal rendering, countdown timers, and localStorage caching.
* `d:\Projects\karma\jobsData.js` - Structured JSON-like data module containing comprehensive, realistic job postings and notices from major WB departments.

---

### Component Architectures

#### 1. index.html
The structure contains:
1. **Masthead Bar**: Live indicator (blinking status), active tracker message, and current date.
2. **Masthead Header**: High-end branding with an interactive West Bengal map vector illustration, portal title ("KARMA"), and system metadata (total vacancies tracked, active notices, last scan timestamp, and departments covered).
3. **Live Ticker / Scanner Status Band**: A real-time alert bar displaying the latest crawled job notice with a marquee transition.
4. **Stats and Progress Band**: Cards for Active Positions, Open Registrations, Admit Cards Out, Results Declared, and Archived Notices, coupled with a multi-segment horizontal progress bar matching the reference tracker.
5. **Main Layout Split**:
   - **Left / Main Column**: Department/Sector accordion sections listing interactive job notice cards. Each card shows badge statuses (`✓ Open`, `◑ Coming Soon`, `📇 Exam/Admit Card`, `🏆 Results Out`, `✗ Closed`).
   - **Right Column (Sidebar)**: 
     - **Live Portal Scanner Console**: Terminal display showing live crawl logs, scanning indicators, and a manual "Trigger Portal Rescan" button.
     - **Countdown Calendars**: Live countdown timers for important deadlines.
6. **Detailed Notice Drawer/Modal**: Opens when a card is clicked, presenting educational requirements, pay scale details, active application links, official PDFs, and the exact "Crawl Log History" of the notice.

#### 2. index.css
A highly polished design system using CSS custom properties:
* **Color Palette**: Sophisticated Dark Theme (deep indigo `#0a0b10` base, glassmorphic cards with translucent border overlays, gold/amber accents, emerald green for active, and vibrant crimson for closed/expired).
* **Typography**: Outfit and Inter fonts loaded from Google Fonts. Space Mono for the scanner console and code details.
* **Layout**: CSS Flexbox and high-performance CSS Grids with auto-fit items.
* **Animations**:
   - `pulse`: For the live green indicators.
   - `radar-scan`: A rotating gradient sweep animation for the scan trigger.
   - `terminal-blink`: Typing cursor animations.
   - `slide-in`: Smooth sliding expansion for accordion headers and detail drawers.

#### 3. jobsData.js
Contains structured data arrays representing various government departments:
* **Departments Included**:
  - `WBPSC` (Public Service Commission)
  - `WBPRB` (Police Recruitment Board)
  - `WBHRB` (Health Recruitment Board)
  - `WBBPE` / `WBSSC` (Primary & School Service Commissions)
  - `WBMCC` / `WBJEEB` (Technical & Medical Exam Boards)
* **Metadata Fields per Job**: Unique ID, Department, Post Name, Notice Ref Number, Vacancies Count, Age Limit, Qualifications, Salary/Pay Scale details, Registration Dates, Status, Direct PDF URL, and Direct Application Portal URL.

#### 4. index.js
Manages the application lifecycle:
1. **Live Scanner Engine**: An asynchronous simulator that regularly updates the sidebar console log, crawls virtual portals, discovers "new updates", increments vacancy stats, and pushes alert notifications into the live ticker.
2. **Search and Filtering**: Implements search term matchers (matching title, dept, or reference no.) combined with status checkboxes and category chips.
3. **Interactive Drawer Control**: Toggles the active category accordions and slides open job details.
4. **Countdown System**: Tracks time differences between current local time and job application deadlines, rendering ticking counters.

---

## Verification Plan

### Automated & Manual Verification
1. **Browser Performance & UI Integrity**:
   - Open and test the unified website in the browser.
   - Verify responsiveness on mobile, tablet, and ultra-wide screens.
   - Ensure the themes, animations, hover transitions, and glassmorphic overlays scale correctly.
2. **Feature Interactivity**:
   - Test search inputs to confirm instantaneous, smooth fuzzy matching.
   - Toggle status and department filters to ensure correct subsets are displayed.
   - Click accordion headers to verify smooth expanding/collapsing motions.
   - Click "Trigger Portal Rescan" to verify the radar animation, the crawling log outputs in the terminal, and the injection of a newly simulated job notice.
   - Open job details to verify that links (e.g. Official PDF, Direct Apply) open in new tabs.
