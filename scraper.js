// Karma Scraper Module — Real HTML parsing for West Bengal government portals
// Uses cheerio to parse server-rendered JSP pages from psc.wb.gov.in

// Ignore invalid/self-signed SSL certificates from government websites
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const cheerio = require('cheerio');

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

    results.push({
      title,
      pdfUrl,
      uploadDate,
      source: 'notification',
      id: generateId('wbpsc-notif', title)
    });
  });

  return results;
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

  return results;
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
      noticeNo: advt.advtNo || 'N/A',
      vacancies: null,          // Not available from HTML
      ageLimit: null,            // Not available from HTML
      qualification: null,       // Not available from HTML
      payScale: null,            // Not available from HTML
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

    // Skip notifications that are clearly not recruitment-related
    const titleLower = notif.title.toLowerCase();
    const isRecruitmentRelated = (
      titleLower.includes('recruitment') ||
      titleLower.includes('advertisement') ||
      titleLower.includes('examination') ||
      titleLower.includes('advt') ||
      titleLower.includes('vacancy') ||
      titleLower.includes('apply') ||
      titleLower.includes('application')
    );

    // Only add recruitment-related notifications
    if (!isRecruitmentRelated) return;

    const jobEntry = {
      id: notif.id,
      dept: 'WBPSC',
      deptFull: 'Public Service Commission, West Bengal',
      postName: notif.title,
      noticeNo: 'N/A',
      vacancies: null,
      ageLimit: null,
      qualification: null,
      payScale: null,
      category: 'General Administration',
      status: 'open',
      statusText: 'Notice Published',
      datePosted: notif.uploadDate,
      dateDeadline: null,
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
  mergeScrapedData
};
