// DOM Elements
const belowRoasChopSwitch = document.getElementById('belowRoasChopSwitch');
const zeroRoasKillerSwitch = document.getElementById('zeroRoasKillerSwitch');
const autoReactivateSwitch = document.getElementById('autoReactivateSwitch');
const runButton = document.getElementById('runButton');
const findToScaleButton = document.getElementById('findToScaleButton');
const statusBadge = document.getElementById('statusBadge');
const mobileStatusBadge = document.getElementById('mobileStatusBadge');
const statusMessage = document.getElementById('statusMessage');
const lastRun = document.getElementById('lastRun');
const currentState = document.getElementById('currentState');
const nextRun = document.getElementById('nextRun');
const autoRunStatus = document.getElementById('autoRunStatus');
const lastResult = document.getElementById('lastResult');
const totalRuns = document.getElementById('totalRuns');
const activityList = document.getElementById('activityList');
const viewLogs = document.getElementById('viewLogs');
const logContent = document.getElementById('logContent');
const userName = document.getElementById('userName');
const userPicture = document.getElementById('userPicture');

// Modal
let logModal;
if (document.getElementById('logModal')) {
  logModal = new bootstrap.Modal(document.getElementById('logModal'));
}

// Track activity
let runCount = 0;
let activityItems = [];

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Initialize Bootstrap modal if available
  if (document.getElementById('logModal')) {
    logModal = new bootstrap.Modal(document.getElementById('logModal'));
  }
  
  // Load user data
  fetchUserData();
  
  // Load initial status
  fetchStatus();
  
  // Set up refresh interval (every 15 seconds)
  setInterval(fetchStatus, 15000);
  
  // Set up next run time display updater (every minute)
  setInterval(updateNextRunTime, 60000);
  
  // Set up event listeners
  setupEventListeners();
});

function setupEventListeners() {
  // Run button click
  if (runButton) {
    runButton.addEventListener('click', manuallyRunScript);
  }
  
  // Find to Scale button click
  if (findToScaleButton) {
    findToScaleButton.addEventListener('click', findCampaignsToScale);
  }
  
  // Control switches
  if (belowRoasChopSwitch) {
    belowRoasChopSwitch.addEventListener('change', function() {
      toggleControl('belowRoasChop');
    });
  }
  
  if (zeroRoasKillerSwitch) {
    zeroRoasKillerSwitch.addEventListener('change', function() {
      toggleControl('zeroRoasKiller');
    });
  }
  
  if (autoReactivateSwitch) {
    autoReactivateSwitch.addEventListener('change', function() {
      toggleControl('autoReactivate');
    });
  }
  
  // View logs button
  if (viewLogs) {
    viewLogs.addEventListener('click', (e) => {
      e.preventDefault();
      showLogs();
    });
  }
  
  // Add vibration feedback for mobile devices
  if ('vibrate' in navigator) {
    if (runButton) runButton.addEventListener('click', () => navigator.vibrate(50));
    if (findToScaleButton) findToScaleButton.addEventListener('click', () => navigator.vibrate(50));
    if (belowRoasChopSwitch) belowRoasChopSwitch.addEventListener('change', () => navigator.vibrate(30));
    if (zeroRoasKillerSwitch) zeroRoasKillerSwitch.addEventListener('change', () => navigator.vibrate(30));
    if (autoReactivateSwitch) autoReactivateSwitch.addEventListener('change', () => navigator.vibrate(30));
  }
}

async function fetchUserData() {
  try {
    const response = await fetch('/api/user');
    if (response.ok) {
      const user = await response.json();
      if (userName) userName.textContent = user.name;
      if (userPicture) userPicture.src = user.picture || 'https://via.placeholder.com/32';
    }
  } catch (error) {
    console.error('Error fetching user data:', error);
  }
}

