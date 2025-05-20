const { chromium } = require('playwright');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

// Import auth module
const { AUTH_FILE, USER_DATA_DIR } = require('./improved-auth');

// Check for command line arguments
const args = process.argv.slice(2);
const belowRoasChop = args.includes('--below-roas-chop');
const zeroRoasKiller = args.includes('--zero-roas-killer');
const autoReactivate = args.includes('--auto-reactivate');

console.log(`Running with options: Below ROAS Chop: ${belowRoasChop}, Zero ROAS Killer: ${zeroRoasKiller}, Auto Reactivate: ${autoReactivate}`);

// Email configuration
const EMAIL_CONFIG = {
  enabled: true,
  from: 'roasrobo@brandbolt.co',
  to: process.env.NOTIFICATION_EMAIL || 'conner@brandbolt.co',
  subject: 'ROASRobo Report',
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'roasrobo@brandbolt.co',
      pass: process.env.EMAIL_APP_PASSWORD || 'grej teth puim rbfk' // App password
    }
  }
};

// Define directory for screenshots
const SCREENSHOT_DIR = process.env.RENDER_DISK_MOUNT_PATH ? 
  path.join(process.env.RENDER_DISK_MOUNT_PATH, 'screenshots') : 
  path.join(__dirname, 'screenshots');

// Create screenshots directory if it doesn't exist
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  console.log(`Created screenshots directory: ${SCREENSHOT_DIR}`);
}

/**
 * Function to refresh data by simply reloading the page
 * This is more reliable than trying to find and click UI elements
 */
async function refreshDashboardData(page, monitoringResults) {
  console.log('Refreshing data by reloading the page...');
  
  try {
    // Take a screenshot before reload
    const beforeReloadPath = path.join(SCREENSHOT_DIR, 'before_reload.png');
    await page.screenshot({ path: beforeReloadPath });
    monitoringResults.screenshots.push(beforeReloadPath);
    
    // Reload the page
    console.log('Reloading page to get fresh data...');
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Wait for page to load and data to refresh
    console.log('Waiting for page to reload and data to refresh...');
    await page.waitForTimeout(30000);
    
    // Take a screenshot after reload
    const afterReloadPath = path.join(SCREENSHOT_DIR, 'after_reload.png');
    await page.screenshot({ path: afterReloadPath });
    monitoringResults.screenshots.push(afterReloadPath);
    
    console.log('Page reloaded successfully, data should be fresh');
    return true;
  } catch (error) {
    console.error('Error reloading page:', error);
    monitoringResults.errors.push(`Failed to reload page: ${error.message}`);
    return false;
  }
}

