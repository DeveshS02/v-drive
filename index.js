import dotenv from 'dotenv';
import { google } from 'googleapis';
import express from 'express';
import fs from 'fs';
import compression from 'compression';
import cron from 'node-cron';
import cors from 'cors';

dotenv.config();

const app = express();

app.use(compression());
app.use(cors());

const PORT = process.env.PORT || 3000;

// Validate environment variables
const requiredEnvVars = ['CLIENT_ID', 'CLIENT_SECRET'];
requiredEnvVars.forEach((envVar) => {
  if (!process.env[envVar]) {
    console.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
});

const accounts = [
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT1, //KB04-70
    credentialsPath: 'creds_account1.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT2, //KB04-71
    credentialsPath: 'creds_account2.json'        
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT3, //KB04-72
    credentialsPath: 'creds_account3.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT4, //KB04-73
    credentialsPath: 'creds_account4.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT5, //PH03-70
    credentialsPath: 'creds_account5.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT6, //PH04-70
    credentialsPath: 'creds_account6.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT7, //PH04-71
    credentialsPath: 'creds_account7.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT8, //VN04-70
    credentialsPath: 'creds_account8.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT9, //VN04-71
    credentialsPath: 'creds_account9.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT10, //PR00-70
    credentialsPath: 'creds_account10.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT11, //BB04-70
    credentialsPath: 'creds_account11.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT12, //BB04-71
    credentialsPath: 'creds_account12.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT13, //PL00-70 OBH00-70
    credentialsPath: 'creds_account13.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT14, //PL00-71 OBH00-71
    credentialsPath: 'creds_account14.json'
  },
  {
    redirectUri: process.env.REDIRECT_URI_ACCOUNT15, //PH02-70
    credentialsPath: 'creds_account15.json'
  },
];

const oauth2Clients = accounts.map((account) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.CLIENT_ID,
    process.env.CLIENT_SECRET,
    account.redirectUri
  );

  try {
    const creds = fs.readFileSync(account.credentialsPath);
    oauth2Client.setCredentials(JSON.parse(creds));
  } catch (e) {
    console.error(`No creds found for account: ${account.credentialsPath}`);
  }

  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      saveCredentials(tokens, account.credentialsPath);
    }
  });

  return oauth2Client;
});

function saveCredentials(tokens, credentialsPath) {
  fs.writeFileSync(credentialsPath, JSON.stringify(tokens));
}

function getOauthClient(index) {
  if (index < 0 || index >= oauth2Clients.length) {
    throw new Error('Invalid account index');
  }
  return oauth2Clients[index];
}

app.get('/', (req, res) => {
  res.send('Hello World!');
})
// Route to initiate OAuth2 flow for each account
accounts.forEach((account, index) => {
  app.get(`/auth/google/${index}`, (req, res) => {
    const oauth2Client = getOauthClient(index);
    const url = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/userinfo.profile'
      ],
    });
    res.redirect(url);
  });

  // OAuth2 callback route for each account
  app.get(`/google/redirect/${index}`, async (req, res) => {
    const { code } = req.query;
    try {
      const oauth2Client = getOauthClient(index);
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      saveCredentials(tokens, accounts[index].credentialsPath);
      res.send('Success');
    } catch (error) {
      console.error(`Error getting tokens for account ${index}:`, error);
      res.status(500).send('Error during authentication');
    }
  });

  // Route to list files for each account
  app.get(`/drive/files/${index}`, async (req, res) => {
    try {
      const oauth2Client = getOauthClient(index);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const response = await drive.files.list({
        pageSize: 1000,
        fields: 'nextPageToken, files(id, name)',
      });

      const files = response.data.files;
      if (files.length) {
        res.json(files);
      } else {
        res.send('No files found.');
      }
    } catch (error) {
      console.error('Error fetching files:', error);
      res.status(500).send('Error fetching files');
    }
  });

  // Route to display the first image file for each account
  app.get('/drive/files/first/:index', async (req, res) => {
    const index = req.params.index;
    const n = parseInt(req.query.n) || 10;  // Number of images to be sent
    const t = parseInt(req.query.t) || 10;  // Time difference between images
    const unit = req.query.unit || 'minutes';  // Time unit: 'minutes' or 'hours'
    
    const timeMultiplier = unit === 'hours' ? 60 : 1;  // Convert hours to minutes if needed
    const timeDifference = t * timeMultiplier;  // Calculate the time difference in minutes
  
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders(); // flush the headers to establish SSE with the client
    
    try {
      const oauth2Client = getOauthClient(index);
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      let filteredFiles = [];
      let nextPageToken = null;
      let lastTimestamp = null;
      let firstImageTimestamp = null;
  
      while (filteredFiles.length < n) {
        const fileListResponse = await drive.files.list({
          pageSize: 1000,
          fields: 'nextPageToken, files(id, name, mimeType, size, parents)',
          q: "mimeType='image/jpeg'",
          pageToken: nextPageToken
        });
  
        const files = fileListResponse.data.files;
        if (!files.length) break;
  
        for (const file of files) {
          if (file.size > 500000) {
            const fileName = file.name;
            const timestampMatch = fileName.match(/img(\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2})\.jpg/);
            if (timestampMatch) {
              const timestamp = timestampMatch[1];
              const fileDate = new Date(`${timestamp.slice(0, 10)}T${timestamp.slice(11).replace(/-/g, ':')}Z`);
  
              if (!firstImageTimestamp) {
                firstImageTimestamp = fileDate.getTime();
              }
  
              // Check if the image is within 7 days of the first image
              const sevenDaysInMillis = 7 * 24 * 60 * 60 * 1000;
              if (fileDate.getTime() > firstImageTimestamp + sevenDaysInMillis) {
                res.end();  // End the SSE stream
                return;
              }
  
              if (!lastTimestamp || (fileDate.getTime() <= lastTimestamp - timeDifference * 60000)) {
                filteredFiles.push(file);
                console.log(file.name + " "+ file.parents)
                lastTimestamp = fileDate.getTime();
  
                const fileId = file.id;
                const fileGetResponse = await drive.files.get(
                  { fileId, alt: 'media' },
                  { responseType: 'arraybuffer' }
                );
  
                const fileData = Buffer.from(fileGetResponse.data, 'binary').toString('base64');
                const response = {
                  fileName: file.name,
                  fileData: `data:${file.mimeType};base64,${fileData}`
                };
  
                // Send the image data as a SSE event
                res.write(`data: ${JSON.stringify(response)}\n\n`);
                res.flush();
  
                if (filteredFiles.length >= n) {
                  break;
                }
              }
            }
          }
        }
  
        if (filteredFiles.length >= n) {
          break;
        }
  
        nextPageToken = fileListResponse.data.nextPageToken;
        if (!nextPageToken) {
          break;  // No more files to fetch
        }
      }
  
      res.end();  // End the SSE stream
    } catch (error) {
      console.error('Error fetching files:', error);
      res.write(`event: error\ndata: ${JSON.stringify({ message: 'Error fetching files' })}\n\n`);
      res.end();  // End the SSE stream
    }
  });       
});

// Schedule task to refresh credentials for each account every hour
cron.schedule('0 * * * *', () => {
  console.log('Running scheduled task to refresh credentials...');
  oauth2Clients.forEach((client) => {
    client.refreshAccessToken();
  });
});

app.listen(PORT, () => {
  console.log(`App running on port ${PORT}`);
});
