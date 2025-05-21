const cron = require('node-cron');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// Path to store script status
const STATUS_FILE = path.join(process.env.RENDER_DISK_MOUNT_PATH || '/data', 'script-status.json');

// Initialize status object
let scriptStatus = {
  isRunning: false,
  automationEnabled: true,
  lastRun: null,
  lastResult: null,
  controls: {
    belowRoasChop: false,
    zeroRoasKiller: false,
    autoReactivate: false
  },
  campaigns: []
};

// Load status if file exists
try {
  if (fs.existsSync(STATUS_FILE)) {
    scriptStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    if (typeof scriptStatus.automationEnabled === 'undefined') {
      scriptStatus.automationEnabled = true;
    }
    console.log('Loaded script status from file:', scriptStatus);
  } else {
    // Create the status file if it doesn't exist
    fs.writeFileSync(STATUS_FILE, JSON.stringify(scriptStatus), 'utf8');
    console.log('Created new script status file');
  }
} catch (error) {
  console.error('Error handling script status file:', error);
}

// Save status to a file
const saveStatus = () => {
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(scriptStatus), 'utf8');
    console.log('Status saved successfully');
  } catch (error) {
    console.error('Error saving status:', error);
  }
};

// Function to run the monitoring script
function runMonitoringScript() {
  if (scriptStatus.isRunning) {
    console.log('Script is already running, skipping this execution');
    return;
  }

  if (!scriptStatus.automationEnabled) {
    console.log('Automation is disabled, skipping script execution');
    return;
  }
  
  console.log('Running monitoring script...');
  scriptStatus.isRunning = true;
  scriptStatus.lastRun = new Date().toISOString();
  saveStatus();
  
  // Create command with appropriate flags based on enabled controls
  let command = 'node updated-monitor.js';
  
  if (scriptStatus.controls.belowRoasChop) {
    command += ' --below-roas-chop';
  }
  
  if (scriptStatus.controls.zeroRoasKiller) {
    command += ' --zero-roas-killer';
  }
  
  if (scriptStatus.controls.autoReactivate) {
    command += ' --auto-reactivate';
  }
  
  // Execute the script
  exec(command, (error, stdout, stderr) => {
    scriptStatus.isRunning = false;
    
    if (error) {
      console.error(`Error executing script: ${error.message}`);
      scriptStatus.lastResult = {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    } else {
      console.log('Script executed successfully');
      scriptStatus.lastResult = {
        success: true,
        output: stdout.substring(0, 500) + (stdout.length > 500 ? '...' : ''),
        timestamp: new Date().toISOString()
      };
    }
    
    saveStatus();
  });
}

// Set up cron job to run the script at the 5th minute of every hour
cron.schedule('5 * * * *', () => {
  console.log('Running scheduled task at 5th minute of the hour');
  
  // Check which controls are enabled and run appropriate tasks
  if (scriptStatus.automationEnabled && (
      scriptStatus.controls.belowRoasChop ||
      scriptStatus.controls.zeroRoasKiller ||
      scriptStatus.controls.autoReactivate)) {
    runMonitoringScript();
  } else {
    console.log('Automation disabled or no controls enabled, skipping scheduled execution');
  }
});

// Keep the process running
console.log('Cron service started. Monitoring script will run at 5 minutes past each hour.');
