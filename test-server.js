const express = require('express');
const session = require('express-session');
const { OAuth2Client } = require('google-auth-library');
const path = require('path');
const fs = require('fs');
const app = express();

// Basic configuration
const PORT = process.env.PORT || 3000;
const diskMountPath = process.env.RENDER_DISK_MOUNT_PATH || '/data';
const AUTH_FILE = path.join(diskMountPath, 'google-auth-state.json');

// Make sure the data directory exists
if (!fs.existsSync(diskMountPath)) {
  fs.mkdirSync(diskMountPath, { recursive: true });
  console.log(`Created data directory: ${diskMountPath}`);
}

// OAuth configuration
const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URL = 'https://roasrobo-dashboard-eaiq.onrender.com/auth/google/callback';

console.log(`Using OAuth redirect URL: ${REDIRECT_URL}`);
const oAuth2Client = new OAuth2Client(CLIENT_ID, CLIENT_SECRET, REDIRECT_URL);

// Enable trust proxy
app.set('trust proxy', 1);

// Configure session
app.use(session({
  secret: process.env.SESSION_SECRET || 'roasrobo-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: process.env.NODE_ENV === 'production' }
}));

// Parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Debug middleware - log all requests
app.use((req, res, next) => {
  console.log(`[DEBUG] ${req.method} ${req.path}`);
  next();
});

// Simple route to test if server is working
app.get('/test', (req, res) => {
  res.send('Server is working!');
});

// Home route
app.get('/', (req, res) => {
  if (req.session.isAuthenticated) {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  } else {
    res.redirect('/login');
  }
});

// Login route
app.get('/login', (req, res) => {
  if (req.session.isAuthenticated) {
    return res.redirect('/');
  }
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Google OAuth login
app.get('/auth/google', (req, res) => {
  console.log('Starting OAuth flow');
  const url = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/userinfo.profile', 'https://www.googleapis.com/auth/userinfo.email'],
    prompt: 'consent'
  });
  console.log(`Redirecting to Google auth URL: ${url}`);
  res.redirect(url);
});

// FIX: Combine both route handlers to ensure the callback is processed
app.get(['/auth/google/callback', '/auth/google/callback*'], async (req, res) => {
  console.log('OAuth callback received', { 
    path: req.path,
    url: req.url,
    query: req.query,
    code: req.query.code ? 'present' : 'missing'
  });
  
  const code = req.query.code;
  if (!code) {
    console.error('No authorization code in callback');
    return res.status(400).send('No authorization code received. Please try again.');
  }
  
  try {
    console.log('Getting tokens with code');
    const { tokens } = await oAuth2Client.getToken(code);
    console.log('Tokens received successfully');
    
    oAuth2Client.setCredentials(tokens);
    
    const ticket = await oAuth2Client.verifyIdToken({
      idToken: tokens.id_token,
      audience: CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    console.log('User identified:', payload.email);
    
    // Check if user email is authorized
    const authorizedEmails = (process.env.AUTHORIZED_EMAILS || 'roasrobo@brandbolt.co,conner@brandbolt.co').split(',');
    if (!authorizedEmails.includes(payload.email)) {
      console.log('Unauthorized email attempt:', payload.email);
      return res.status(403).send('Access denied: User not authorized');
    }
    
    // Set session
    req.session.isAuthenticated = true;
    req.session.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      picture: payload.picture
    };
    
    console.log('Authentication successful, saving auth data');
    
    // Store tokens
    const authData = {
      tokens,
      user: req.session.user,
      updated: new Date().toISOString()
    };
    
    fs.writeFileSync(AUTH_FILE, JSON.stringify(authData));
    console.log(`Auth data saved to ${AUTH_FILE}`);
    
    // Redirect to dashboard
    return res.redirect('/');
  } catch (error) {
    console.error('Authentication error:', error);
    return res.status(500).send(`
      <html>
        <head><title>Authentication Error</title></head>
        <body>
          <h1>Authentication Failed</h1>
          <p>Error: ${error.message}</p>
          <p><a href="/login">Return to login page</a></p>
          <pre>${error.stack}</pre>
        </body>
      </html>
    `);
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Catch all unhandled routes with proper 404 handler
app.use((req, res) => {
  console.log(`Route not found: ${req.method} ${req.path}`);
  return res.status(404).send(`
    <html>
      <head><title>Page Not Found</title></head>
      <body>
        <h1>Page Not Found</h1>
        <p>The requested path ${req.path} does not exist.</p>
        <p><a href="/">Go to Dashboard</a> or <a href="/login">Go to Login</a></p>
      </body>
    </html>
  `);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Redirect URL: ${REDIRECT_URL}`);
});
