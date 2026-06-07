# Step-by-Step Refactoring Guide: HTML & PDF Scraper Engine (WBPSC Blueprint)

This guide documents the stepwise architectural blueprint implemented for the West Bengal Public Service Commission (WBPSC) scraper engine. It acts as a refactoring blueprint to systematically implement or upgrade crawler engines for other government departments (e.g., WB Police Recruitment Board - WBPRB, Health Recruitment Board - WBHRB, School Service Commission - WBSSC, etc.).

---

## 🏛️ Refactoring Blueprint Overview

The refactoring transforms basic HTML listing scrapers into high-fidelity metadata extractors by adding **strict vacancy filtering**, **in-memory PDF text extraction**, **multi-format date parsers**, and **fail-safe database cleaning**.

```
  [Portal HTML Page]
          │
          ▼  (Step 1)
  ┌───────────────────────┐
  │ Cheerio Table Scraper │
  └───────┬───────────────┘
          │
          ▼  (Step 2 & 3)
  ┌───────────────────────┐
  │ Multi-Level Filters   │ ──► [Excluded Results/Notices]
  │ (3M Window + Vacancy) │
  └───────┬───────────────┘
          │
          ▼  (Step 4)
  ┌───────────────────────┐
  │ Dynamic PDF Fetcher   │
  │ (Abortable Timeout)   │
  └───────┬───────────────┘
          │
          ▼  (Step 5)
  ┌───────────────────────┐
  │  pdf-parse Text engine│
  └───────┬───────────────┘
          │
          ▼  (Step 6)
  ┌───────────────────────┐
  │ Regex Date Normalizer │
  │   (Fuzzy Extractors)  │
  └───────┬───────────────┘
          │
          ▼  (Step 7)
  ┌───────────────────────┐
  │ Concurrency & Merger  │
  │   (Graceful Fallback) │
  └───────────────────────┘
```

---

## 🛠️ Step-by-Step Implementation Guide

### Step 1: Robust HTML Parsing & Cheerio Setup
*   **Action**: Locate the target department's announcements or listing page and set up Cheerio selectors mapping the HTML table columns.
*   **Rule**: Convert all relative PDF anchor links (`href`) into absolute URLs using the department base URL.
*   **Implementation Example**:
    ```javascript
    const pdfAnchor = $(cells[1]).find('a');
    let pdfUrl = href.startsWith('http') ? href : `${BASE_URL}/${href}`;
    ```

### Step 2: Strict Notice Type Filtering (Positive & Negative Keywords)
*   **Action**: Create a strict filtering helper `isJobVacancyNotice(title)` that separates results/announcements from actual applications.
*   **Rule**:
    1.  Maintain a list of **strict negative keywords** (e.g., `result`, `merit list`, `marks`, `shortlist`, `answer key`, `venue`, `verification`, `scrutiny`, `qualified`, `rejected`).
    2.  Maintain **explicit bypasses** for notice types to retain (e.g., `admit card`, `extension`). Bypassed notices skip negative announcement blocks.
    3.  Maintain **positive keywords** for standard listings (e.g., `recruitment`, `vacancy`, `advertisement`, `post of`, `apply online`).
*   **Implementation Blueprint**:
    ```javascript
    function isJobVacancyNotice(title) {
      const titleLower = title.toLowerCase();
      const isAdmitOrExtension = titleLower.includes('admit card') || titleLower.includes('extension');
      
      const negativeKeywords = ['result', 'merit list', 'marks', 'score', 'shortlist', 'qualified', 'rejected', 'answer key', 'personality test', 'postponed', 'corrigendum'];
      
      if (!isAdmitOrExtension) {
        negativeKeywords.push('announcement', 'schedule', 'exam date', 'interview', 'notice regarding');
      }
      
      for (const keyword of negativeKeywords) {
        if (titleLower.includes(keyword)) return false;
      }
      
      if (isAdmitOrExtension) return true;
      
      const positiveKeywords = ['recruitment', 'vacancy', 'advertisement', 'appointment', 'post of', 'apply online'];
      return positiveKeywords.some(keyword => titleLower.includes(keyword));
    }
    ```

### Step 3: Dynamic Date Range Restrictions (3 Months Window)
*   **Action**: Implement an `isWithinLast3Months(dateStr)` filter.
*   **Rule**: Prevent database bloating by evaluating notices relative to `new Date()`. Keep only those within a rolling 90-day threshold.
*   **Implementation Blueprint**:
    ```javascript
    function isWithinLast3Months(dateStr) {
      if (!dateStr) return false;
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return false;
      
      const now = new Date();
      now.setHours(0,0,0,0);
      const threeMonthsAgo = new Date(now);
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
      
      return date >= threeMonthsAgo;
    }
    ```

