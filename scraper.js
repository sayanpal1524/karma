// Karma Scraper Module — Real HTML parsing for West Bengal government portals
// Uses cheerio to parse server-rendered JSP pages from psc.wb.gov.in

// Ignore invalid/self-signed SSL certificates from government websites
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');
const https = require('https');
const crypto = require('crypto');

const WBPSC_BASE_URL = 'https://psc.wb.gov.in';

const SCRAPER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive'
};

const FETCH_TIMEOUT_MS = 10000; // 10-second timeout — be polite to government servers

// Create a custom HTTPS agent that ignores cert errors and allows legacy SSL renegotiation
const secureAgent = new https.Agent({
  rejectUnauthorized: false,
  secureOptions: crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
});

// ---------------------------------------------------------------------------
// Helper: fetch a page with legacy SSL renegotiation support
// ---------------------------------------------------------------------------
function fetchPage(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      method: 'GET',
      headers: SCRAPER_HEADERS,
      agent: secureAgent,
      timeout: timeoutMs
    };

    const req = https.request(url, options, (res) => {
      // Handle redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') ? res.headers.location : `${parsedUrl.origin}${res.headers.location}`;
        return fetchPage(redirectUrl, timeoutMs).then(resolve).catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve(data);
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to fetch ${url}: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Failed to fetch ${url}: Timeout`));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: fetch binary buffer with legacy SSL renegotiation support
// ---------------------------------------------------------------------------
function fetchPageBuffer(url, timeoutMs = FETCH_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      method: 'GET',
      headers: SCRAPER_HEADERS,
      agent: secureAgent,
      timeout: timeoutMs
    };

    const req = https.request(url, options, (res) => {
      // Handle redirect
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = res.headers.location.startsWith('http') ? res.headers.location : `${parsedUrl.origin}${res.headers.location}`;
        return fetchPageBuffer(redirectUrl, timeoutMs).then(resolve).catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }

      const chunks = [];
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve(Buffer.concat(chunks));
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to fetch ${url}: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Failed to fetch ${url}: Timeout`));
    });

    req.end();
  });
}

