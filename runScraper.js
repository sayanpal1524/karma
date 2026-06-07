// Karma: Command line scraper runner for GitHub Actions workflow execution
const fs = require('fs');
const path = require('path');
const {
  scrapeWBPSCNotifications,
  scrapeWBPSCAdvertisements,
  scrapeWBPRBRecruitments,
  scrapeWBHEALTHRecruitments,
  mergeScrapedData,
  isJobVacancyNotice,
  isWithinLast3Months
} = require('./scraper');

const DB_PATH = path.join(__dirname, 'scrapedJobs.json');

// Helper: atomic JSON database reader
function readDatabase() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log('[DATABASE] DB file does not exist, starting with empty array.');
      return [];
    }
    const rawData = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(rawData);
  } catch (err) {
    console.error('[DATABASE] Error reading file, using empty cache', err);
    return [];
  }
}

// Helper: atomic JSON database writer
function writeDatabase(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    console.log('[DATABASE] Successfully wrote data to persistent file.');
    return true;
  } catch (err) {
    console.error('[DATABASE] Error writing file', err);
    return false;
  }
}

// Database cleanup and pruning function
function cleanupDatabase(currentJobs) {
  console.log('[DATABASE] Initiating database cleanup and filtering...');
  const initialCount = currentJobs.length;

  const filteredJobs = currentJobs.filter(job => {
    // Keep hand-seeded jobs (no source field or source !== 'scraped')
    if (!job.source || job.source !== 'scraped') {
      return true;
    }

    // For scraped jobs, apply the 3-month vacancy/admit/extension filter
    if (job.dept === 'WBPSC' || job.dept === 'WBPRB' || job.dept === 'WBHEALTH') {
      const dateToCheck = job.datePosted || job.dateDeadline || job.lastActivityDate;
      return isJobVacancyNotice(job.postName) && isWithinLast3Months(dateToCheck);
    }

    return true;
  });

  if (filteredJobs.length !== initialCount) {
    console.log(`[DATABASE] Cleanup complete! Removed ${initialCount - filteredJobs.length} outdated/non-vacancy notices.`);
  } else {
    console.log('[DATABASE] Database is already clean. No records or outdated entries removed.');
  }
  return filteredJobs;
}

// Main execution block
async function executeScraper() {
  console.log('\n======================================================');
  console.log('  KARMA AUTOMATED CLI SCRAPER INITIATED');
  console.log(`  Database path: ${DB_PATH}`);
  console.log('======================================================\n');

  const start = Date.now();

  try {
    console.log('[SCRAPER] Connecting to West Bengal recruitment boards in parallel...');
    const [notifications, advertisements, wbprbNotices, wbhealthNotices] = await Promise.all([
      scrapeWBPSCNotifications().catch(e => { console.error('[ERROR] WBPSC Announcements:', e.message); return []; }),
      scrapeWBPSCAdvertisements().catch(e => { console.error('[ERROR] WBPSC Advertisements:', e.message); return []; }),
      scrapeWBPRBRecruitments().catch(e => { console.error('[ERROR] WBPRB Recruitments:', e.message); return []; }),
      scrapeWBHEALTHRecruitments().catch(e => { console.error('[ERROR] WBHEALTH Recruitments:', e.message); return []; })
    ]);

    console.log(`[SCRAPER] Scrape finished. Found:
      - ${notifications.length} WBPSC notifications
      - ${advertisements.length} WBPSC advertisements
      - ${wbprbNotices.length} WBPRB notices
      - ${wbhealthNotices.length} WBHEALTH notices`);

    const currentJobs = readDatabase();
    
    // Merge new discoveries
    const { newEntries, totalScraped } = mergeScrapedData(
      currentJobs,
      notifications,
      advertisements,
      wbprbNotices,
      wbhealthNotices
    );

    let updatedJobs = currentJobs;
    if (newEntries.length > 0) {
      console.log(`[SCRAPER] Discovered ${newEntries.length} new entries! Merging to database...`);
      updatedJobs = [...newEntries, ...currentJobs];
    } else {
      console.log(`[SCRAPER] No new entries found. Checked ${totalScraped} notices total.`);
    }

    // Run database cleanup/filtering
    const finalCleanJobs = cleanupDatabase(updatedJobs);

    // Save back to file
    writeDatabase(finalCleanJobs);

    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n[SUCCESS] Scraper cycle completed successfully in ${duration}s.\n`);
    process.exit(0);

  } catch (err) {
    console.error('\n[FATAL ERROR] Scraper execution failed:', err);
    process.exit(1);
  }
}

executeScraper();