async function fetchStatus() {
  try {
    const response = await fetch('/api/status');
    if (response.ok) {
      const status = await response.json();
      updateStatusDisplay(status);
    }
  } catch (error) {
    console.error('Error fetching status:', error);
    setStatusError();
  }
}

function updateStatusDisplay(status) {
  // Update control switches
  if (belowRoasChopSwitch) belowRoasChopSwitch.checked = status.controls?.belowRoasChop || false;
  if (zeroRoasKillerSwitch) zeroRoasKillerSwitch.checked = status.controls?.zeroRoasKiller || false;
  if (autoReactivateSwitch) autoReactivateSwitch.checked = status.controls?.autoReactivate || false;
  
  // Update auto-run status display
  const anyEnabled = status.controls?.belowRoasChop || status.controls?.zeroRoasKiller || status.controls?.autoReactivate;
  if (autoRunStatus) {
    autoRunStatus.textContent = anyEnabled ? 'Enabled' : 'Disabled';
    autoRunStatus.className = 'stat-value ' + (anyEnabled ? 'text-success' : 'text-secondary');
  }
  
  // Update status badge
  if (status.isRunning) {
    if (statusBadge) {
      statusBadge.className = 'badge bg-primary mb-2';
      statusBadge.textContent = 'Running';
    }
    if (mobileStatusBadge) {
      mobileStatusBadge.className = 'badge bg-primary';
      mobileStatusBadge.textContent = 'Running';
    }
    if (statusMessage) statusMessage.textContent = 'The monitoring script is currently executing';
    if (currentState) currentState.textContent = 'Running';
    if (runButton) runButton.disabled = true;
    if (findToScaleButton) findToScaleButton.disabled = true;
  } else {
    if (statusBadge) {
      statusBadge.className = 'badge bg-success mb-2';
      statusBadge.textContent = 'Ready';
    }
    if (mobileStatusBadge) {
      mobileStatusBadge.className = 'badge bg-success';
      mobileStatusBadge.textContent = 'Ready';
    }
    if (statusMessage) statusMessage.textContent = 'The system is ready to run the monitor';
    if (currentState) currentState.textContent = 'Idle';
    if (runButton) runButton.disabled = false;
    if (findToScaleButton) findToScaleButton.disabled = false;
  }
  
  // Update last run time
  if (status.lastRun && lastRun) {
    const lastRunDate = new Date(status.lastRun);
    lastRun.textContent = formatDateTime(lastRunDate);
  } else if (lastRun) {
    lastRun.textContent = 'Never';
  }
  
  // Update next run time
  updateNextRunTime();
  
  // Update last result
  if (status.lastResult && lastResult) {
    const resultDate = new Date(status.lastResult.timestamp);
    lastResult.textContent = status.lastResult.success ? 'Success' : 'Failed';
    lastResult.className = 'stat-value ' + (status.lastResult.success ? 'text-success' : 'text-danger');
    
    // Add to activity list if not already there
    const activityKey = status.lastResult.timestamp;
    if (!activityItems.includes(activityKey)) {
      addActivityItem({
        timestamp: resultDate,
        type: status.lastResult.success ? 'success' : 'error',
        message: status.lastResult.success ? 'Monitor run completed' : 'Monitor run failed',
        details: status.lastResult.success ? 
          `${status.lastResult.output && status.lastResult.output.includes('No changes were needed') ? 'No campaigns needed changes' : 'Updated campaigns with ROAS below 1.3'}` : 
          status.lastResult.error
      });
      activityItems.push(activityKey);
      runCount++;
      if (totalRuns) totalRuns.textContent = runCount;
    }
  }
  
  // Update campaigns to scale email info
  if (status.lastScaleEmail && !activityItems.includes('scale_' + status.lastScaleEmail.timestamp)) {
    const emailDate = new Date(status.lastScaleEmail.timestamp);
    addActivityItem({
      timestamp: emailDate,
      type: 'info',
      message: 'Campaigns to scale sent',
      details: `Found ${status.lastScaleEmail.count} campaigns with ROAS > 1.8`
    });
    activityItems.push('scale_' + status.lastScaleEmail.timestamp);
  }
}

