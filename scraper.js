// Karma Scraper Module — Real HTML parsing for West Bengal government portals
// Uses cheerio to parse server-rendered JSP pages from psc.wb.gov.in

// Ignore invalid/self-signed SSL certificates from government websites
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const cheerio = require('cheerio');
const pdfParse = require('pdf-parse');

const WBPSC_BASE_URL = 'https://psc.wb.gov.in';

const SCRAPER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Connection': 'keep-alive'
};

const FETCH_TIMEOUT_MS = 10000; // 10-second timeout — be polite to government servers

// ---------------------------------------------------------------------------
// Helper: fetch a page with timeout and return the HTML body as a string
// ---------------------------------------------------------------------------
async function fetchPage(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: SCRAPER_HEADERS,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} from ${url}`);
    }

    return await response.text();
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? 'Timeout' : err.message;
    throw new Error(`Failed to fetch ${url}: ${reason}`);
  }
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6-second download timeout

  try {
    const response = await fetch(pdfUrl, {
      method: 'GET',
      headers: SCRAPER_HEADERS,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfData = await pdfParse(buffer);
    
    if (!pdfData || !pdfData.text) {
      throw new Error("No text content returned from PDF");
    }

    console.log(`[PDF_CRAWLER] PDF fetched and parsed successfully (${pdfData.text.length} chars).`);
    return extractDetailsFromPdfText(pdfData.text);
  } catch (err) {
    clearTimeout(timeoutId);
    const reason = err.name === 'AbortError' ? 'Timeout (6s)' : err.message;
    console.error(`[PDF_CRAWLER] Failed to parse PDF from ${pdfUrl}: ${reason}`);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Helper: parse dates extracted from PDF text (supporting DD.MM.YYYY formats)
// ---------------------------------------------------------------------------
function parseExtractedDate(dateStr) {
  if (!dateStr) return null;
  let cleaned = dateStr.replace(/\(.*?\)/g, '').replace(/upto.*/i, '').trim();

  let parsed = new Date(cleaned);
  if (!isNaN(parsed.getTime())) {
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const dmyMatch = cleaned.match(/(\d{1,2})[\.\-\/](\d{1,2})[\.\-\/](\d{4})/);
  if (dmyMatch) {
    const day = dmyMatch[1].padStart(2, '0');
    const month = dmyMatch[2].padStart(2, '0');
    const year = dmyMatch[3];
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
// Merge scraped data into the existing jobs database
//
// Strategy:
//   - Hand-seeded entries (no `source` field) are NEVER overwritten
//   - Scraped entries are matched by `id` for dedup
//   - New scraped entries are appended with partial data
//   - Returns { newEntries, updatedCount, unchangedCount }
// ---------------------------------------------------------------------------
function mergeScrapedData(existingJobs, scrapedNotifications, scrapedAdvertisements) {
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

  // Process advertisements (richer data)
  scrapedAdvertisements.forEach(advt => {
    if (existingIds.has(advt.id)) return; // Already exists — skip

    const statusInfo = inferStatus(advt.startDate, advt.endDate);

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
      admitCardDate: null,
      examDate: null,
      resultsDate: null,
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

  // Process notifications (less structured — title + PDF only)
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
      admitCardDate: null,
      examDate: null,
      resultsDate: null,
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

  return {
    newEntries,
    unchangedCount: existingJobs.length,
    totalScraped: scrapedNotifications.length + scrapedAdvertisements.length
  };
}

module.exports = {
  scrapeWBPSCNotifications,
  scrapeWBPSCAdvertisements,
  mergeScrapedData,
  isJobVacancyNotice,
  isWithinLast3Months
};
