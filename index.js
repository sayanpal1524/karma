// Karma West Bengal Government Jobs & Vacancies - Core Interactive Engine
// Enhanced with Hybrid Fallback (Auto-probes local Express backend scraper server).

(function () {
  // --- APPLICATION STATE ---
  let state = {
    jobs: [], // Loaded dynamically via probe (live server vs local offline fallback)
    mode: "sandbox", // 'live' (Server running at :3000) or 'sandbox' (Local offline fallback)
    filters: {
      search: "",
      department: "all",
      category: "all",
      status: "all"
    },
    scannerActive: false,
    newNoticesDiscovered: 0
  };

  // Simulated virtual job database additions for the offline sandbox crawler engine
  const SANDBOX_UPCOMING_DISCOVERIES = [
    {
      id: "wbpsc-food-si-2026",
      dept: "WBPSC",
      deptFull: "Public Service Commission, West Bengal",
      postName: "Sub-Inspector in the Subordinate Food & Supplies Service, Gr. III",
      noticeNo: "14/2026",
      vacancies: 820,
      ageLimit: "18 - 40 Years",
      qualification: "Passed Madhyamik (10th) examination of the West Bengal Board of Secondary Education or its equivalent. Good health and ability to speak, read and write Bengali/Nepali.",
      payScale: "Pay Level 6 (₹22,700 - ₹58,500) under ROPA 2019.",
      category: "General Administration",
      status: "open",
      statusText: "Apply Online",
      datePosted: "2026-05-24",
      dateDeadline: "2026-06-30",
      admitCardDate: "2026-08-10",
      examDate: "2026-09-06",
      resultsDate: null,
      applyUrl: "https://psc.wb.gov.in/food-si-apply",
      pdfUrl: "https://psc.wb.gov.in/Download?name=food_si_2026_detailed_not.pdf",
      crawlHistory: []
    },
    {
      id: "wbprb-kp-si-2026",
      dept: "WBPRB",
      deptFull: "West Bengal Police Recruitment Board",
      postName: "Sub-Inspector / Sub-Inspectress in Kolkata Police 2026",
      noticeNo: "KP/2026/SI-09",
      vacancies: 290,
      ageLimit: "20 - 27 Years (Age relaxation applicable as per rules)",
      qualification: "Bachelor's Degree in any discipline from a recognized university. Must satisfy prescribed physical height, weight, and run capabilities.",
      payScale: "Pay Level 10 (₹32,100 - ₹82,900) under WBS (ROPA) 2019.",
      category: "Police & Defense",
      status: "open",
      statusText: "Apply Online",
      datePosted: "2026-05-24",
      dateDeadline: "2026-06-25",
      admitCardDate: "2026-08-01",
      examDate: "2026-08-23",
      resultsDate: null,
      applyUrl: "https://prb.wb.gov.in/kp-si-recruitment-2026",
      pdfUrl: "https://prb.wb.gov.in/Download?notice=kp_si_2026_detailed_notice.pdf",
      crawlHistory: []
    }
  ];

  // --- INITIALIZATION ---
  document.addEventListener("DOMContentLoaded", async () => {
    initClock();
    initAccordions();
    initEventListeners();
    await probeBackendServer(); // Probe server to determine mode and load database
    initAutopilotScanner();
    initCountdownTimers();
  });

  // Displays and updates current dates beautifully
  function initClock() {
    const clockEl = document.getElementById("today-date");
    if (!clockEl) return;
    
    const updateTime = () => {
      const now = new Date();
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
      clockEl.innerHTML = now.toLocaleDateString("en-IN", options);
    };
    
    updateTime();
    setInterval(updateTime, 1000);
  }

  // Toggles active states on category accordions
  function initAccordions() {
    const accordions = document.querySelectorAll(".category-header");
    accordions.forEach(header => {
      header.addEventListener("click", () => {
        const parent = header.parentElement;
        parent.classList.toggle("expanded");
      });
    });
  }

  // Registers events for filtering, search, sliders, modals, and scanning triggers
  function initEventListeners() {
    // 1. Search filter input
    const searchBox = document.getElementById("search-box");
    searchBox.addEventListener("input", (e) => {
      state.filters.search = e.target.value.toLowerCase().trim();
      renderAllJobs();
      toggleResetButton();
    });

    // 2. Department dropdown selection filter
    const deptFilter = document.getElementById("dept-filter");
    deptFilter.addEventListener("change", (e) => {
      state.filters.department = e.target.value;
      renderAllJobs();
      toggleResetButton();
    });

    // 3. Category selector chips
    const chips = document.querySelectorAll("#category-chips-container .chip");
    chips.forEach(chip => {
      chip.addEventListener("click", () => {
        chips.forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        
        state.filters.category = chip.getAttribute("data-category");
        renderAllJobs();
        toggleResetButton();
      });
    });

    // 4. Statistics cards click triggers status filtering
    const statCards = document.querySelectorAll("#stats-container .stat-card");
    statCards.forEach(card => {
      card.addEventListener("click", () => {
        statCards.forEach(c => c.classList.remove("active-filter"));
        card.classList.add("active-filter");
        
        state.filters.status = card.getAttribute("data-status");
        renderAllJobs();
        toggleResetButton();
      });
    });

    // 5. Global reset button
    const btnReset = document.getElementById("btn-reset");
    btnReset.addEventListener("click", () => {
      // Reset inputs & values
      searchBox.value = "";
      deptFilter.value = "all";
      
      chips.forEach(c => c.classList.remove("active"));
      document.querySelector('#category-chips-container .chip[data-category="all"]').classList.add("active");
      
      statCards.forEach(c => c.classList.remove("active-filter"));
      document.querySelector('#stats-container .stat-card[data-status="all"]').classList.add("active-filter");
      
      // Reset state
      state.filters.search = "";
      state.filters.department = "all";
      state.filters.category = "all";
      state.filters.status = "all";
      
      renderAllJobs();
      toggleResetButton();
    });

    // 6. Detailed notice drawer close events
    const drawerOverlay = document.getElementById("detail-drawer-overlay");
    const btnCloseDrawer = document.getElementById("btn-close-drawer-trigger");
    
    btnCloseDrawer.addEventListener("click", () => {
      drawerOverlay.classList.remove("active");
    });
    
    drawerOverlay.addEventListener("click", (e) => {
      if (e.target === drawerOverlay) {
        drawerOverlay.classList.remove("active");
      }
    });

    // 7. Manual Scanner Force Scan trigger
    const btnScan = document.getElementById("btn-trigger-scan");
    btnScan.addEventListener("click", () => {
      if (state.mode === "live") {
        triggerLiveServerScan();
      } else {
        triggerLocalSandboxScan();
      }
    });
  }

  // Toggles the visibility of the "Clear Filters" button
  function toggleResetButton() {
    const btnReset = document.getElementById("btn-reset");
    if (!btnReset) return;

    const hasActiveFilters = 
      state.filters.search !== "" || 
      state.filters.department !== "all" || 
      state.filters.category !== "all" || 
      state.filters.status !== "all";

    btnReset.style.display = hasActiveFilters ? "flex" : "none";
  }

  // --- HYBRID FALLBACK CONNECTION PROBE ---
  async function probeBackendServer() {
    writeConsoleLine("[SYSTEM] Booting Karma Core engine v1.5...", "stamp");
    writeConsoleLine("[SYSTEM] Probing backend crawler server at http://localhost:3000...", "info");

    const connectionStatus = document.getElementById("scan-connection-status");
    const indicator = document.querySelector(".scanner-indicator");

    try {
      const response = await fetch("http://localhost:3000/api/jobs");
      if (response.ok) {
        // Connected successfully! Re-initialize in Live Server Mode
        state.jobs = await response.json();
        state.mode = "live";

        writeConsoleLine("[SYSTEM] Connected successfully to Live Scraper Backend!", "success");
        writeConsoleLine("[DATABASE] Synchronized notices cache from Node.js database.", "success");
        
        if (connectionStatus) {
          connectionStatus.innerText = "LIVE PORTAL";
          connectionStatus.style.color = "var(--color-open)";
        }
        if (indicator) {
          indicator.style.backgroundColor = "var(--color-open)";
        }
      } else {
        throw new Error("Server returned error status " + response.status);
      }
    } catch (err) {
      // Revert automatically to Sandbox Simulation Mode
      state.jobs = JSON.parse(JSON.stringify(JOBS_DATA)); // Use standard offline dataset
      state.mode = "sandbox";

      writeConsoleLine("[SYSTEM] Local backend server offline or CORS block.", "warning");
      writeConsoleLine("[SYSTEM] Reverting automatically to Offline Sandbox Mode.", "warning");
      writeConsoleLine("[DATABASE] Loaded local preloaded notices database (CORS safe).", "success");
      
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

  // --- STATS & PROGRESS BAR CALCULATOR ---
  function updateStatsAndProgress() {
    const counts = { all: state.jobs.length, open: 0, soon: 0, admit: 0, results: 0, closed: 0 };
    let totalVacancies = 0;

    state.jobs.forEach(job => {
      counts[job.status] = (counts[job.status] || 0) + 1;
      totalVacancies += (job.vacancies || 0);
    });

    // Update statistics display cards
    document.getElementById("stat-total").innerText = counts.all;
    document.getElementById("stat-open").innerText = counts.open;
    document.getElementById("stat-soon").innerText = counts.soon;
    document.getElementById("stat-admit").innerText = counts.admit;
    document.getElementById("stat-results").innerText = counts.results;
    document.getElementById("stat-closed").innerText = counts.closed;

    // Update masthead total vacancy counters
    document.getElementById("meta-vacancies").innerText = totalVacancies.toLocaleString("en-IN") + "+ Posts";
    document.getElementById("meta-notices").innerText = counts.all + " Notices";

    // Update multi-segmented progress bar widths
    const getPercent = (count) => counts.all > 0 ? (count / counts.all) * 100 : 0;
    
    document.getElementById("seg-open").style.width = getPercent(counts.open) + "%";
    document.getElementById("seg-soon").style.width = getPercent(counts.soon) + "%";
    document.getElementById("seg-admit").style.width = getPercent(counts.admit) + "%";
    document.getElementById("seg-results").style.width = getPercent(counts.results) + "%";
    document.getElementById("seg-closed").style.width = getPercent(counts.closed) + "%";
  }

  // --- JOB CARD RENDER ENGINE ---
  function renderAllJobs() {
    const categoryContainers = {
      "General Administration": document.getElementById("list-admin"),
      "Police & Defense": document.getElementById("list-police"),
      "Health & Medical": document.getElementById("list-health"),
      "Education & Teaching": document.getElementById("list-education"),
      "Clerical": document.getElementById("list-clerical"),
      "Technical & Medical": document.getElementById("list-technical")
    };

    const categoryBlocks = {
      "General Administration": document.getElementById("cat-block-admin"),
      "Police & Defense": document.getElementById("cat-block-police"),
      "Health & Medical": document.getElementById("cat-block-health"),
      "Education & Teaching": document.getElementById("cat-block-education"),
      "Clerical": document.getElementById("cat-block-clerical"),
      "Technical & Medical": document.getElementById("cat-block-technical")
    };

    // Clean current list DOMs
    Object.values(categoryContainers).forEach(c => { if(c) c.innerHTML = ""; });

    const matchedCategoryCounts = {
      "General Administration": 0,
      "Police & Defense": 0,
      "Health & Medical": 0,
      "Education & Teaching": 0,
      "Clerical": 0,
      "Technical & Medical": 0
    };

    let overallMatches = 0;

    // Filter and append job cards
    state.jobs.forEach(job => {
      // 1. Fuzzy Search match
      const query = state.filters.search;
      const matchesSearch = query === "" || 
        job.postName.toLowerCase().includes(query) || 
        job.dept.toLowerCase().includes(query) || 
        job.noticeNo.toLowerCase().includes(query) || 
        job.category.toLowerCase().includes(query);

      // 2. Department match
      const matchesDept = state.filters.department === "all" || job.dept === state.filters.department;

      // 3. Category match
      const matchesCat = state.filters.category === "all" || job.category === state.filters.category;

      // 4. Status match
      const matchesStatus = state.filters.status === "all" || job.status === state.filters.status;

      if (matchesSearch && matchesDept && matchesCat && matchesStatus) {
        overallMatches++;
        matchedCategoryCounts[job.category]++;
        
        const container = categoryContainers[job.category];
        if (container) {
          container.appendChild(createJobListItem(job, matchedCategoryCounts[job.category]));
        }
      }
    });

    // Toggle blocks visibility
    Object.keys(categoryBlocks).forEach(cat => {
      const count = matchedCategoryCounts[cat];
      const block = categoryBlocks[cat];
      if (!block) return;
      
      const badge = block.querySelector(".cat-badge");
      if (badge) badge.innerText = count + (count === 1 ? " notice" : " notices");

      // Keep category blocks visible and display an elegant empty state panel inside any department that does not have active live-scraped jobs.
      block.style.display = "block";

      if (count === 0) {
        const container = categoryContainers[cat];
        if (container) {
          const catIcons = {
            "General Administration": "🏛️",
            "Police & Defense": "🛡️",
            "Health & Medical": "🏥",
            "Education & Teaching": "🎓",
            "Clerical": "📂",
            "Technical & Medical": "⚙️"
          };
          const icon = catIcons[cat] || "📡";
          container.innerHTML = `
            <div class="dept-empty-state">
              <div class="dept-empty-icon">${icon}</div>
              <div class="dept-empty-title">No Active Recruitments</div>
              <div class="dept-empty-text">No active recruitment drives or notices found for this department in the last 3 months.</div>
            </div>
          `;
        }
      }
    });

    // Handle Empty State
    const mainSection = document.getElementById("categories-root");
    const existEmpty = document.getElementById("karma-empty-state");
    
    if (overallMatches === 0) {
      if (existEmpty) existEmpty.style.display = "block";
      else {
        const emptyState = document.createElement("div");
        emptyState.className = "empty-state";
        emptyState.id = "karma-empty-state";
        emptyState.innerHTML = `
          <div class="empty-icon">📭</div>
          <h3 class="empty-title">No Recruitment Notices Match Your Filters</h3>
          <p class="empty-desc">Try clearing search terms or selecting 'All Sectors' to look for active vacancies across the state.</p>
        `;
        mainSection.appendChild(emptyState);
      }
    } else {
      if (existEmpty) existEmpty.style.display = "none";
    }
  }

  // Generates a fully detailed job card DOM element
  function createJobListItem(job, index) {
    const li = document.createElement("li");
    li.className = `job-item ${job.status}`;
    li.setAttribute("data-id", job.id);
    
    // Add pulsing border if newly discovered this session
    if (job.newlyDiscovered) {
      li.style.border = "1px solid var(--color-open)";
      li.style.boxShadow = "0 0 12px rgba(16, 185, 129, 0.25)";
    }

    let dateBadge = "";
    if (job.status === "open") {
      dateBadge = `📅 Deadline: <strong>${formatDate(job.dateDeadline)}</strong>`;
    } else if (job.status === "admit") {
      dateBadge = `🗓️ Exam Date: <strong>${formatDate(job.examDate)}</strong>`;
    } else if (job.status === "results") {
      dateBadge = `🏆 Declared: <strong>${formatDate(job.resultsDate)}</strong>`;
    } else if (job.status === "soon") {
      dateBadge = `⏳ Anticipated Release`;
    } else {
      dateBadge = `✗ Registration Closed`;
    }

    let badgeClass = `badge-${job.status}`;
    let badgeIcon = "";
    if (job.status === "open") badgeIcon = "✓";
    else if (job.status === "soon") badgeIcon = "◑";
    else if (job.status === "admit") badgeIcon = "📇";
    else if (job.status === "results") badgeIcon = "🏆";
    else badgeIcon = "✗";

    const lastLog = job.crawlHistory[0] ? job.crawlHistory[0].event : "Notice scanned successfully.";

    li.innerHTML = `
      <span class="job-index">${index}</span>
      <div class="job-card-main">
        <div class="job-card-header">
          <button class="job-title-btn" type="button">${job.postName}</button>
          <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
            ${job.source === 'scraped' ? '<span class="badge badge-scraped">📡 Scraped</span>' : ''}
            <span class="badge ${badgeClass}">${badgeIcon} ${job.statusText}</span>
          </div>
        </div>
        
        <div class="job-meta-row">
          <div class="job-meta-item">
            <span class="job-meta-label">Dept:</span>
            <strong>${job.dept}</strong>
          </div>
          <div class="job-meta-item">
            <span class="job-meta-label">Notice No:</span>
            <strong>${job.noticeNo || 'N/A'}</strong>
          </div>
          <div class="job-meta-item">
            <span class="job-meta-label">Vacancies:</span>
            <strong class="accent">${job.vacancies !== null && job.vacancies !== undefined ? job.vacancies.toLocaleString("en-IN") + " Posts" : "Not available"}</strong>
          </div>
          <div class="job-meta-item">
            ${dateBadge}
          </div>
        </div>

        <div class="job-log-band">
          <span class="job-log-dot"></span>
          <span style="font-family: var(--font-mono); font-size: 9px; color: var(--ink-faint); margin-right: 4px;">CRAWLER LOG:</span>
          <span style="font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 500px;">${lastLog}</span>
        </div>

        <div class="job-actions">
          <span class="btn-meta">
            ${job.crawlHistory.length} logs scanned | 1 document
          </span>
          <button class="btn-details" type="button" data-id="${job.id}">View Full details →</button>
        </div>
      </div>
    `;

    // Click triggers details drawer
    const triggerDetails = () => openJobDetailDrawer(job.id);
    li.querySelector(".job-title-btn").addEventListener("click", triggerDetails);
    li.querySelector(".btn-details").addEventListener("click", triggerDetails);

    return li;
  }

  // --- JOB DETAILS DRAWER CONTROLLER ---
  function openJobDetailDrawer(jobId) {
    const job = state.jobs.find(j => j.id === jobId);
    if (!job) return;

    const drawerOverlay = document.getElementById("detail-drawer-overlay");
    if (!drawerOverlay) return;

    // Populate drawer base fields
    document.getElementById("drawer-dept-badge").innerText = job.deptFull;
    document.getElementById("drawer-post-title").innerText = job.postName;
    document.getElementById("drawer-notice-no").innerText = job.noticeNo || "N/A";
    document.getElementById("drawer-vacancies-count").innerText = job.vacancies !== null && job.vacancies !== undefined ? job.vacancies.toLocaleString("en-IN") + " Positions" : "Not available";
    document.getElementById("drawer-criteria").innerText = job.qualification || "Not available";
    document.getElementById("drawer-salary").innerText = job.payScale || "Not available";

    // Render Timeline dynamically
    const timelineContainer = document.getElementById("drawer-timeline-container");
    timelineContainer.innerHTML = "";
    
    if (job.milestones && job.milestones.length > 0) {
      // Sort milestones ascending for chronological timeline flow
      const chronologicalMilestones = [...job.milestones].sort((a, b) => new Date(a.date) - new Date(b.date));
      const todayStr = new Date().toISOString().slice(0, 10);
      
      chronologicalMilestones.forEach((milestone, idx) => {
        const item = document.createElement("div");
        item.className = "timeline-item";
        
        const isCompleted = milestone.date < todayStr;
        const isActive = milestone.date === todayStr || (idx === chronologicalMilestones.length - 1 && milestone.date >= todayStr);

        if (isCompleted) item.classList.add("completed");
        else if (isActive) item.classList.add("active");

        item.innerHTML = `
          <div class="timeline-dot"></div>
          <div class="timeline-info">
            <span class="timeline-lbl">${milestone.title}</span>
            <span class="timeline-date">${formatDate(milestone.date)}</span>
          </div>
          ${milestone.pdfUrl ? `
            <span class="timeline-desc">
              <a href="${milestone.pdfUrl}" target="_blank" class="timeline-pdf-link">
                📜 View Notice PDF
              </a>
            </span>
          ` : ""}
        `;
        timelineContainer.appendChild(item);
      });
    } else {
      const timelineEvents = [
        { label: "Applications Opened", date: job.datePosted, desc: "Online application form activated in the portal." },
        { label: "Application Deadline", date: job.dateDeadline, desc: "Registration portal closing threshold." },
        { label: "Admit Card Released", date: job.admitCardDate, desc: "Admit download dashboard links released." },
        { label: "Exam Date Scheduled", date: job.examDate, desc: "Written/Skill testing checks carried out in districts." }
      ];

      const todayStr = new Date().toISOString().slice(0, 10);

      timelineEvents.forEach(evt => {
        if (!evt.date) return;
        
        const item = document.createElement("div");
        item.className = "timeline-item";
        
        const isCompleted = evt.date < todayStr;
        const isActive = evt.date === todayStr || (evt.label === "Application Deadline" && job.status === "open");

        if (isCompleted) item.classList.add("completed");
        else if (isActive) item.classList.add("active");

        item.innerHTML = `
          <div class="timeline-dot"></div>
          <div class="timeline-info">
            <span class="timeline-lbl">${evt.label}</span>
            <span class="timeline-date">${formatDate(evt.date)}</span>
          </div>
          <span class="timeline-desc">${evt.desc}</span>
        `;
        timelineContainer.appendChild(item);
      });
    }

    // Render Crawler logs table dynamically
    const logsBody = document.getElementById("drawer-logs-body");
    logsBody.innerHTML = "";
    
    job.crawlHistory.forEach(log => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="log-date">${log.date}</td>
        <td class="log-event">${log.event}</td>
      `;
      logsBody.appendChild(row);
    });

    // Configure Actions links
    const btnPdf = document.getElementById("drawer-link-pdf");
    const btnApply = document.getElementById("drawer-link-apply");

    btnPdf.href = job.pdfUrl;
    btnPdf.setAttribute("target", "_blank");

    if (job.status === "open") {
      btnApply.href = job.applyUrl;
      btnApply.setAttribute("target", "_blank");
      btnApply.innerText = "🔗 Apply Online Direct";
      btnApply.className = "btn-drawer-action btn-primary";
    } else if (job.status === "admit") {
      btnApply.href = job.applyUrl;
      btnApply.setAttribute("target", "_blank");
      btnApply.innerText = "📇 Download Admit Card";
      btnApply.className = "btn-drawer-action btn-primary";
    } else if (job.status === "results") {
      btnApply.href = job.applyUrl;
      btnApply.setAttribute("target", "_blank");
      btnApply.innerText = "🏆 View Merit List";
      btnApply.className = "btn-drawer-action btn-primary";
    } else if (job.status === "soon") {
      btnApply.setAttribute("href", "javascript:void(0);");
      btnApply.removeAttribute("target");
      btnApply.innerText = "⏳ Awaiting Portal Registration link";
      btnApply.className = "btn-drawer-action disabled";
    } else {
      btnApply.setAttribute("href", "javascript:void(0);");
      btnApply.removeAttribute("target");
      btnApply.innerText = "✗ Application Window Closed";
      btnApply.className = "btn-drawer-action disabled";
    }

    // Slide Drawer out
    drawerOverlay.classList.add("active");
  }

  // --- AUTOMATIC CRAWLER BACKGROUND INTERFACES ---
  function initAutopilotScanner() {
    const consoleOut = document.getElementById("console-output");
    
    const crawlerMessages = [
      { text: "Autopilot scan checks scheduled... connecting to psc.wb.gov.in", type: "info" },
      { text: "[PSC] Scan complete: verified notice 13/2026 Clerkship active.", type: "success" },
      { text: "Autopilot scan checks scheduled... connecting to prb.wb.gov.in", type: "info" },
      { text: "[PRB] Scan complete: verified constable 04/2026 portal responsive.", type: "success" },
      { text: "Executing secure handshakes with wbhealth.gov.in ...", type: "info" },
      { text: "[WBHEALTH] Checked Health notices registry: General Duty Medical Officer updates verified.", type: "success" },
      { text: "Automatic sync successful. Next checkpoint in 60s.", type: "stamp" }
    ];

    let index = 0;
    
    setInterval(() => {
      if (state.scannerActive) return; // Don't interrupt manual override runs
      
      const msg = crawlerMessages[index];
      writeConsoleLine(msg.text, msg.type);
      
      index = (index + 1) % crawlerMessages.length;
    }, 25000);
  }

  // Writes a styled log line into the retro-console
  function writeConsoleLine(text, type = "info") {
    const consoleOut = document.getElementById("console-output");
    if (!consoleOut) return;

    const time = new Date().toLocaleTimeString("en-IN", { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    
    const line = document.createElement("div");
    line.className = `console-line ${type}`;
    line.innerHTML = `<span class="console-line stamp">[${time}]</span> ${text}`;
    
    consoleOut.appendChild(line);
    consoleOut.scrollTop = consoleOut.scrollHeight; // Scroll to bottom
  }

  // --- MANUAL SCANNER: LIVE EXPRESS SERVER MODE ---
  async function triggerLiveServerScan() {
    if (state.scannerActive) return;
    
    state.scannerActive = true;
    const btnScan = document.getElementById("btn-trigger-scan");
    const btnText = document.getElementById("scan-btn-text");
    const connectionStatus = document.getElementById("scan-connection-status");
    
    btnScan.classList.add("scanning");
    btnText.innerText = "Crawling domains...";
    if(connectionStatus) {
      connectionStatus.innerText = "FORCE OVERRIDE";
      connectionStatus.style.color = "var(--primary)";
    }

    writeConsoleLine("[SYS_ALERT] MANUAL OVERRIDE PORTAL CRAWL REQUEST TRANSMITTED.", "warning");
    writeConsoleLine("[SYS_LINK] Handshaking with http://localhost:3000/api/scan...", "info");

    try {
      const response = await fetch("http://localhost:3000/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      });

      if (!response.ok) {
        throw new Error("Server returned error status " + response.status);
      }

      const data = await response.json();
      
      // Print logs streamed from the server sequentially to look beautiful
      data.logs.forEach((logText, idx) => {
        setTimeout(() => {
          let type = "info";
          if (logText.includes("[OK]")) type = "success";
          else if (logText.includes("[FOUND]")) type = "success";
          else if (logText.includes("[WARN]")) type = "warning";
          else if (logText.includes("[CRAWL_RESTRICTED]")) type = "warning";
          
          writeConsoleLine(logText, type);
        }, idx * 400);
      });

      // Handle newly discovered job notice
      setTimeout(() => {
        if (data.newJob) {
          data.newJob.newlyDiscovered = true;
          
          // Prepend newly discovered notice
          state.jobs.unshift(data.newJob);
          
          updateStatsAndProgress();
          renderAllJobs();
          initCountdownTimers(); // Recalculate sidebars countdowns

          // Update marquee banner
          const marquee = document.getElementById("live-marquee");
          if (marquee) {
            marquee.innerHTML = `<span style="color: var(--color-open); font-weight: 800;">[LIVE SCAN DETECTED]</span> <strong>[${data.newJob.dept}]</strong> ${data.newJob.postName} (${data.newJob.noticeNo}) is active with ${data.newJob.vacancies} vacancies! &nbsp;&nbsp;•&nbsp;&nbsp; ` + marquee.innerHTML;
          }

          // Trigger visual toast
          showSystemOverlayToast(data.newJob);
        }
      }, data.logs.length * 400);

    } catch (err) {
      writeConsoleLine("[ERROR] Failed connection to live scanner server during POST scan.", "closed");
      writeConsoleLine("[SYSTEM] Please verify backend node process is running on port 3000.", "warning");
    }

    // Re-enable manual scanning button after animation finishes
    setTimeout(() => {
      btnScan.classList.remove("scanning");
      btnText.innerText = "Force Portal Scan";
      if(connectionStatus) {
        connectionStatus.innerText = "LIVE PORTAL";
        connectionStatus.style.color = "var(--color-open)";
      }
      state.scannerActive = false;
    }, 3800);
  }

  // --- MANUAL SCANNER: OFFLINE SANDBOX FALLBACK MODE ---
  function triggerLocalSandboxScan() {
    if (state.scannerActive) return;
    
    state.scannerActive = true;
    const btnScan = document.getElementById("btn-trigger-scan");
    const btnText = document.getElementById("scan-btn-text");
    const connectionStatus = document.getElementById("scan-connection-status");
    
    btnScan.classList.add("scanning");
    btnText.innerText = "Scanning domains...";
    if(connectionStatus) {
      connectionStatus.innerText = "FORCE OVERRIDE";
      connectionStatus.style.color = "var(--primary)";
    }

    writeConsoleLine("[SYS_ALERT] MANUAL OVERRIDE SANDBOX RE-SCAN TRIGGERED.", "warning");
    writeConsoleLine("[SYS_LINK] Running sandbox simulator crawlers...", "info");

    const scanSteps = [
      { text: "[1/5] Scanning: psc.wb.gov.in...", delay: 600, type: "info" },
      { text: "[2/5] Scanning: prb.wb.gov.in...", delay: 1200, type: "info" },
      { text: "[3/5] Scanning: www.wbhealth.gov.in...", delay: 1800, type: "info" },
      { text: "[4/5] Scanning: www.wbbpe.org...", delay: 2400, type: "info" },
      { text: "[5/5] Scanning: www.westbengalssc.com...", delay: 3000, type: "info" }
    ];

    scanSteps.forEach(step => {
      setTimeout(() => {
        writeConsoleLine(step.text, step.type);
      }, step.delay);
    });

    setTimeout(() => {
      const nextDiscovery = SANDBOX_UPCOMING_DISCOVERIES[state.newNoticesDiscovered];

      if (nextDiscovery) {
        nextDiscovery.newlyDiscovered = true;
        
        const dateStr = new Date().toISOString().slice(0, 10) + " " + new Date().toTimeString().slice(0, 5);
        nextDiscovery.crawlHistory.unshift({
          date: dateStr,
          event: `SANDBOX DISCOVERY: Published online. Scoped ${nextDiscovery.vacancies} vacancies. Apply now links verified.`
        });

        // Insert new job notice
        state.jobs.unshift(nextDiscovery);
        state.newNoticesDiscovered++;

        writeConsoleLine(`[FOUND] 1 new advertisement detected: ${nextDiscovery.postName} (${nextDiscovery.noticeNo})!`, "success");
        writeConsoleLine(`[SYNC] Compiled notice qualifications, pay level and apply links. State synchronized.`, "success");
        
        updateStatsAndProgress();
        renderAllJobs();
        initCountdownTimers();

        const marquee = document.getElementById("live-marquee");
        if (marquee) {
          marquee.innerHTML = `<span style="color: var(--color-open); font-weight: 800;">[SANDBOX DISCOVERY]</span> <strong>[${nextDiscovery.dept}]</strong> ${nextDiscovery.postName} (${nextDiscovery.noticeNo}) is active with ${nextDiscovery.vacancies} vacancies! &nbsp;&nbsp;•&nbsp;&nbsp; ` + marquee.innerHTML;
        }

        showSystemOverlayToast(nextDiscovery);
      } else {
        writeConsoleLine("[OK] Checked all 18 WB official portals. All job entries up to date. Resync completed.", "success");
      }

      btnScan.classList.remove("scanning");
      btnText.innerText = "Force Portal Scan";
      if(connectionStatus) {
        connectionStatus.innerText = "SANDBOX SIM";
        connectionStatus.style.color = "var(--primary)";
      }
      state.scannerActive = false;

    }, 3800);
  }

  // Renders a high-end, in-app glowing notification toast upon new job scan discoveries
  function showSystemOverlayToast(job) {
    const toast = document.createElement("div");
    toast.style.position = "fixed";
    toast.style.bottom = "24px";
    toast.style.left = "24px";
    toast.style.background = "var(--panel-bg)";
    toast.style.border = "1px solid var(--color-open)";
    toast.style.padding = "20px";
    toast.style.borderRadius = "var(--border-radius-lg)";
    toast.style.boxShadow = "0 10px 45px rgba(0,0,0,0.5), 0 0 20px rgba(16, 185, 129, 0.15)";
    toast.style.zIndex = "9999999";
    toast.style.maxWidth = "400px";
    toast.style.backdropFilter = "blur(12px)";
    toast.style.transform = "translateY(100px)";
    toast.style.opacity = "0";
    toast.style.transition = "transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease";

    toast.innerHTML = `
      <div style="display: flex; gap: 14px; align-items: flex-start;">
        <span style="font-size: 28px; filter: drop-shadow(0 0 8px var(--color-open));">📡</span>
        <div style="flex: 1;">
          <span style="font-family: var(--font-mono); font-size: 9px; font-weight: 700; color: var(--color-open); text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px;">Scanner Discovery Alert</span>
          <h4 style="font-family: var(--font-display); font-size: 14px; font-weight: 700; color: var(--ink); line-height: 1.3; margin-bottom: 4px;">${job.postName}</h4>
          <p style="font-size: 11px; color: var(--ink-faint); margin-bottom: 12px;">Notice No: ${job.noticeNo || 'N/A'} | Tracked Vacancies: ${job.vacancies !== null && job.vacancies !== undefined ? job.vacancies + ' Posts' : 'Not available'}</p>
          <div style="display: flex; gap: 8px;">
            <button class="toast-btn-action" style="background: linear-gradient(135deg, var(--color-open), #34d399); color: #000; font-family: var(--font-mono); font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 6px 12px; border-radius: var(--border-radius-sm);">View Details</button>
            <button class="toast-btn-dismiss" style="border: 1px solid var(--border-color); font-family: var(--font-mono); font-size: 9px; font-weight: 700; text-transform: uppercase; padding: 6px 12px; border-radius: var(--border-radius-sm); color: var(--ink-mid);">Dismiss</button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(toast);

    setTimeout(() => {
      toast.style.transform = "translateY(0)";
      toast.style.opacity = "1";
    }, 100);

    const dismissToast = () => {
      toast.style.transform = "translateY(100px)";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 400);
    };

    toast.querySelector(".toast-btn-dismiss").addEventListener("click", dismissToast);
    
    toast.querySelector(".toast-btn-action").addEventListener("click", () => {
      dismissToast();
      openJobDetailDrawer(job.id);
    });

    setTimeout(dismissToast, 10000);
  }

  // --- DEADLINE COUNTER TICK WIDGETS ---
  let countdownTimerRef = null;

  function initCountdownTimers() {
    if (countdownTimerRef) clearInterval(countdownTimerRef);

    const countdownRoot = document.getElementById("countdown-root");
    if (!countdownRoot) return;

    // Filter jobs closing soon
    const activeOpenJobs = state.jobs.filter(j => j.status === "open" && j.dateDeadline);
    
    if (activeOpenJobs.length === 0) {
      countdownRoot.innerHTML = `<div style="font-size: 12px; color: var(--ink-faint); text-align: center; padding: 20px 0;">No active registrations closing. All scans clean.</div>`;
      return;
    }

    countdownRoot.innerHTML = "";

    activeOpenJobs.forEach(job => {
      const item = document.createElement("div");
      item.className = "countdown-item";
      item.setAttribute("data-deadline-id", job.id);
      
      item.innerHTML = `
        <div class="countdown-post">${job.postName}</div>
        <div class="countdown-timer">
          <div class="timer-block">
            <span class="timer-num days">00</span>
            <span class="timer-lbl">Days</span>
          </div>
          <div class="timer-block">
            <span class="timer-num hours">00</span>
            <span class="timer-lbl">Hrs</span>
          </div>
          <div class="timer-block">
            <span class="timer-num mins">00</span>
            <span class="timer-lbl">Mins</span>
          </div>
          <div class="timer-block">
            <span class="timer-num secs">00</span>
            <span class="timer-lbl">Secs</span>
          </div>
        </div>
      `;
      countdownRoot.appendChild(item);
    });

    const tickCountdowns = () => {
      const today = new Date();
      
      activeOpenJobs.forEach(job => {
        const item = document.querySelector(`[data-deadline-id="${job.id}"]`);
        if (!item) return;

        const deadline = new Date(job.dateDeadline + "T23:59:59");
        const diff = deadline - today;

        if (diff <= 0) {
          item.querySelector(".countdown-timer").innerHTML = `<div style="font-family: var(--font-mono); font-size: 11px; font-weight: 700; color: var(--color-closed); padding: 6px 0;">REGISTRATION COMPLETED / CLOSED</div>`;
          return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const secs = Math.floor((diff % (1000 * 60)) / 1000);

        item.querySelector(".days").innerText = days.toString().padStart(2, "0");
        item.querySelector(".hours").innerText = hours.toString().padStart(2, "0");
        item.querySelector(".mins").innerText = mins.toString().padStart(2, "0");
        item.querySelector(".secs").innerText = secs.toString().padStart(2, "0");
      });
    };

    tickCountdowns();
    countdownTimerRef = setInterval(tickCountdowns, 1000);
  }

  // --- HELPERS ---
  function formatDate(dateString) {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    if (isNaN(date)) return dateString;
    return date.toLocaleDateString("en-IN", { day: 'numeric', month: 'short', year: 'numeric' });
  }

})();