### Step 4: Dynamic In-Memory PDF Download & Text Extraction
*   **Action**: Integrate `"pdf-parse": "^1.1.1"` to parse PDF files.
*   **Rule**: Fetch the binary PDF from `pdfUrl` with a polite connection timeout (e.g., 6 seconds) using an AbortController to avoid blocking the Express main thread during scraping.
*   **Implementation Blueprint**:
    ```javascript
    async function scrapeDetailsFromPdf(pdfUrl) {
      if (!pdfUrl) return {};
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);
      try {
        const response = await fetch(pdfUrl, { headers: HEADERS, signal: controller.signal });
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const pdfData = await pdfParse(buffer);
        return extractDetailsFromPdfText(pdfData.text);
      } catch (err) {
        clearTimeout(timeoutId);
        return {}; // Graceful empty fallback
      }
    }
    ```

### Step 5: Multi-Format Date Normalizer
*   **Action**: Build a robust date string extractor `parseExtractedDate(dateStr)`.
*   **Rule**: Government PDFs frequently write timelines using dots as separators (e.g., `30.04.2026` or `20-05-2026`). Native JS Date parsers evaluate these as `Invalid Date`. Implement regex matchers to convert dot-separated `DD.MM.YYYY` strings into standard ISO `YYYY-MM-DD` strings.
*   **Implementation Blueprint**:
    ```javascript
    function parseExtractedDate(dateStr) {
      if (!dateStr) return null;
      let cleaned = dateStr.replace(/\(.*?\)/g, '').replace(/upto.*/i, '').trim();
      let parsed = new Date(cleaned);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
      }
      const dmyMatch = cleaned.match(/(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{4})/);
      if (dmyMatch) {
        return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
      }
      return null;
    }
    ```

### Step 6: Regex-Based PDF Metadata Extraction
*   **Action**: Write safe, non-greedy regular expressions to extract vacancy parameters from PDF text.
*   **Rule**: Search for key terms (e.g., Pay Scale, Age Limit, Commencement Date, Closing Date, Vacancies) and parse them safely.
*   **Implementation Blueprint**:
    ```javascript
    function extractDetailsFromPdfText(text) {
      const details = { noticeNo: null, vacancies: null, ageLimit: null, payScale: null, dateStarted: null, dateDeadline: null };
      
      // Notice Number
      const noticeNoMatch = text.match(/(?:advt\.?\s*no\.?|advertisement\s*no\.?)\s*[:\-]?\s*(\d+(?:[\w]*\/\d+)+)/i);
      if (noticeNoMatch) details.noticeNo = noticeNoMatch[1].trim();
      
      // Commencement/Start Date
      const startMatch = text.match(/commencement\s*(?:of)?\s*(?:submission\s*of)?\s*(?:online)?\s*application[s]?\s*[:\-]?\s*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4})/i);
      if (startMatch) details.dateStarted = parseExtractedDate(startMatch[1]);
      
      // Closing/Deadline Date
      const endMatch = text.match(/closing\s*date\s*(?:for)?\s*(?:submission\s*of)?\s*(?:online)?\s*application[s]?\s*[:\-]?\s*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4})/i);
      if (endMatch) details.dateDeadline = parseExtractedDate(endMatch[1]);

      // Age Limit
      const ageMatch = text.match(/(?:age\s*limit|age)\s*[:\-]?\s*(\d+\s*(?:to|-)\s*\d+\s*years)/i);
      if (ageMatch) details.ageLimit = ageMatch[1].trim();

      // Pay Scale
      const payMatch = text.match(/(?:pay\s*scale|pay\s*level)\s*[:\-]?\s*([^\n\r]{10,80})/i);
      if (payMatch) details.payScale = payMatch[1].trim();

      return details;
    }
    ```

### Step 7: Asynchronous Crawl Mapping & Database Merging
*   **Action**: Combine HTML row parsers with PDF fetch promises concurrently using `Promise.all()`.
*   **Rule**: 
    1.  Ensure all scraped fields default gracefully to `null` if the PDF parsing fails, preserving the application schema without crashing the system.
    2.  Map extracted dates (`dateStarted` -> `datePosted`, `dateDeadline` -> `dateDeadline`).
    3.  Enforce dynamic status inference (e.g., marking a record status as `closed` if the parsed `dateDeadline` has already passed relative to today).
*   **Implementation Example**:
    ```javascript
    // Merge Logic Blueprint
    const jobEntry = {
      id: notif.id,
      postName: notif.title,
      noticeNo: notif.noticeNo || 'N/A',
      vacancies: notif.vacancies || null,
      ageLimit: notif.ageLimit || null,
      payScale: notif.payScale || null,
      status: notif.dateDeadline && notif.dateDeadline < today ? 'closed' : 'open',
      datePosted: notif.dateStarted || notif.uploadDate,
      dateDeadline: notif.dateDeadline || null,
      pdfUrl: notif.pdfUrl
    };
    ```

### Step 8: Startup Database Cleaning & Cache Compaction
*   **Action**: In `server.js`, declare a startup `cleanupDatabase()` function that reads `scrapedJobs.json`, filters out historical entries violating the new 3-month rolling vacancy filter, and rewrites the compacted database on disk.
*   **Rule**: Protect hand-seeded entries (which do not contain `source: 'scraped'`) and only filter the dynamic crawled cache. This avoids database bloating and accelerates UI loading.
