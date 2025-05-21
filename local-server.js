const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

let scriptStatus = {
  isRunning: false,
  automationEnabled: true,
  lastRun: null,
  lastResult: null,
  controls: {
    belowRoasChop: false,
    zeroRoasKiller: false,
    autoReactivate: false
  }
};

function serveFile(filePath, contentType, res) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
}

function parseBody(req, callback) {
  let body = '';
  req.on('data', chunk => (body += chunk));
  req.on('end', () => {
    if (body) {
      try {
        callback(JSON.parse(body));
      } catch (e) {
        callback({});
      }
    } else {
      callback({});
    }
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (req.method === 'GET') {
    if (pathname === '/' || pathname === '/dashboard.html') {
      return serveFile(path.join(PUBLIC_DIR, 'dashboard.html'), 'text/html', res);
    }
    if (pathname === '/login' || pathname === '/login.html') {
      return serveFile(path.join(PUBLIC_DIR, 'login.html'), 'text/html', res);
    }
    if (pathname === '/dashboard.js') {
      return serveFile(path.join(PUBLIC_DIR, 'dashboard.js'), 'text/javascript', res);
    }
    if (pathname === '/styles.css') {
      return serveFile(path.join(PUBLIC_DIR, 'styles.css'), 'text/css', res);
    }
    if (pathname === '/api/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(scriptStatus));
    }
    if (pathname === '/api/user') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ email: 'test@example.com', name: 'Test User' }));
    }

    const staticFile = path.join(PUBLIC_DIR, pathname);
    if (fs.existsSync(staticFile) && fs.statSync(staticFile).isFile()) {
      const ext = path.extname(staticFile);
      const type = ext === '.js' ? 'text/javascript' :
                   ext === '.css' ? 'text/css' : 'text/plain';
      return serveFile(staticFile, type, res);
    }
  }

  if (req.method === 'POST') {
    if (pathname === '/api/toggle-control') {
      return parseBody(req, body => {
        const { control } = body;
        if (['belowRoasChop', 'zeroRoasKiller', 'autoReactivate'].includes(control)) {
          scriptStatus.controls[control] = !scriptStatus.controls[control];
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, control, enabled: scriptStatus.controls[control] }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false }));
        }
      });
    }

    if (pathname === '/api/toggle-automation') {
      scriptStatus.automationEnabled = !scriptStatus.automationEnabled;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, automationEnabled: scriptStatus.automationEnabled }));
    }

    if (pathname === '/api/run-script') {
      scriptStatus.lastRun = new Date().toISOString();
      scriptStatus.lastResult = { success: true, output: 'Simulated run', timestamp: scriptStatus.lastRun };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, message: 'Script executed' }));
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Local test server running at http://localhost:${PORT}`);
});
