const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Import auth module
const { AUTH_FILE, USER_DATA_DIR } = require('./improved-auth');

// ROAS threshold for scaling
const SCALE_ROAS_THRESHOLD = 1.8;

// Define directory for screenshots
const SCREENSHOT_DIR = process.env.RENDER_DISK_MOUNT_PATH ? 
  path.join(process.env.RENDER_DISK_MOUNT_PATH, 'screenshots') : 
  path.join(__dirname, 'screenshots');

// Create screenshots directory if it doesn't exist
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  console.log(`Created screenshots directory: ${SCREENSHOT_DIR}`);
}

async function findCampaignsToScale() {
  console.log(`Finding campaigns with ROAS > ${SCALE_ROAS_THRESHOLD}...`);
  
  // Check if auth file exists
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`ERROR: Authentication file ${AUTH_FILE} not found.`);
    return [];
  }
  
  let browser;
  let highRoasCampaigns = [];
  
  try {
    console.log(`Using authentication state from: ${AUTH_FILE}`);
    
    // Use both persistent context and storage state for maximum reliability
    browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: process.env.NODE_ENV === 'production', // Headless in production, visible in development
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-web-security',
      ],
      storageState: AUTH_FILE
    });
    
    const page = await browser.newPage();
    
    // Take a screenshot at start
    const startScreenshot = path.join(SCREENSHOT_DIR, 'scale_search_start.png');
    await page.screenshot({ path: startScreenshot });
    
    // Navigate directly to the Looker Studio dashboard
    console.log('Navigating to Looker Studio dashboard...');
    await page.goto('https://lookerstudio.google.com/reporting/0b22c83d-7d61-41f3-b7cb-ddf5618c05c1', { 
      waitUntil: 'domcontentloaded',
      timeout: 180000 // 3 minutes
    });
    
    // Give it extra time to process after basic load
    await page.waitForTimeout(30000);
    
    // Take a screenshot after navigation
    const midScreenshot = path.join(SCREENSHOT_DIR, 'scale_search_loaded.png');
    await page.screenshot({ path: midScreenshot });
    
    // Wait for the table to appear
    console.log('Looking for data table...');
    await page.waitForSelector('.table', { timeout: 45000 }).catch(e => {
      console.log('Table not found with .table selector, continuing anyway...');
    });
    
    // Check for headerRow
    await page.waitForSelector('.headerRow', { timeout: 10000 }).catch(e => {
      console.log('Header row not found, continuing anyway...');
    });
    
    // Give extra time for all elements to render
    await page.waitForTimeout(15000);
    
    // Now target the rows specifically
    const rows = await page.$$('.row:not(.headerRow)');
    console.log(`Found ${rows.length} campaign rows`);
    
    if (rows.length === 0) {
      // Try an alternative selector
      const altRows = await page.$$('.tableBody .row');
      if (altRows.length > 0) {
        console.log(`Found ${altRows.length} campaign rows using alternative selector`);
        await processCampaigns(altRows);
      } else {
        console.log('No campaign data rows found');
        
        // Take error screenshot
        const errorScreenshot = path.join(SCREENSHOT_DIR, 'scale_no_rows.png');
        await page.screenshot({ path: errorScreenshot, fullPage: true });
      }
    } else {
      // Process with found rows
      await processCampaigns(rows);
    }
    
    // Process rows to find high ROAS campaigns
    async function processCampaigns(rowsToProcess) {
      for (let i = 0; i < rowsToProcess.length; i++) {
        try {
          const row = rowsToProcess[i];
          const cells = await row.$$('.cell');
          
          if (cells.length < 8) {
            continue;
          }
          
          // Extract data - same column structure as in updated-monitor.js
          // Account name (column 3)
          const accountName = await cells[2].textContent();
          
          // Campaign name (column 4)
          const campaignName = await cells[3].textContent();
          
          // Status (column 5)
          const statusText = await cells[4].textContent();
          
          // Cost (column 6)
          const costText = await cells[5].textContent();
          let cost = parseFloat(costText.replace(/[^\d.]/g, ''));
          if (isNaN(cost)) cost = 0;
          
          // Revenue (column 7)
          const revenueText = await cells[6].textContent();
          let revenue = parseFloat(revenueText.replace(/[^\d.]/g, ''));
          if (isNaN(revenue)) revenue = 0;
          
          // ROAS (column 8)
          const roasText = await cells[7].textContent();
          let roas = parseFloat(roasText);
          if (isNaN(roas) || roasText.trim().toLowerCase() === 'null') {
            roas = 0;
          }
          
          // Is the campaign active?
          const isActive = statusText.trim() === 'ACTIVE';
          
          // Check if this is a high-performing campaign
          if (isActive && roas >= SCALE_ROAS_THRESHOLD && cost > 0) {
            console.log(`Found high-ROAS campaign: ${campaignName}, ROAS: ${roas}`);
            highRoasCampaigns.push({
              account: accountName,
              campaign: campaignName,
              status: statusText.trim(),
              roas: roas.toFixed(2),
              cost: cost.toFixed(2),
              revenue: revenue.toFixed(2)
            });
          }
        } catch (rowError) {
          console.error('Error processing row:', rowError);
        }
      }
    }
    
    // Take a final screenshot
    const finalScreenshot = path.join(SCREENSHOT_DIR, 'scale_search_complete.png');
    await page.screenshot({ path: finalScreenshot });
    
    // Update auth state after successful run
    console.log('Updating authentication state after successful run...');
    await browser.storageState({ path: AUTH_FILE });
    
    console.log(`Found ${highRoasCampaigns.length} high-ROAS campaigns for scaling`);
    
    // Sort by ROAS descending
    highRoasCampaigns.sort((a, b) => parseFloat(b.roas) - parseFloat(a.roas));
    
  } catch (error) {
    console.error('ERROR DURING EXECUTION:', error);
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
    
    // Output the results as JSON for the parent process to read
    console.log(JSON.stringify(highRoasCampaigns));
  }
  
  return highRoasCampaigns;
}

// Run the function
findCampaignsToScale();