async function monitorCampaigns() {
  console.log('Starting campaign monitoring...');
  
  const monitoringResults = {
    startTime: new Date(),
    endTime: null,
    totalCampaigns: 0,
    activeCampaigns: 0,
    inactiveCampaigns: 0,
    lowRoasCampaigns: 0,
    zeroRoasHighSpendCampaigns: 0,
    changedCampaigns: [],
    preservedCampaigns: [],
    errors: [],
    screenshots: []
  };
  
  // Check if auth file exists
  if (!fs.existsSync(AUTH_FILE)) {
    console.error(`ERROR: Authentication file ${AUTH_FILE} not found. Please run the authentication script first.`);
    monitoringResults.errors.push(`Authentication file not found: ${AUTH_FILE}`);
    await sendEmailReport(monitoringResults);
    return;
  }
  
  let browser;
  let page;
  
  try {
    console.log(`Using authentication state from: ${AUTH_FILE}`);
    
    // Use both persistent context and storage state for maximum reliability
    browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: process.env.NODE_ENV === 'production', // Headless in production, visible in development
      slowMo: 100,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-web-security',
      ],
      storageState: AUTH_FILE
    });
    
    page = await browser.newPage();
    
    // Navigate directly to the Looker Studio dashboard with increased timeout
    console.log('Navigating to Looker Studio dashboard (this might take a while)...');
    await page.goto('https://lookerstudio.google.com/reporting/0b22c83d-7d61-41f3-b7cb-ddf5618c05c1', { 
      waitUntil: 'domcontentloaded', // Less strict wait condition
      timeout: 180000 // 3 minutes
    });
    console.log('Basic page load complete, waiting for dashboard to initialize...');
    
    // Check if we got redirected to a login page
    const url = page.url();
    if (url.includes('accounts.google.com') || url.includes('signin')) {
      console.error('ERROR: Redirected to login page. Authentication failed.');
      throw new Error('Authentication failed - redirected to login page');
    }
    
    // Give it extra time to process after basic load
    await page.waitForTimeout(30000); // 30 seconds additional wait time
    
    console.log('Checking for dashboard elements...');
    
    // Take a screenshot after initial load
    const loadingStatePath = path.join(SCREENSHOT_DIR, 'dashboard_loading_state.png');
    await page.screenshot({ path: loadingStatePath, fullPage: true });
    monitoringResults.screenshots.push(loadingStatePath);
    
    // Refresh dashboard data before processing
    console.log('Refreshing dashboard data before processing...');
    const refreshed = await refreshDashboardData(page, monitoringResults);
    if (!refreshed) {
      console.log('Could not refresh data, continuing with current data');
      monitoringResults.errors.push('Failed to refresh dashboard data before processing');
    }
    
    // Wait for the table to appear - using the exact class name
    console.log('Looking for data table...');
    await page.waitForSelector('.table', { timeout: 45000 }).catch(e => {
      console.log('Table not found with .table selector, continuing anyway...');
    });
    
    // Check specifically for the headerRow which should be present in the table
    await page.waitForSelector('.headerRow', { timeout: 10000 }).catch(e => {
      console.log('Header row not found, continuing anyway...');
    });
    
    // Give extra time for all elements to render fully
    console.log('Waiting for report data to fully render...');
    await page.waitForTimeout(15000);
    
    // Take a screenshot of current state
    const beforeScreenshot = path.join(SCREENSHOT_DIR, 'dashboard_before.png');
    await page.screenshot({ path: beforeScreenshot, fullPage: true });
    console.log('Initial screenshot taken');
    monitoringResults.screenshots.push(beforeScreenshot);
    
    // Now target the rows specifically with the class from your HTML
    const rows = await page.$$('.row:not(.headerRow)');
    console.log(`Found ${rows.length} possible campaign rows`);
    
    // Update monitoring results
    monitoringResults.totalCampaigns = rows.length;
    
    if (rows.length === 0) {
      // Try an alternative selector
      const altRows = await page.$$('.tableBody .row');
      if (altRows.length > 0) {
        console.log(`Found ${altRows.length} campaign rows using alternative selector`);
        monitoringResults.totalCampaigns = altRows.length;
        
        // Process with alternative rows
        await processRows(altRows);
      } else {
        const error = 'No campaign data rows found';
        console.log(error + '. Taking screenshot for debugging...');
        const errorScreenshot = path.join(SCREENSHOT_DIR, 'no_rows_found.png');
        await page.screenshot({ path: errorScreenshot, fullPage: true });
        monitoringResults.errors.push(error);
        monitoringResults.screenshots.push(errorScreenshot);
      }
    } else {
      // Process with found rows
      await processRows(rows);
    }
    
    // Function to process rows - defined inside to access variables in scope
    async function processRows(rowsToProcess) {
      // Store all changes
      const changes = [];
      
      for (let i = 0; i < rowsToProcess.length; i++) {
        try {
          const row = rowsToProcess[i];
          
          // Extract data based on the structure in your HTML
          // Get cells based on your HTML structure
          const cells = await row.$$('.cell');
          
          if (cells.length < 8) {
            console.log(`Row ${i} doesn't have enough cells (found ${cells.length}), skipping`);
            continue;
          }
          
          // Extract data - matching your HTML structure
          // Pause URL at index 0, Active URL at index 1, Account at index 2, Campaign at index 3
          // Status at index 4, Cost at index 5, Revenue at index 6, ROAS at index 7
          
          // Account name (column 3 in your HTML)
          const accountName = await cells[2].textContent();
          
          // Campaign name (column 4 in your HTML)
          const campaignName = await cells[3].textContent();
          
          // Status (column 5 in your HTML)
          const statusText = await cells[4].textContent();
          
          // Get cost from column 6 in your HTML
          const costText = await cells[5].textContent();
          let cost = parseFloat(costText.replace(/[^\d.]/g, ''));
          if (isNaN(cost)) cost = 0;
          
          // Get revenue from column 7 in your HTML
          const revenueText = await cells[6].textContent();
          let revenue = parseFloat(revenueText.replace(/[^\d.]/g, ''));
          if (isNaN(revenue)) revenue = 0;
          
          // Get ROAS from column 8 in your HTML  
          const roasText = await cells[7].textContent();
          let roas = parseFloat(roasText);
          
          // Handle null or invalid ROAS values
          if (isNaN(roas) || roasText.trim().toLowerCase() === 'null') {
            roas = 0;
          }
          
          // Get pause and active URLs
          const pauseUrlCell = cells[0];
          const activeUrlCell = cells[1];
          
          // Determine current status - looking for ACTIVE specifically
          const isActive = statusText.trim() === 'ACTIVE';
          const isPaused = statusText.trim() === 'PAUSED';
          
          // Update statistics
          if (isActive) monitoringResults.activeCampaigns++;
          else monitoringResults.inactiveCampaigns++;
          if (roas < 1.3) monitoringResults.lowRoasCampaigns++;
          if (isActive && roas === 0 && cost >= 160) monitoringResults.zeroRoasHighSpendCampaigns++;
          
          console.log(`Campaign: ${campaignName}, Account: ${accountName}, Cost: $${cost.toFixed(2)}, Revenue: $${revenue.toFixed(2)}, ROAS: ${roas}, Status: ${isActive ? 'ACTIVE' : 'PAUSED'}`);
          
          // Skip any action if campaign is already PAUSED, unless we're auto-reactivating
          if (isPaused) {
            console.log(`Campaign "${campaignName}" is PAUSED`);
            
            // Only activate if auto-reactivate is enabled and it has good ROAS
            if (autoReactivate && roas >= 1.3) {
              // Need to activate this campaign
              console.log(`Need to activate: ${campaignName} (ROAS: ${roas})`);
              
              // Find and click the Active URL link
              const activeLink = await activeUrlCell.$('a');
              
              if (activeLink) {
                console.log('Found Active link, clicking...');
                
                // Handle the redirect page after clicking
                const [newPage] = await Promise.all([
                  browser.waitForEvent('page'),
                  activeLink.click()
                ]);
                
                // On the redirect page, find and click the link to complete the action
                try {
                  await newPage.waitForSelector('a[href*="hook.eu2.make.com"]', { timeout: 5000 });
                  const redirectLink = await newPage.$('a[href*="hook.eu2.make.com"]');
                  
                  if (redirectLink) {
                    console.log('Found redirect link, clicking to complete action...');
                    await redirectLink.click();
                    
                    // Wait for the action to complete
                    await newPage.waitForTimeout(2000);
                  }
                  
                  // Close the redirect page
                  await newPage.close();
                } catch (redirectError) {
                  console.log('Error handling redirect page:', redirectError);
                  await newPage.close();
                }
                
                // Record this change
                const changeMessage = `Activated: ${accountName} - ${campaignName} (ROAS: ${roas.toFixed(2)})`;
                changes.push(changeMessage);
                monitoringResults.changedCampaigns.push({
                  account: accountName,
                  campaign: campaignName,
                  oldStatus: 'PAUSED',
                  newStatus: 'ACTIVE',
                  roas: roas.toFixed(2),
                  cost: cost.toFixed(2),
                  action: 'Activated - Good ROAS'
                });
              } else {
                console.log('Active link not found for this campaign');
                monitoringResults.errors.push(`Could not find active link for campaign: ${campaignName}`);
              }
            } else {
              // No change needed for paused campaign with low ROAS
              console.log(`Preserving PAUSED state: ${campaignName} (ROAS: ${roas} - below threshold or auto-reactivate disabled)`);
              monitoringResults.preservedCampaigns.push({
                account: accountName,
                campaign: campaignName,
                status: 'PAUSED',
                roas: roas.toFixed(2),
                cost: cost.toFixed(2)
              });
            }
            continue; // Skip the rest of the loop for PAUSED campaigns
          }
          
          // Decision logic for ACTIVE campaigns:
          
          // If spend >= $160 AND ROAS = 0 AND status is ACTIVE, pause the campaign (zero ROAS killer)
          if (zeroRoasKiller && isActive && cost >= 160 && roas === 0) {
            // Need to pause this high-spend, zero-return campaign
            console.log(`URGENT: Pausing high-spend zero-return campaign: ${campaignName} (Cost: $${cost.toFixed(2)}, ROAS: ${roas})`);
            
            // Find and click the Pause URL link in first cell
            const pauseLink = await pauseUrlCell.$('a');
            
            if (pauseLink) {
              console.log('Found Pause link, clicking...');
              
              // Handle the redirect page after clicking
              const [newPage] = await Promise.all([
                browser.waitForEvent('page'),
                pauseLink.click()
              ]);
              
              // On the redirect page, find and click the link to complete the action
              try {
                await newPage.waitForSelector('a[href*="hook.eu2.make.com"]', { timeout: 5000 });
                const redirectLink = await newPage.$('a[href*="hook.eu2.make.com"]');
                
                if (redirectLink) {
                  console.log('Found redirect link, clicking to complete action...');
                  await redirectLink.click();
                  
                  // Wait for the action to complete
                  await newPage.waitForTimeout(2000);
                }
                
                // Close the redirect page
                await newPage.close();
              } catch (redirectError) {
                console.log('Error handling redirect page:', redirectError);
                await newPage.close();
              }
              
              // Record this change
              const changeMessage = `URGENT PAUSE: ${accountName} - ${campaignName} (Cost: $${cost.toFixed(2)}, ROAS: ${roas.toFixed(2)})`;
              changes.push(changeMessage);
              monitoringResults.changedCampaigns.push({
                account: accountName,
                campaign: campaignName,
                oldStatus: 'ACTIVE',
                newStatus: 'PAUSED',
                roas: roas.toFixed(2),
                cost: cost.toFixed(2),
                action: 'URGENT PAUSE - High Spend Zero Sales'
              });
            } else {
              console.log('Pause link not found for this campaign');
              monitoringResults.errors.push(`Could not find pause link for campaign: ${campaignName}`);
            }
          } 
          // If spend >= $160 AND ROAS < 1.3 AND status is ACTIVE, pause the campaign (below ROAS chop)
          else if (belowRoasChop && isActive && (roas < 1.3) && cost >= 160) {
            // Need to pause this high-spend, low-return campaign
            console.log(`Pausing high-spend low-ROAS campaign: ${campaignName} (Cost: $${cost.toFixed(2)}, ROAS: ${roas})`);
            
            // Find and click the Pause URL link
            const pauseLink = await pauseUrlCell.$('a');
            
            if (pauseLink) {
              console.log('Found Pause link, clicking...');
              
              // Handle the redirect page after clicking
              const [newPage] = await Promise.all([
                browser.waitForEvent('page'),
                pauseLink.click()
              ]);
              
              // On the redirect page, find and click the link to complete the action
              try {
                await newPage.waitForSelector('a[href*="hook.eu2.make.com"]', { timeout: 5000 });
                const redirectLink = await newPage.$('a[href*="hook.eu2.make.com"]');
                
                if (redirectLink) {
                  console.log('Found redirect link, clicking to complete action...');
                  await redirectLink.click();
                  
                  // Wait for the action to complete
                  await newPage.waitForTimeout(2000);
                }
                
                // Close the redirect page
                await newPage.close();
              } catch (redirectError) {
                console.log('Error handling redirect page:', redirectError);
                await newPage.close();
              }
              
              // Record this change
              const changeMessage = `Paused: ${accountName} - ${campaignName} (ROAS: ${roas.toFixed(2)})`;
              changes.push(changeMessage);
              monitoringResults.changedCampaigns.push({
                account: accountName,
                campaign: campaignName,
                oldStatus: 'ACTIVE',
                newStatus: 'PAUSED',
                roas: roas.toFixed(2),
                cost: cost.toFixed(2),
                action: 'Paused - Low ROAS High Spend'
              });
            } else {
              console.log('Pause link not found for this campaign');
              monitoringResults.errors.push(`Could not find pause link for campaign: ${campaignName}`);
            }
          } 
          // Check for low ROAS campaigns with low spend
          else if (belowRoasChop && isActive && roas < 1.3 && cost < 160) {
            // Need to pause this campaign
            console.log(`Need to pause low-ROAS campaign: ${campaignName} (ROAS: ${roas})`);
            
            // Find and click the Pause URL link
            const pauseLink = await pauseUrlCell.$('a');
            
            if (pauseLink) {
              console.log('Found Pause link, clicking...');
              
              // Handle the redirect page after clicking
              const [newPage] = await Promise.all([
                browser.waitForEvent('page'),
                pauseLink.click()
              ]);
              
              // On the redirect page, find and click the link to complete the action
              try {
                await newPage.waitForSelector('a[href*="hook.eu2.make.com"]', { timeout: 5000 });
                const redirectLink = await newPage.$('a[href*="hook.eu2.make.com"]');
                
                if (redirectLink) {
                  console.log('Found redirect link, clicking to complete action...');
                  await redirectLink.click();
                  
                  // Wait for the action to complete
                  await newPage.waitForTimeout(2000);
                }
                
                // Close the redirect page
                await newPage.close();
              } catch (redirectError) {
                console.log('Error handling redirect page:', redirectError);
                await newPage.close();
              }
              
              // Record this change
              const changeMessage = `Paused: ${accountName} - ${campaignName} (ROAS: ${roas.toFixed(2)})`;
              changes.push(changeMessage);
              monitoringResults.changedCampaigns.push({
                account: accountName,
                campaign: campaignName,
                oldStatus: 'ACTIVE',
                newStatus: 'PAUSED',
                roas: roas.toFixed(2),
                cost: cost.toFixed(2),
                action: 'Paused - Low ROAS'
              });
            } else {
              console.log('Pause link not found for this campaign');
              monitoringResults.errors.push(`Could not find pause link for campaign: ${campaignName}`);
            }
          } else {
            // No change needed (active campaign with good ROAS)
            console.log(`Preserving ACTIVE state: ${campaignName} (ROAS: ${roas} - above threshold or controls disabled)`);
            monitoringResults.preservedCampaigns.push({
              account: accountName,
              campaign: campaignName,
              status: 'ACTIVE',
              roas: roas.toFixed(2),
              cost: cost.toFixed(2)
            });
          }
        } catch (rowError) {
          console.error('Error processing row:', rowError);
          monitoringResults.errors.push(`Error processing campaign row: ${rowError.message}`);
        }
      }
      
      // Print summary of changes
      console.log('\n=== CHANGES MADE ===');
      if (changes.length === 0) {
        console.log('No changes were needed. All campaigns have appropriate status based on ROAS.');
      } else {
        changes.forEach((change, index) => {
          console.log(`${index + 1}. ${change}`);
        });
      }
    }
    
    // Take a screenshot of final state
    const afterScreenshot = path.join(SCREENSHOT_DIR, 'dashboard_after.png');
    await page.screenshot({ path: afterScreenshot, fullPage: true });
    console.log('Final screenshot taken and saved as dashboard_after.png');
    monitoringResults.screenshots.push(afterScreenshot);
    
    // Set end time for monitoring
    monitoringResults.endTime = new Date();
    
    // Update auth state after successful run
    console.log('Updating authentication state after successful run...');
    await browser.storageState({ path: AUTH_FILE });
    
    console.log('Monitoring completed successfully');
  } catch (error) {
    console.error('ERROR DURING EXECUTION:', error);
    monitoringResults.errors.push(`Major error: ${error.message}`);
    try {
      if (page) {
        const errorScreenshot = path.join(SCREENSHOT_DIR, 'error_state.png');
        await page.screenshot({ path: errorScreenshot, fullPage: true });
        console.log('Error state screenshot saved');
        monitoringResults.screenshots.push(errorScreenshot);
      }
    } catch (e) {}
  } finally {
    if (browser) {
      await browser.close();
      console.log('Browser closed');
    }
    
    // Send email report
    if (EMAIL_CONFIG.enabled) {
      await sendEmailReport(monitoringResults);
    }
  }
}

