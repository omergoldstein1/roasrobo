const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// Define paths for persistent storage on Render
const diskMountPath = process.env.RENDER_DISK_MOUNT_PATH || '/data';
const AUTH_FILE = path.join(diskMountPath, 'google-auth-state.json');
const USER_DATA_DIR = path.join(diskMountPath, 'user-data-dir');

// Make sure directories exist
if (!fs.existsSync(diskMountPath)) {
  fs.mkdirSync(diskMountPath, { recursive: true });
  console.log(`Created data directory: ${diskMountPath}`);
}

if (!fs.existsSync(USER_DATA_DIR)) {
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });
  console.log(`Created user data directory: ${USER_DATA_DIR}`);
}

// Google account credentials - using your account with environment variable fallbacks
const EMAIL = process.env.GOOGLE_EMAIL || 'roasrobo@brandbolt.co';
const PASSWORD = process.env.GOOGLE_PASSWORD || '123Brandbolt$'; // Will be overridden by env var in production

async function saveGoogleAuth() {
  console.log('Starting enhanced Google authentication session...');
  
  // Launch with persistent context to better maintain session state
  const browser = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: process.env.NODE_ENV === 'production', // Headless in production, visible in development
    slowMo: 100,      // Slow down operations for stability
    args: [
      '--disable-blink-features=AutomationControlled', // Helps avoid detection
      '--no-sandbox',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
    ]
  });
  
  const page = await browser.newPage();
  
  try {
    // Navigate to Google login
    console.log('Navigating to Google login...');
    await page.goto('https://accounts.google.com/signin');
    
    // Check if already signed in
    const alreadySignedIn = await page.evaluate(() => {
      return document.body.textContent.includes('Choose an account');
    });
    
    if (alreadySignedIn) {
      console.log('Already signed in or session found');
      // Click on the correct account if multiple accounts are shown
      try {
        const accountSelector = `text=${EMAIL}`;
        const hasAccount = await page.$(accountSelector);
        
        if (hasAccount) {
          console.log(`Found existing account for ${EMAIL}, selecting it...`);
          await page.click(accountSelector);
        }
      } catch (e) {
        console.log('No account selection needed or error selecting account:', e.message);
      }
    } else {
      // Enter email
      console.log('Entering email...');
      await page.waitForSelector('input[type="email"]');
      await page.fill('input[type="email"]', EMAIL);
      await page.click('button:has-text("Next"), div[role="button"]:has-text("Next")');
      
      // Wait for password field and enter password
      console.log('Entering password...');
      await page.waitForSelector('input[name="password"], input[type="password"]', { timeout: 10000 });
      await page.fill('input[name="password"], input[type="password"]', PASSWORD);
      await page.click('button:has-text("Next"), div[role="button"]:has-text("Next")');
      
      // Check for security verification and notify user
      try {
        const has2FA = await page.waitForSelector('input[name="totpPin"], input[type="tel"]', { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        
        if (has2FA) {
          console.log('2FA verification required. Please check your phone and enter the code.');
          
          if (process.env.NODE_ENV === 'production') {
            console.log('Running in production mode with headless browser. 2FA may fail.');
            // You might want to implement a way to handle 2FA in production
          } else {
            console.log('Waiting for you to complete verification...');
          }
          
          // Wait for navigation after 2FA
          await page.waitForNavigation({ timeout: 120000 });
        }
      } catch (e) {
        console.log('No 2FA prompt detected or it was handled automatically');
      }
    }
    
    // Check for "Confirm it's you" security prompts
    try {
      const securityPrompt = await page.waitForSelector('text=Confirm it\'s you', { timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      
      if (securityPrompt) {
        console.log('Additional security verification required. Please complete it manually.');
        
        if (process.env.NODE_ENV === 'production') {
          console.log('Running in production mode. Security verification may fail.');
        } else {
          await page.waitForNavigation({ timeout: 120000 });
        }
      }
    } catch (e) {
      console.log('No additional security verification needed');
    }
    
    // Important: Visit all domains we'll need access to
    // This ensures cookies and tokens are properly set
    console.log('Setting up credentials for required domains...');
    
    // Visit Google
    await page.goto('https://www.google.com/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    
    // Visit Looker Studio specifically
    console.log('Visiting Looker Studio to establish session...');
    await page.goto('https://lookerstudio.google.com', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    // Visit the specific dashboard to ensure we have access
    console.log('Visiting the specific dashboard...');
    await page.goto('https://lookerstudio.google.com/reporting/0b22c83d-7d61-41f3-b7cb-ddf5618c05c1', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForTimeout(10000);
    
    // Save the authenticated state
    console.log('Saving authenticated state...');
    await browser.storageState({ path: AUTH_FILE });
    
    // Verify the auth file was created properly
    const authFileStats = fs.statSync(AUTH_FILE);
    console.log(`Authentication state saved (${(authFileStats.size / 1024).toFixed(2)} KB)`);
    
    if (authFileStats.size < 1000) {
      console.warn('WARNING: Auth file seems very small, might not contain all necessary credentials');
    }
    
    console.log('Authentication setup complete! You should now be able to run your monitoring script without re-authentication.');
    console.log(`Storage state saved to: ${AUTH_FILE}`);
    console.log(`Browser user data saved to: ${USER_DATA_DIR}`);
    
    // Display success message with next steps
    if (process.env.NODE_ENV !== 'production') {
      await page.evaluate(() => {
        const div = document.createElement('div');
        div.style.position = 'fixed';
        div.style.top = '0';
        div.style.left = '0';
        div.style.width = '100%';
        div.style.padding = '20px';
        div.style.backgroundColor = '#4CAF50';
        div.style.color = 'white';
        div.style.zIndex = '9999';
        div.style.textAlign = 'center';
        div.style.fontSize = '18px';
        div.innerHTML = '<b>Authentication Successful!</b><br>You can now close this browser and run your monitoring script.';
        document.body.appendChild(div);
      });
      
      // Stay open so user can see the success message
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
    
  } catch (error) {
    console.error('Error during authentication:', error);
  } finally {
    await browser.close();
  }
}

// Export both the function and file paths so they can be used in the main script
module.exports = {
  saveGoogleAuth,
  AUTH_FILE,
  USER_DATA_DIR
};

// Run directly if this script is executed directly
if (require.main === module) {
  saveGoogleAuth();
}