function updateNextRunTime() {
  if (!nextRun) return;
  
  const anyEnabled = belowRoasChopSwitch?.checked || zeroRoasKillerSwitch?.checked || autoReactivateSwitch?.checked;
  
  if (!anyEnabled) {
    nextRun.textContent = 'Auto monitoring disabled';
    return;
  }
  
  const now = new Date();
  const nextRunTime = new Date(now);
  
  // Set to the next hour
  nextRunTime.setHours(now.getHours() + 1);
  nextRunTime.setMinutes(5);
  nextRunTime.setSeconds(0);
  nextRunTime.setMilliseconds(0);
  
  // If we're past the 5-minute mark in this hour, use this hour's 5-minute mark
  if (now.getMinutes() < 5) {
    nextRunTime.setHours(now.getHours());
  }
  
  nextRun.textContent = formatDateTime(nextRunTime);
}

function setStatusError() {
  if (statusBadge) {
    statusBadge.className = 'badge bg-danger mb-2';
    statusBadge.textContent = 'Error';
  }
  if (mobileStatusBadge) {
    mobileStatusBadge.className = 'badge bg-danger';
    mobileStatusBadge.textContent = 'Error';
  }
  if (statusMessage) statusMessage.textContent = 'Could not connect to the server';
}

async function manuallyRunScript() {
  // Disable button to prevent double-clicking
  if (runButton) runButton.disabled = true;
  
  try {
    const response = await fetch('/api/run-script', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      addActivityItem({
        timestamp: new Date(),
        type: 'info',
        message: 'Manual execution triggered',
        details: result.message
      });
      
      // Immediately fetch status to update UI
      fetchStatus();
    } else {
      const error = await response.json();
      addActivityItem({
        timestamp: new Date(),
        type: 'error',
        message: 'Failed to trigger execution',
        details: error.message
      });
      if (runButton) runButton.disabled = false;
    }
  } catch (error) {
    console.error('Error triggering script:', error);
    addActivityItem({
      timestamp: new Date(),
      type: 'error',
      message: 'Connection error',
      details: 'Could not connect to the server'
    });
    if (runButton) runButton.disabled = false;
  }
}

async function findCampaignsToScale() {
  // Disable button to prevent double-clicking
  if (findToScaleButton) findToScaleButton.disabled = true;
  
  try {
    const response = await fetch('/api/find-to-scale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const result = await response.json();
      addActivityItem({
        timestamp: new Date(),
        type: 'info',
        message: 'Campaigns to scale sent',
        details: result.message
      });
      
      // Show success notification
      showNotification('Success', 'Campaigns to scale email has been sent to your inbox');
      
      // Immediately fetch status to update UI
      fetchStatus();
    } else {
      const error = await response.json();
      addActivityItem({
        timestamp: new Date(),
        type: 'error',
        message: 'Failed to find campaigns to scale',
        details: error.message
      });
    }
  } catch (error) {
    console.error('Error finding campaigns to scale:', error);
    addActivityItem({
      timestamp: new Date(),
      type: 'error',
      message: 'Connection error',
      details: 'Could not connect to the server'
    });
  } finally {
    if (findToScaleButton) findToScaleButton.disabled = false;
  }
}