// Function to send email report
async function sendEmailReport(results) {
  console.log('Preparing email report...');
  
  try {
    // Calculate duration
    const duration = (results.endTime - results.startTime) / 1000; // in seconds
    
    // Create email body HTML
    const emailBody = `
      <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
            .header { background-color: #f8f9fa; padding: 15px; border-bottom: 1px solid #ddd; }
            .content { padding: 15px; }
            table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
            .success { color: green; }
            .warning { color: orange; }
            .error { color: red; }
            .urgent { color: red; font-weight: bold; }
            .summary { margin-bottom: 20px; }
          </style>
        </head>
        <body>
          <div class="header">
            <h2>Campaign Dashboard Monitoring Report</h2>
            <p>Run on: ${results.startTime.toLocaleString()}</p>
          </div>
          <div class="content">
            <div class="summary">
              <h3>Summary</h3>
              <p>Total campaigns analyzed: <strong>${results.totalCampaigns}</strong></p>
              <p>Active campaigns: <strong>${results.activeCampaigns}</strong> ${results.totalCampaigns ? `(${((results.activeCampaigns / results.totalCampaigns) * 100).toFixed(1)}%)` : ''}</p>
              <p>Inactive campaigns: <strong>${results.inactiveCampaigns}</strong> ${results.totalCampaigns ? `(${((results.inactiveCampaigns / results.totalCampaigns) * 100).toFixed(1)}%)` : ''}</p>
              <p>Low ROAS campaigns: <strong>${results.lowRoasCampaigns}</strong> ${results.totalCampaigns ? `(${((results.lowRoasCampaigns / results.totalCampaigns) * 100).toFixed(1)}%)` : ''}</p>
              ${results.zeroRoasHighSpendCampaigns > 0 ? `<p class="urgent">High-spend zero-return campaigns: <strong>${results.zeroRoasHighSpendCampaigns}</strong></p>` : ''}
              <p>Changes made: <strong>${results.changedCampaigns.length}</strong></p>
              <p>Duration: <strong>${duration.toFixed(2)} seconds</strong></p>
            </div>
            
            ${results.changedCampaigns.length > 0 ? `
              <h3>Changes Made</h3>
              <table>
                <tr>
                  <th>Account</th>
                  <th>Campaign</th>
                  <th>Action</th>
                  <th>ROAS</th>
                  <th>Cost</th>
                </tr>
                ${results.changedCampaigns.map(change => `
                  <tr ${change.action.includes('URGENT') || change.action.includes('High Spend Zero') ? 'style="background-color: #ffeeee;"' : ''}>
                    <td>${change.account}</td>
                    <td>${change.campaign}</td>
                    <td ${change.action.includes('URGENT') || change.action.includes('High Spend Zero') ? 'class="urgent"' : ''}>${change.action}</td>
                    <td>${change.roas}</td>
                    <td>$${change.cost}</td>
                  </tr>
                `).join('')}
              </table>
            ` : '<p class="success">No changes were needed. All campaigns have appropriate status based on ROAS.</p>'}
            
            ${results.preservedCampaigns.length > 0 ? `
              <h3>Preserved Campaigns</h3>
              <table>
                <tr>
                  <th>Account</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>ROAS</th>
                  <th>Cost</th>
                </tr>
                ${results.preservedCampaigns.map(campaign => `
                  <tr>
                    <td>${campaign.account}</td>
                    <td>${campaign.campaign}</td>
                    <td>${campaign.status}</td>
                    <td>${campaign.roas}</td>
                    <td>$${campaign.cost}</td>
                  </tr>
                `).join('')}
              </table>
            ` : ''}
            
            ${results.errors.length > 0 ? `
              <h3 class="error">Errors</h3>
              <ul>
                ${results.errors.map(error => `<li class="error">${error}</li>`).join('')}
              </ul>
            ` : ''}
            
            <p>This is an automated report. Please do not reply to this email.</p>
          </div>
        </body>
      </html>
    `;
    
    // Create transporter
    const transporter = nodemailer.createTransport(EMAIL_CONFIG.smtp);
    
    // Send email
    const info = await transporter.sendMail({
      from: EMAIL_CONFIG.from,
      to: EMAIL_CONFIG.to,
      subject: EMAIL_CONFIG.subject,
      html: emailBody
      // Uncomment below to include screenshots as attachments
      /*
      attachments: results.screenshots.map(screenshot => ({
        filename: path.basename(screenshot),
        path: screenshot,
        cid: path.basename(screenshot)
      }))
      */
    });
    
    console.log('Email report sent:', info.messageId);
  } catch (error) {
    console.error('Error sending email report:', error);
  }
}

// Run the monitoring function
monitorCampaigns();