// ---------------------------------------------------------------------------
// Helper: parse a date string like "25 May 2026" into an ISO date "2026-05-25"
// ---------------------------------------------------------------------------
function parseUploadDate(dateStr) {
  if (!dateStr || !dateStr.trim()) return null;

  const cleaned = dateStr.trim();
  const parsed = new Date(cleaned);

  if (isNaN(parsed.getTime())) return null;

  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, '0');
  const day = String(parsed.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ---------------------------------------------------------------------------
// Helper: check if a notice is a job vacancy, admit card, or date extension
// ---------------------------------------------------------------------------
function isJobVacancyNotice(title) {
  if (!title) return false;
  const titleLower = title.toLowerCase();

  // If it's an admit card or date extension, we want to allow it!
  const isAdmitOrExtension = titleLower.includes('admit card') || titleLower.includes('extension');

  // Negative keywords to filter out results and other non-vacancy/non-admit/non-extension notices
  const negativeKeywords = [
    'result', 'merit list', 'marks', 'score', 'shortlist', 'recommendation', 'selected', 'selection list',
    'cut-off', 'cutoff', 'qualified', 'unsuitable', 'rejected', 'rejection', 'panel', 'screened', 'screening',
    'provisional list', 'provisional merit', 'answer key', 'personality test', 'postponed', 'cancellation', 
    'corrigendum', 'venue', 'verification', 'scrutiny', 'typing test', 'medical test', 'physical test', 
    'syllabus', 'mock test', 're-examination', 'list of candidates', 'answer papers'
  ];

  // If it is NOT an admit card or date extension, we also filter out general announcements, schedules, exam dates, interviews, etc.
  if (!isAdmitOrExtension) {
    negativeKeywords.push('announcement', 'schedule', 'exam date', 'examination date', 'interview', 'written test', 'notice regarding', 'notice for');
  }

  for (const keyword of negativeKeywords) {
    if (titleLower.includes(keyword)) {
      return false;
    }
  }

  // If it is an admit card or date extension, and passed negative checks, it is allowed!
  if (isAdmitOrExtension) {
    return true;
  }

  // Otherwise, it must match our standard positive vacancy keywords
  const positiveKeywords = [
    'recruitment', 'vacancy', 'vacancies', 'advertisement', 'advt', 'appointment',
    'post of', 'posts of', 'engage', 'engagement', 'online application', 'apply online'
  ];

  return positiveKeywords.some(keyword => titleLower.includes(keyword));
}

// ---------------------------------------------------------------------------
// Helper: check if an ISO date string is within the last 3 months
// ---------------------------------------------------------------------------
function isWithinLast3Months(dateStr) {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return false;

  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  return date >= threeMonthsAgo;
}

// ---------------------------------------------------------------------------
// Helper: download and parse a PDF, returning extracted detailed metadata
// ---------------------------------------------------------------------------
async function scrapeDetailsFromPdf(pdfUrl) {
  if (!pdfUrl) return {};

  try {
    const buffer = await fetchPageBuffer(pdfUrl, 8000);
    const pdfData = await pdfParse(buffer);
    
    if (!pdfData || !pdfData.text) {
      throw new Error("No text content returned from PDF");
    }

    console.log(`[PDF_CRAWLER] PDF fetched and parsed successfully (${pdfData.text.length} chars).`);
    return extractDetailsFromPdfText(pdfData.text);
  } catch (err) {
    console.error(`[PDF_CRAWLER] Failed to parse PDF from ${pdfUrl}: ${err.message}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helper: parse dates extracted from PDF text (supporting DD.MM.YYYY formats)
// ---------------------------------------------------------------------------
function parseExtractedDate(dateStr) {
  if (!dateStr) return null;
  let cleaned = dateStr.replace(/\(.*?\)/g, '').replace(/upto.*/i, '').trim();

  // Prioritize Indian DD-MM-YYYY / DD.MM.YYYY formats to prevent native JS Date parsing as MM-DD-YYYY
  const dmyMatch = cleaned.match(/(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
    return `${year}-${month}-${day}`;
  }

  let parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Helper: extract vacancy, age limit, qualifications, pay scale from text
// ---------------------------------------------------------------------------
function extractDetailsFromPdfText(text) {
  if (!text) return {};

  const details = {
    noticeNo: null,
    vacancies: null,
    ageLimit: null,
    qualification: null,
    payScale: null,
    dateStarted: null,
    dateDeadline: null
  };

  // 1. Notice/Advertisement Number
  const noticeNoMatch = text.match(/(?:advt\.?\s*no\.?|advertisement\s*no\.?)\s*[:\-]?\s*(\d+(?:[\[\]\(\)\w]*\/\d+)+)/i);
  if (noticeNoMatch) {
    details.noticeNo = noticeNoMatch[1].trim();
  }
  if (!details.noticeNo) {
    const fallbackNoticeMatch = text.match(/(?:notice\s*no\.?|ref\s*no\.?|advertisement\s*no\.?|advt\s*no\.?)\s*[:\-]?\s*([a-z0-9\-_\/\[\]]+)/i);
    if (fallbackNoticeMatch) {
      details.noticeNo = fallbackNoticeMatch[1].trim();
    }
  }

  // 2. Vacancies
  const vacancyPatterns = [
    /no\.\s*of\s*(?:vacanc(?:y|ies)|posts?)\s*[:\-]?\s*(\d+)/i,
    /total\s*(?:no\.\s*of\s*)?(?:vacanc(?:y|ies)|posts?)\s*[:\-]?\s*(\d+)/i,
    /vacanc(?:y|ies)\s*[:\-]?\s*(\d+)/i,
    /total\s*[:\-]?\s*(\d+)\s*(?:vacanc(?:y|ies)|posts?)/i
  ];
  for (const pattern of vacancyPatterns) {
    const match = text.match(pattern);
    if (match) {
      details.vacancies = parseInt(match[1], 10);
      break;
    }
  }

  // 3. Age Limit
  const agePatterns = [
    /(?:age\s*limit|age)\s*(?:should\s*be)?\s*[:\-]?\s*(\d+\s*(?:to|-)\s*\d+\s*years)/i,
    /age\s*(?:should\s*be)?\s*not\s*(?:more\s*than|exceeding)\s*(\d+\s*years)/i,
    /not\s*(?:more\s*than|exceeding)\s*(\d+\s*years)\s*(?:as\s*on|of)/i,
    /(?:18\s*(?:to|-)\s*40\s*years|21\s*(?:to|-)\s*36\s*years)/i
  ];
  for (const pattern of agePatterns) {
    const match = text.match(pattern);
    if (match) {
      details.ageLimit = match[1] ? match[1].trim() : match[0].trim();
      break;
    }
  }

  // 4. Pay Scale
  const payPatterns = [
    /(?:scale\s*of\s*pay|pay\s*scale|pay\s*level)\s*[:\-]?\s*([^\n\r]{10,80})/i,
    /ropa\s*(?:2019)?\s*level\s*\d+\s*(?:\([^)]+\))?/i,
    /pay\s*:\s*([^\n\r]{10,80})/i
  ];
  for (const pattern of payPatterns) {
    const match = text.match(pattern);
    if (match) {
      details.payScale = match[1] ? match[1].trim() : match[0].trim();
      break;
    }
  }

  // 5. Qualification
  const qualificationPatterns = [
    /essential\s*qualification[s]?\s*[:\-\n]([\s\S]{10,300}?(?=\bdesirable\b|\bage\b|\bpay\b|\bfee\b|\bclosing\b|\bdate\b|\bscheme\b))/i,
    /educational\s*qualification[s]?\s*[:\-\n]([\s\S]{10,300}?(?=\bdesirable\b|\bage\b|\bpay\b|\bfee\b|\bclosing\b|\bdate\b|\bscheme\b))/i,
    /qualification[s]?\s*[:\-\n]([\s\S]{10,250}?(?=\bdesirable\b|\bage\b|\bpay\b|\bfee\b|\bclosing\b|\bdate\b|\bscheme\b))/i
  ];
  for (const pattern of qualificationPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      details.qualification = match[1].replace(/\s+/g, ' ').trim();
      break;
    }
  }

  // 6. Commencement / Start Date
  const startMatch = text.match(/commencement\s*(?:of)?\s*(?:submission\s*of)?\s*(?:online)?\s*application[s]?\s*[:\-]?\s*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s*[a-z]+\s*,?\s*\d{4})/i);
  if (startMatch) {
    details.dateStarted = parseExtractedDate(startMatch[1]);
  }

  // 7. Closing Date / Deadline
  const endMatch = text.match(/closing\s*date\s*(?:for)?\s*(?:submission\s*of)?\s*(?:online)?\s*application[s]?\s*[:\-]?\s*(\d{1,2}[\.\-\/]\d{1,2}[\.\-\/]\d{4}|\d{1,2}(?:st|nd|rd|th)?\s*[a-z]+\s*,?\s*\d{4})/i);
  if (endMatch) {
    details.dateDeadline = parseExtractedDate(endMatch[1]);
  }

  return details;
}


// ---------------------------------------------------------------------------
// Helper: generate a deterministic ID from a string (for dedup)
// ---------------------------------------------------------------------------
function generateId(prefix, str) {
  // Simple hash — take first 8 chars of a basic string hash
  let hash = 0;
  const normalized = str.toLowerCase().replace(/\s+/g, ' ').trim();
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  const hexHash = Math.abs(hash).toString(16).padStart(8, '0').slice(0, 8);
  return `${prefix}-${hexHash}`;
}

// ---------------------------------------------------------------------------
// Scrape WBPSC Notification / Announcement page
// URL: https://psc.wb.gov.in/notification_announcement.jsp
//
// Table structure (3 columns):
//   td[0]: Notification/Announcement Name
//   td[1]: PDF download link (relative href)
//   td[2]: Uploaded On date
// ---------------------------------------------------------------------------
async function scrapeWBPSCNotifications() {
  const url = `${WBPSC_BASE_URL}/notification_announcement.jsp`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const results = [];

  // The main table has id="table"
  $('table#table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 3) return; // Skip malformed rows

    const title = $(cells[0]).text().trim();
    if (!title) return; // Skip empty rows

    // Extract PDF link from the anchor tag in column 2
    const pdfAnchor = $(cells[1]).find('a');
    let pdfUrl = null;
    if (pdfAnchor.length > 0) {
      const href = pdfAnchor.attr('href');
      if (href) {
        // Convert relative URL to absolute
        pdfUrl = href.startsWith('http') ? href : `${WBPSC_BASE_URL}/${href}`;
      }
    }

    const uploadDate = parseUploadDate($(cells[2]).text());

    // Keep only vacancy notices, admit cards, and date extensions from the last 3 months
    if (!isJobVacancyNotice(title) || !isWithinLast3Months(uploadDate)) {
      return;
    }

    results.push({
      title,
      pdfUrl,
      uploadDate,
      source: 'notification',
      id: generateId('wbpsc-notif', title)
    });
  });

  // Concurrently download and scrape PDFs for all matching vacancy notices (admit cards/extensions don't need detailed metadata)
  const scrapePromises = results.map(async (item) => {
    const titleLower = item.title.toLowerCase();
    const isAdmitOrExtension = titleLower.includes('admit card') || titleLower.includes('extension');
    if (!isAdmitOrExtension && item.pdfUrl) {
      console.log(`[PDF_CRAWLER] Missing fields detected. Fetching PDF for vacancy notice: ${item.title.slice(0, 50)}...`);
      const pdfDetails = await scrapeDetailsFromPdf(item.pdfUrl);
      return { ...item, ...pdfDetails };
    }
    return item;
  });

  return Promise.all(scrapePromises);
}

// ---------------------------------------------------------------------------
// Scrape WBPSC Advertisement page
// URL: https://psc.wb.gov.in/advertisement.jsp
//
// Table structure (7 columns):
//   td[0]: Advertisement No.
//   td[1]: Advertisement name
//   td[2]: Application Start Date
//   td[3]: Application End Date
//   td[4]: PDF download link
//   td[5]: Uploaded On date
//   td[6]: Status
// ---------------------------------------------------------------------------
async function scrapeWBPSCAdvertisements() {
  const url = `${WBPSC_BASE_URL}/advertisement.jsp`;
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  const results = [];

  $('table#table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 6) return; // Skip malformed or header rows

    const advtNo = $(cells[0]).text().trim();
    const title = $(cells[1]).text().trim();
    if (!title) return;

    const startDate = parseUploadDate($(cells[2]).text());
    const endDate = parseUploadDate($(cells[3]).text());

    // Extract PDF link
    const pdfAnchor = $(cells[4]).find('a');
    let pdfUrl = null;
    if (pdfAnchor.length > 0) {
      const href = pdfAnchor.attr('href');
      if (href) {
        pdfUrl = href.startsWith('http') ? href : `${WBPSC_BASE_URL}/${href}`;
      }
    }

    const uploadDate = parseUploadDate($(cells[5]).text());

    // Keep only vacancy notices, admit cards, and date extensions from the last 3 months
    const dateToCheck = startDate || uploadDate;
    if (!isJobVacancyNotice(title) || !isWithinLast3Months(dateToCheck)) {
      return;
    }

    // Status column (may be "-" or empty)
    const statusText = cells.length >= 7 ? $(cells[6]).text().trim() : '';

    results.push({
      advtNo,
      title,
      startDate,
      endDate,
      pdfUrl,
      uploadDate,
      statusText,
      source: 'advertisement',
      id: generateId('wbpsc-advt', advtNo || title)
    });
  });

  // Concurrently download and scrape PDFs for advertisements to enrich missing data (vacancies, qualifications, pay scale, age limits)
  const scrapePromises = results.map(async (item) => {
    if (item.pdfUrl) {
      console.log(`[PDF_CRAWLER] Enriched fields requested. Fetching PDF for advertisement: ${item.title.slice(0, 50)}...`);
      const pdfDetails = await scrapeDetailsFromPdf(item.pdfUrl);
      return { ...item, ...pdfDetails };
    }
    return item;
  });

  return Promise.all(scrapePromises);
}

// ---------------------------------------------------------------------------
// Scrape WBPRB Recruitments page
// URL: https://prb.wb.gov.in/recruitments
// ---------------------------------------------------------------------------
async function scrapeWBPRBRecruitments() {
  const rootUrl = 'https://prb.wb.gov.in/recruitments';
  console.log(`[WBPRB_CRAWLER] Fetching root recruitment listing: ${rootUrl}`);
  
  try {
    const html = await fetchPage(rootUrl);
    const $ = cheerio.load(html);

    const drives = [];

    // Each recruitment drive is in a <div class="single-job-post">
    $('div.single-job-post').each((_, element) => {
      const titleText = $(element).find('.job-title h3').text().replace(/\s+/g, ' ').trim();
      if (!titleText) return;

      const detailsAnchor = $(element).find('.apply-btn a');
      if (detailsAnchor.length === 0) return;

      let detailsUrl = detailsAnchor.attr('href');
      if (detailsUrl) {
        detailsUrl = detailsUrl.startsWith('http') ? detailsUrl : `https://prb.wb.gov.in${detailsUrl}`;
        drives.push({
          driveTitle: titleText,
          detailsUrl: detailsUrl
        });
      }
    });

    console.log(`[WBPRB_CRAWLER] Discovered ${drives.length} active recruitment drives.`);

    const results = [];
    const today = new Date().toISOString().slice(0, 10);

    // For each drive, fetch the details page to parse individual sub-notices
    for (const drive of drives) {
      try {
        console.log(`[WBPRB_CRAWLER] Fetching details for drive: "${drive.driveTitle}" (${drive.detailsUrl})`);
        const detailsHtml = await fetchPage(drive.detailsUrl);
        const $details = cheerio.load(detailsHtml);

        // Find the notices table
        const rows = $details('table.table tbody tr, table.table tr');
        if (rows.length === 0) {
          console.log(`[WBPRB_CRAWLER] No notices table found for: ${drive.driveTitle}`);
          continue;
        }

        const milestones = [];
        let driveHasRecentMilestone = false;
        let originalDatePosted = null;

        rows.each((_, row) => {
          const cells = $details(row).find('td');
          if (cells.length < 4) return; // Skip headers or malformed rows

          const dateRaw = $details(cells[1]).text().trim();
          const noticeTitle = $details(cells[2]).text().replace(/\s+/g, ' ').trim();
          const actionAnchor = $details(cells[3]).find('a');
          let actionUrl = actionAnchor.attr('href');

          if (!noticeTitle || !dateRaw) return;

          // Normalise date
          const uploadDate = parseExtractedDate(dateRaw);
          if (!uploadDate) return;

          // Save original date posted as the oldest milestone date or first notice
          if (!originalDatePosted || uploadDate < originalDatePosted) {
            originalDatePosted = uploadDate;
          }

          // Check if this sub-notice milestone is within the 3-month window
          const isRecent = isWithinLast3Months(uploadDate);
          if (isRecent) {
            driveHasRecentMilestone = true;
          }

          if (actionUrl) {
            actionUrl = actionUrl.startsWith('http') ? actionUrl : `https://prb.wb.gov.in${actionUrl}`;
          }

          milestones.push({
            date: uploadDate,
            title: noticeTitle,
            pdfUrl: actionUrl || null
          });
        });

        // Only keep the recruitment drive if it has AT LEAST ONE milestone within the 3-month rolling window!
        if (driveHasRecentMilestone && milestones.length > 0) {
          // Sort milestones descending (latest first)
          milestones.sort((a, b) => new Date(b.date) - new Date(a.date));

          const latestMilestone = milestones[0];

          // Infer status from the latest milestone
          let status = 'open';
          let statusText = 'Apply Online';
          
          const titleLower = latestMilestone.title.toLowerCase();
          const isAdmit = titleLower.includes('admit card') || titleLower.includes('call letter');
          const isExtension = titleLower.includes('extension');
          const isResult = titleLower.includes('result') || titleLower.includes('merit list') || titleLower.includes('shortlist');

          if (isAdmit) {
            status = 'admit';
            statusText = 'Admit Card Out';
          } else if (isExtension) {
            status = 'open';
            statusText = 'Deadline Extended';
          } else if (isResult) {
            status = 'results';
            statusText = 'Results Declared';
          } else {
            status = 'open';
            statusText = 'Active';
          }

          // Generate absolute applyUrl or default to drive details page
          const applyUrl = drive.detailsUrl;

          // We'll also try to parse details from the main/first notice PDF if it exists
          let pdfUrl = null;
          const mainVacancyNotice = milestones.find(m => 
            m.title.toLowerCase().includes('information to applicants') || 
            m.title.toLowerCase().includes('detailed advertisement') || 
            m.title.toLowerCase().includes('notice')
          );
          if (mainVacancyNotice) {
            pdfUrl = mainVacancyNotice.pdfUrl;
          } else {
            pdfUrl = latestMilestone.pdfUrl;
          }

          results.push({
            title: drive.driveTitle,
            postName: drive.driveTitle,
            datePosted: originalDatePosted || today,
            lastActivityDate: latestMilestone.date,
            status: status,
            statusText: statusText,
            applyUrl: applyUrl,
            pdfUrl: pdfUrl,
            milestones: milestones,
            source: 'recruitment',
            id: generateId('wbprb-drive', drive.driveTitle)
          });
        }
      } catch (err) {
        console.error(`[WBPRB_CRAWLER] Failed to scrape drive details page: ${err.message}`);
      }
    }

    // Concurrently enrich recruitment vacancy notices by fetching and parsing the PDF
    const scrapePromises = results.map(async (item) => {
      if (item.pdfUrl && item.pdfUrl.endsWith('.pdf')) {
        console.log(`[WBPRB_CRAWLER] Fetching PDF to enrich details: ${item.title.slice(0, 50)}...`);
        const pdfDetails = await scrapeDetailsFromPdf(item.pdfUrl);
        return { ...item, ...pdfDetails };
      }
      return item;
    });

    return await Promise.all(scrapePromises);
  } catch (err) {
    console.error(`[WBPRB_CRAWLER] Main listing page scrape failed: ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Scrape WBHEALTH Recruitments page
// URL: https://www.wbhealth.gov.in/MainPhaseTwo/NoticeBoard
// ---------------------------------------------------------------------------
async function scrapeWBHEALTHRecruitments() {
  const url = 'https://www.wbhealth.gov.in/MainPhaseTwo/NoticeBoard';
  console.log(`[WBHEALTH_CRAWLER] Fetching NoticeBoard component: ${url}`);
  
  try {
    const html = await fetchPage(url);
    const $ = cheerio.load(html);
    const results = [];

    $('#nav-recruitment-Lists div.single').each((_, row) => {
      const titleAnchor = $(row).find('a.text-dark');
      if (titleAnchor.length === 0) return;

      const title = titleAnchor.text().replace(/\s+/g, ' ').trim();
      if (!title) return;

      let pdfUrl = titleAnchor.attr('href');
      if (pdfUrl) {
        pdfUrl = pdfUrl.startsWith('http') ? pdfUrl : `https://www.wbhealth.gov.in${pdfUrl}`;
      }

      const dateRaw = $(row).find('span.date').text().replace(/\s+/g, ' ').trim();
      if (!dateRaw) return;

      let startDateStr = dateRaw;
      let endDateStr = null;
      if (dateRaw.includes('-')) {
        const parts = dateRaw.split('-');
        startDateStr = parts[0].trim();
        endDateStr = parts[1].trim();
      }

      const startDate = parseExtractedDate(startDateStr);
      const endDate = endDateStr ? parseExtractedDate(endDateStr) : null;
      const dateToCheck = endDate || startDate;

      // Keep only vacancy notices from the last 3 months
      if (!isJobVacancyNotice(title) || !isWithinLast3Months(dateToCheck)) {
        return;
      }

      const today = new Date().toISOString().slice(0, 10);
      let status = 'open';
      let statusText = 'Apply Online';
      if (endDate && endDate < today) {
        status = 'closed';
        statusText = 'Closed';
      }

      const milestones = [
        {
          date: startDate,
          title: title,
          pdfUrl: pdfUrl
        }
      ];

      results.push({
        id: generateId('wbhealth-recruitment', title),
        dept: 'WBHEALTH',
        deptFull: 'Health & Family Welfare Department, West Bengal',
        postName: title,
        noticeNo: 'N/A',
        status: status,
        statusText: statusText,
        datePosted: startDate,
        dateDeadline: endDate,
        lastActivityDate: dateToCheck,
        milestones: milestones,
        applyUrl: 'https://www.wbhealth.gov.in/',
        pdfUrl: pdfUrl,
        source: 'scraped',
        category: 'Health & Medical'
      });
    });

    console.log(`[WBHEALTH_CRAWLER] Discovered ${results.length} active health recruitment notices.`);

    // Concurrently enrich recruitment notices by fetching and parsing the PDF
    const scrapePromises = results.map(async (item) => {
      if (item.pdfUrl) {
        console.log(`[WBHEALTH_CRAWLER] Fetching PDF to enrich details: ${item.postName.slice(0, 50)}...`);
        const pdfDetails = await scrapeDetailsFromPdf(item.pdfUrl);
        return { ...item, ...pdfDetails };
      }
      return item;
    });

    return await Promise.all(scrapePromises);
  } catch (err) {
    console.error(`[WBHEALTH_CRAWLER] Main listing page scrape failed: ${err.message}`);
    return [];
  }
}