async function toggleControl(control) {
  const controlSwitch = document.getElementById(control + 'Switch');
  if (!controlSwitch) return;
  
  const originalState = controlSwitch.checked;
  
  try {
    const response = await fetch('/api/toggle-control', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ control })
    });
    
    if (response.ok) {
      const result = await response.json();
      
      let controlName = '';
      switch(control) {
        case 'belowRoasChop':
          controlName = 'Below 1.3 Chop';
          break;
        case 'zeroRoasKiller':
          controlName = 'Zero ROAS Killer';
          break;
        case 'autoReactivate':
          controlName = 'Auto Reactivate';
          break;
      }
      
      addActivityItem({
        timestamp: new Date(),
        type: 'info',
        message: `${controlName} ${result.enabled ? 'enabled' : 'disabled'}`,
        details: `Automatic ${controlName.toLowerCase()} is now ${result.enabled ? 'enabled' : 'disabled'}`
      });
      
      // Update next run display
      updateNextRunTime();
    }
  } catch (error) {
    console.error(`Error toggling ${control}:`, error);
    // Revert switch state on error
    controlSwitch.checked = !originalState;
    
    addActivityItem({
      timestamp: new Date(),
      type: 'error',
      message: `Failed to toggle ${control}`,
      details: 'Could not connect to the server'
    });
  }
}

function addActivityItem(activity) {
  if (!activityList) return;
  
  // Clear "No recent activity" message if present
  if (activityList.firstChild && activityList.firstChild.textContent.trim() === 'No recent activity') {
    activityList.innerHTML = '';
  }
  
  // Create activity item
  const item = document.createElement('div');
  item.className = 'list-group-item';
  
  // Icon based on type
  let icon = '';
  switch (activity.type) {
    case 'success':
      icon = '<i class="fas fa-check-circle text-warning me-2"></i>';
      break;
    case 'error':
      icon = '<i class="fas fa-exclamation-circle text-danger me-2"></i>';
      break;
    case 'info':
    default:
      icon = '<i class="fas fa-info-circle text-info me-2"></i>';
      break;
  }
  
  item.innerHTML = `
    <div class="d-flex w-100 justify-content-between">
      <h6 class="mb-1">${icon}${activity.message}</h6>
      <small class="text-muted">${formatTime(activity.timestamp)}</small>
    </div>
    <small>${truncateText(activity.details || '', 60)}</small>
  `;
  
  // Add to beginning of list
  activityList.insertBefore(item, activityList.firstChild);
  
  // Limit to 5 items
  while (activityList.children.length > 5) {
    activityList.removeChild(activityList.lastChild);
  }
}

function showNotification(title, message) {
  // Create notification element
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.innerHTML = `
    <div class="notification-content">
      <div class="notification-title">${title}</div>
      <div class="notification-message">${message}</div>
    </div>
    <button class="notification-close">&times;</button>
  `;
  
  // Add to document
  document.body.appendChild(notification);
  
  // Add close button handler
  notification.querySelector('.notification-close').addEventListener('click', () => {
    notification.classList.add('notification-fade-out');
    setTimeout(() => {
      document.body.removeChild(notification);
    }, 300);
  });
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    if (document.body.contains(notification)) {
      notification.classList.add('notification-fade-out');
      setTimeout(() => {
        if (document.body.contains(notification)) {
          document.body.removeChild(notification);
        }
      }, 300);
    }
  }, 5000);
  
  // Add to DOM
  setTimeout(() => {
    notification.classList.add('notification-visible');
  }, 10);
}

async function showLogs() {
  if (!logModal || !logContent) return;
  
  // Show loading state
  logContent.textContent = 'Loading logs...';
  logModal.show();
  
  try {
    // In a real app, you'd fetch logs from the server
    // For now, we'll use the status information
    const response = await fetch('/api/status');
    if (response.ok) {
      const status = await response.json();
      if (status.lastResult && status.lastResult.output) {
        logContent.textContent = status.lastResult.output;
      } else if (status.lastResult && status.lastResult.error) {
        logContent.textContent = `ERROR: ${status.lastResult.error}`;
      } else {
        logContent.textContent = 'No logs available';
      }
    }
  } catch (error) {
    console.error('Error fetching logs:', error);
    logContent.textContent = 'Failed to load logs: ' + error.message;
  }
}

// Helper functions
function formatDateTime(date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function formatTime(date) {
  return date.toLocaleString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function truncateText(text, maxLength) {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}
