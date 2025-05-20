const express = require('express');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const { exec } = require('child_process');
const path = require('path');
const cron = require('node-cron');
const fs = require('fs');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

// Define paths for persistent storage on Render
const diskMountPath = process.env.RENDER_DISK_MOUNT_PATH || '/data';
const AUTH_FILE = path.join(diskMountPath, 'google-auth-state.json');
const STATUS_FILE = path.join(diskMountPath, 'script-status.json');

// Make sure the data directory exists
if (!fs.existsSync(diskMountPath)) {
  fs.mkdirSync(diskMountPath, { recursive: true });
  console.log(`Created data directory: ${diskMountPath}`);
}

// Google OAuth configuration
const CLIENT_ID = process.env.CLIENT_ID || 'YOUR_GOOGLE_CLIENT_ID'; // Set in Render environment variables
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'YOUR_GOOGLE_CLIENT_SECRET'; // Set in Render environment variables
const REDIRECT_URL = `${process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`}/auth/google/callback`;

const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

// Email configuration
const EMAIL_CONFIG = {
  from: 'roasrobo@brandbolt.co',
  to: 'conner@brandbolt.co',
  smtp: {
    host: 'smtp.gmail.com',
    port: 587,
    secure: false,
    auth: {
      user: 'roasrobo@brandbolt.co',
      pass: process.env.EMAIL_APP_PASSWORD || '123Brandbolt$' // Use environment variable in production
    }
  }
};

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'roasrobo-session-secret',
  resave: false,
  saveUninitialized: true,
  cookie: { 
    secure: process.env.NODE_ENV === 'production', 
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Parse JSON bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.session.isAuthenticated) {
    return next();
  }
  res.redirect('/login');
};

// Routes
app.get('/', isAuthenticated, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.get('/login', (req, res) => {
  if (req.session.isAuthenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Google OAuth login
app.get('/auth/google', (req, res) => {
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email']
  });
  res.redirect(url);
});

// Google OAuth callback
app.get('/auth/google/callback', async (req, res) => {
  const code = req.query.code;
  
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    
    const ticket = await oAuth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    
    // Check if user email is authorized (you can restrict access to specific emails)
    const authorizedEmails = (process.env.AUTHORIZED_EMAILS || 'roasrobo@brandbolt.co,conner@brandbolt.co').split(',');
    if (!authorizedEmails.includes(payload.email)) {
      return res.status(403).send('Access denied: User not authorized');
    }
    
    req.session.isAuthenticated = true;
    req.session.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };
    
    res.redirect('/');
  } catch (error) {
    console.error('Authentication error:', error);
    res.status(500).send('Authentication failed');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// API endpoint to get current user data
app.get('/api/user', isAuthenticated, (req, res) => {
  res.json(req.session.user);
});

// Status tracker for the monitoring script
let scriptStatus = {
  isRunning: false,
  lastRun: null,
  lastResult: null,
  controls: {
    belowRoasChop: false,
    zeroRoasKiller: false,
    autoReactivate: false
  },
  campaigns: []
};

// Save status to a file so it persists across server restarts
const saveStatus = () => {
  fs.writeFileSync(STATUS_FILE, JSON.stringify(scriptStatus), 'utf8');
};

// Load status if file exists
try {
  if (fs.existsSync(STATUS_FILE)) {
    scriptStatus = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    console.log('Loaded script status from file:', scriptStatus);
  } else {
    // Initialize the status file
    saveStatus();
    console.log('Created new script status file');
  }
} catch (error) {
  console.error('Error loading script status:', error);
}

// API endpoint to get script status
app.get('/api/status', isAuthenticated, (req, res) => {
  res.json(scriptStatus);
});

// API endpoint to toggle controls
app.post('/api/toggle-control', isAuthenticated, (req, res) => {
  const { control } = req.body;
  
  if (!control || !['belowRoasChop', 'zeroRoasKiller', 'autoReactivate'].includes(control)) {
    return res.status(400).json({ success: false, message: 'Invalid control specified' });
  }
  
  scriptStatus.controls[control] = !scriptStatus.controls[control];
  saveStatus();
  
  res.json({ 
    success: true, 
    control: control,
    enabled: scriptStatus.controls[control] 
  });
});

// API endpoint to run the script manually
app.post('/api/run-script', isAuthenticated, (req, res) => {
  if (scriptStatus.isRunning) {
    return res.status(400).json({ success: false, message: 'Script is already running' });
  }
  
  runMonitoringScript();
  res.json({ success: true, message: 'Script execution initiated' });
});

// API endpoint to find campaigns to scale (ROAS > 1.8)
app.post('/api/find-to-scale', isAuthenticated, (req, res) => {
  findCampaignsToScale(req.session.user.email)
    .then(() => {
      res.json({ success: true, message: 'Campaigns to scale email sent' });
    })
    .catch(error => {
      console.error('Error finding campaigns to scale:', error);
      res.status(500).json({ success: false, message: 'Failed to find campaigns to scale' });
    });
});

// Function to find campaigns with ROAS > 1.8 and send email
async function findCampaignsToScale(userEmail) {
  console.log('Finding campaigns to scale...');
  
  // Extract high-performing campaigns from the monitoring script output
  return new Promise((resolve, reject) => {
    // Run a modified version of the script to just fetch data and not take actions
    exec('node find-campaigns-to-scale.js', (error, stdout, stderr) => {
      if (error) {
        console.error(`Error finding campaigns to scale: ${error.message}`);
        return reject(error);
      }
      
      try {
        // Parse the output to get campaigns
        const campaignsToScale = JSON.parse(stdout.trim());
        console.log(`Found ${campaignsToScale.length} campaigns to scale`);
        
        // Send email with campaigns to scale
        sendCampaignsToScaleEmail(campaignsToScale, userEmail)
          .then(() => {
            // Add to activity log
            if (!scriptStatus.campaigns) {
              scriptStatus.campaigns = [];
            }
            scriptStatus.campaigns = campaignsToScale;
            
            // Add to activity log
            scriptStatus.lastScaleEmail = {
              timestamp: new Date().toISOString(),
              count: campaignsToScale.length
            };
            
            saveStatus();
            resolve();
          })
          .catch(reject);
      } catch (parseError) {
        console.error('Error parsing campaigns output:', parseError);
        reject(parseError);
      }
    });
  });
}

// Function to send email with campaigns to scale
async function sendCampaignsToScaleEmail(campaigns, userEmail) {
  console.log('Sending campaigns to scale email...');
  
  // Create email content
  const emailContent = `
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; margin: 0; padding: 20px; color: #333; }
          .header { background-color: #21779d; padding: 15px; color: white; }
          .content { padding: 15px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .great-roas { color: green; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>High-Performing Campaigns (ROAS > 1.8)</h2>
          <p>Generated by ROASRobo on ${new Date().toLocaleString()}</p>
        </div>
        <div class="content">
          <p>We've identified ${campaigns.length} high-performing campaigns that are candidates for scaling:</p>
          
          <table>
            <tr>
              <th>Account</th>
              <th>Campaign</th>
              <th>ROAS</th>
              <th>Cost</th>
              <th>Revenue</th>
            </tr>
            ${campaigns.map(campaign => `
              <tr>
                <td>${campaign.account}</td>
                <td>${campaign.campaign}</td>
                <td class="great-roas">${campaign.roas}</td>
                <td>$${campaign.cost}</td>
                <td>$${campaign.revenue}</td>
              </tr>
            `).join('')}
          </table>
          
          <p>These campaigns have a ROAS greater than 1.8 and may benefit from increased budgets.</p>
          <p>This is an automated report from your ROASRobo dashboard.</p>
        </div>
      </body>
    </html>
  `;
  
  // Create transporter
  const transporter = nodemailer.createTransport(EMAIL_CONFIG.smtp);
  
  // Send email
  const info = await transporter.sendMail({
    from: EMAIL_CONFIG.from,
    to: userEmail || EMAIL_CONFIG.to,
    subject: 'Campaigns to Scale - ROASRobo Report',
    html: emailContent
  });
  
  console.log('Campaigns to scale email sent:', info.messageId);
  return info;
}

// Function to run the monitoring script
function runMonitoringScript() {
  if (scriptStatus.isRunning) {
    console.log('Script is already running, skipping this execution');
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
// Note: For Render deployment, we'll use the separate cron-service.js for scheduling
// This is kept for local development
if (process.env.ENABLE_CRON === 'true') {
  cron.schedule('5 * * * *', () => {
    console.log('Running scheduled task at 5th minute of the hour');
    
    // Check which controls are enabled and run appropriate tasks
    if (scriptStatus.controls.belowRoasChop || 
        scriptStatus.controls.zeroRoasKiller || 
        scriptStatus.controls.autoReactivate) {
      runMonitoringScript();
    } else {
      console.log('No controls are enabled, skipping scheduled execution');
    }
  });
  console.log('Cron job scheduled to run at 5 minutes past every hour');
}

// Health check endpoint for monitoring
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Using auth file at: ${AUTH_FILE}`);
  console.log(`Using status file at: ${STATUS_FILE}`);
});

module.exports = { app, scriptStatus, runMonitoringScript };