// ---------------------------------------------------------------------------
// Merge scraped data into the existing jobs database
//
// Strategy:
//   - Hand-seeded entries (no `source` field) are NEVER overwritten
//   - Scraped entries are matched by `id` for dedup
//   - New scraped entries are appended with partial data
//   - Returns { newEntries, updatedCount, unchangedCount }
// ---------------------------------------------------------------------------
function mergeScrapedData(existingJobs, scrapedNotifications, scrapedAdvertisements, scrapedWBPRB = [], scrapedWBHEALTH = []) {
  const existingIds = new Set(existingJobs.map(j => j.id));
  const newEntries = [];
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 16);

  // Determine status based on dates
  function inferStatus(startDate, endDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (endDate && endDate < today) return { status: 'closed', statusText: 'Closed' };
    if (startDate && startDate <= today && (!endDate || endDate >= today)) return { status: 'open', statusText: 'Apply Online' };
    if (startDate && startDate > today) return { status: 'soon', statusText: 'Coming Soon' };
    return { status: 'open', statusText: 'Active' };
  }

  // Process advertisements (richer data - WBPSC)
  scrapedAdvertisements.forEach(advt => {
    if (existingIds.has(advt.id)) return; // Already exists — skip

    const statusInfo = inferStatus(advt.startDate, advt.endDate);

    const milestones = [
      {
        date: advt.startDate || advt.uploadDate,
        title: advt.title,
        pdfUrl: advt.pdfUrl
      }
    ];

    const jobEntry = {
      id: advt.id,
      dept: 'WBPSC',
      deptFull: 'Public Service Commission, West Bengal',
      postName: advt.title,
      noticeNo: advt.advtNo || advt.noticeNo || 'N/A',
      vacancies: advt.vacancies !== undefined ? advt.vacancies : null,
      ageLimit: advt.ageLimit !== undefined ? advt.ageLimit : null,
      qualification: advt.qualification !== undefined ? advt.qualification : null,
      payScale: advt.payScale !== undefined ? advt.payScale : null,
      category: 'General Administration',
      status: statusInfo.status,
      statusText: statusInfo.statusText,
      datePosted: advt.startDate || advt.uploadDate,
      dateDeadline: advt.endDate,
      lastActivityDate: advt.startDate || advt.uploadDate,
      milestones: milestones,
      applyUrl: `${WBPSC_BASE_URL}/advertisement.jsp`,
      pdfUrl: advt.pdfUrl,
      source: 'scraped',
      crawlHistory: [
        {
          date: timestamp,
          event: `[LIVE_CRAWLER] Scraped from psc.wb.gov.in/advertisement.jsp. Advt No: ${advt.advtNo || 'N/A'}.`
        }
      ]
    };

    newEntries.push(jobEntry);
    existingIds.add(advt.id);
  });

  // Process notifications (less structured - WBPSC)
  scrapedNotifications.forEach(notif => {
    if (existingIds.has(notif.id)) return;

    // Only add recruitment/vacancy/admit/extension notifications
    if (!isJobVacancyNotice(notif.title)) return;

    // Infer status for notifications (e.g. if deadline extracted from PDF exists)
    let status = 'open';
    let statusText = 'Notice Published';
    
    const today = new Date().toISOString().slice(0, 10);
    if (notif.dateDeadline) {
      if (notif.dateDeadline < today) {
        status = 'closed';
        statusText = 'Closed';
      } else {
        status = 'open';
        statusText = 'Apply Online';
      }
    }

    const milestones = [
      {
        date: notif.dateStarted || notif.uploadDate,
        title: notif.title,
        pdfUrl: notif.pdfUrl
      }
    ];

    const jobEntry = {
      id: notif.id,
      dept: 'WBPSC',
      deptFull: 'Public Service Commission, West Bengal',
      postName: notif.title,
      noticeNo: notif.noticeNo || 'N/A',
      vacancies: notif.vacancies !== undefined ? notif.vacancies : null,
      ageLimit: notif.ageLimit !== undefined ? notif.ageLimit : null,
      qualification: notif.qualification !== undefined ? notif.qualification : null,
      payScale: notif.payScale !== undefined ? notif.payScale : null,
      category: 'General Administration',
      status: status,
      statusText: statusText,
      datePosted: notif.dateStarted || notif.uploadDate,
      dateDeadline: notif.dateDeadline || null,
      lastActivityDate: notif.dateStarted || notif.uploadDate,
      milestones: milestones,
      applyUrl: `${WBPSC_BASE_URL}/notification_announcement.jsp`,
      pdfUrl: notif.pdfUrl,
      source: 'scraped',
      crawlHistory: [
        {
          date: timestamp,
          event: `[LIVE_CRAWLER] Scraped from psc.wb.gov.in/notification_announcement.jsp.`
        }
      ]
    };

    newEntries.push(jobEntry);
    existingIds.add(notif.id);
  });

  // Process WBPRB drives (Stateful Parent-Child)
  scrapedWBPRB.forEach(drive => {
    if (existingIds.has(drive.id)) return;

    const jobEntry = {
      id: drive.id,
      dept: 'WBPRB',
      deptFull: 'West Bengal Police Recruitment Board',
      postName: drive.postName,
      noticeNo: drive.noticeNo || 'N/A',
      vacancies: drive.vacancies !== undefined ? drive.vacancies : null,
      ageLimit: drive.ageLimit !== undefined ? drive.ageLimit : null,
      qualification: drive.qualification !== undefined ? drive.qualification : null,
      payScale: drive.payScale !== undefined ? drive.payScale : null,
      category: 'Police & Defense',
      status: drive.status,
      statusText: drive.statusText,
      datePosted: drive.datePosted,
      dateDeadline: drive.dateDeadline || null,
      lastActivityDate: drive.lastActivityDate,
      milestones: drive.milestones,
      applyUrl: drive.applyUrl,
      pdfUrl: drive.pdfUrl,
      source: 'scraped',
      crawlHistory: [
        {
          date: timestamp,
          event: `[LIVE_CRAWLER] Scraped from prb.wb.gov.in/recruitments.`
        }
      ]
    };

    newEntries.push(jobEntry);
    existingIds.add(drive.id);
  });

  // Process WBHEALTH recruitments
  scrapedWBHEALTH.forEach(job => {
    if (existingIds.has(job.id)) return;

    const jobEntry = {
      id: job.id,
      dept: 'WBHEALTH',
      deptFull: job.deptFull,
      postName: job.postName,
      noticeNo: job.noticeNo || 'N/A',
      vacancies: job.vacancies !== undefined ? job.vacancies : null,
      ageLimit: job.ageLimit !== undefined ? job.ageLimit : null,
      qualification: job.qualification !== undefined ? job.qualification : null,
      payScale: job.payScale !== undefined ? job.payScale : null,
      category: 'Health & Medical',
      status: job.status,
      statusText: job.statusText,
      datePosted: job.datePosted,
      dateDeadline: job.dateDeadline || null,
      lastActivityDate: job.lastActivityDate,
      milestones: job.milestones,
      applyUrl: job.applyUrl,
      pdfUrl: job.pdfUrl,
      source: 'scraped',
      crawlHistory: [
        {
          date: timestamp,
          event: `[LIVE_CRAWLER] Scraped from wbhealth.gov.in/MainPhaseTwo/NoticeBoard.`
        }
      ]
    };

    newEntries.push(jobEntry);
    existingIds.add(job.id);
  });

  return {
    newEntries,
    unchangedCount: existingJobs.length,
    totalScraped: scrapedNotifications.length + scrapedAdvertisements.length + scrapedWBPRB.length + scrapedWBHEALTH.length
  };
}

module.exports = {
  scrapeWBPSCNotifications,
  scrapeWBPSCAdvertisements,
  scrapeWBPRBRecruitments,
  scrapeWBHEALTHRecruitments,
  mergeScrapedData,
  isJobVacancyNotice,
  isWithinLast3Months
};
