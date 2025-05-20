# ROASRobo - Campaign Performance Monitor

ROASRobo is an automated solution for monitoring and managing Facebook/Looker Studio campaigns based on ROAS performance. It features a mobile-friendly dashboard to control automation from anywhere.

## Features

- **ROAS-Based Campaign Management**: Automatically pauses campaigns with poor performance (ROAS < 1.3 or zero ROAS with high spend ≥ $160)
- **High-Performer Detection**: Identifies campaigns with excellent ROAS (> 1.8) as candidates for scaling
- **Automated Reporting**: Email notifications with detailed campaign performance reports
- **Mobile Dashboard**: Remote control of automation features from any device
- **Google Authentication**: Secure access to the dashboard and monitoring system

## Deployment Guide for Render

This guide will help you deploy ROASRobo to [Render](https://render.com) for a stable, managed hosting solution.

### Prerequisites

1. A [GitHub](https://github.com) account
2. A [Render](https://render.com) account (free to sign up)
3. Google OAuth credentials (Client ID and Client Secret)
4. Gmail account with an app password for sending notifications

### Step 1: Fork/Upload Repository to GitHub

1. Create a new repository on GitHub
2. Upload all project files to this repository
3. Make sure all the files in this project are included

### Step 2: Sign Up for Render

1. Go to [render.com](https://render.com)
2. Sign up with your GitHub account for simplest integration

### Step 3: Create a New Web Service on Render

1. From your Render dashboard, click "New" and select "Blueprint"
2. Connect to your GitHub repository
3. Render will detect the `render.yaml` file and suggest configurations
4. Click "Apply Blueprint"

### Step 4: Configure Environment Variables

After Render creates your services, you'll need to set up environment variables:

1. Click on your web service
2. Go to the "Environment" tab
3. Add the following environment variables:
   - `CLIENT_ID`: Your Google OAuth client ID
   - `CLIENT_SECRET`: Your Google OAuth client secret
   - `EMAIL_APP_PASSWORD`: Your Gmail app password for sending notifications
   - `GOOGLE_EMAIL`: Your Google account email for authentication
   - `GOOGLE_PASSWORD`: Your Google account password (optional, for automated auth)
   - `NOTIFICATION_EMAIL`: Email to receive monitoring reports
   - `SESSION_SECRET`: A random string for session encryption
   - `NODE_ENV`: Set to `production`
   - `AUTHORIZED_EMAILS`: Comma-separated list of emails that can access the dashboard

### Step 5: Set Up Google OAuth

1. Go to the [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Go to "APIs & Services" > "Credentials"
4. Create an OAuth client ID for a Web application
5. Add your Render URL as an authorized redirect URI (`https://your-app-name.onrender.com/auth/google/callback`)

### Step 6: Initial Authentication

After deployment:

1. Visit your Render web service URL
2. You'll be prompted to log in with Google
3. Authenticate using your Google account
4. This creates the necessary authentication state for the monitoring script

### Step 7: Using the Dashboard

Once deployed, you can access your ROASRobo dashboard from any device:

1. On mobile, visit your Render URL and add it to your home screen for app-like access
2. Enable the controls you want active (Below 1.3 Chop, Zero ROAS Killer, Auto Reactivate)
3. Use the "Run Monitor Now" button to test your setup
4. The dashboard will display the current status and recent activity

## Troubleshooting

If you encounter issues:

1. Check the Render logs for both web service and worker
2. Verify your Google OAuth credentials are correct
3. Ensure your Gmail app password is valid
4. Check that the authentication state files are being created in the persistent disk

## Maintenance

- Render automatically rebuilds your app when you push changes to GitHub
- Authentication tokens sometimes expire - use the dashboard to re-authenticate if needed
- Check email reports for any execution errors

## Security Notes

- Store your Google credentials securely in Render environment variables
- Only authorized email addresses should be allowed to access the dashboard
- Use a strong, unique password for your Google account
