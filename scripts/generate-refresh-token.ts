import { OAuth2Client } from 'google-auth-library';
import * as readline from 'readline';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GOOGLE_ADS_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_ADS_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Standard out-of-band URI for manual copy-paste

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Error: Please set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in your .env file or environment.');
  process.exit(1);
}

const oAuth2Client = new OAuth2Client(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: 'https://www.googleapis.com/auth/adwords',
    prompt: 'consent', // Force refresh token
  });

  console.log('Authorize this app by visiting this url:');
  console.log(authUrl);
  console.log('\nAfter authorizing, copy the code provided and paste it here:');

  rl.question('Enter the code: ', async (code) => {
    rl.close();
    try {
      const { tokens } = await oAuth2Client.getToken(code);
      console.log('\nSuccessfully retrieved tokens!');
      console.log('Refresh Token:', tokens.refresh_token);
      console.log('Access Token:', tokens.access_token);
      console.log('\nAdd this to your .env file as GOOGLE_ADS_REFRESH_TOKEN');
    } catch (error: any) {
      console.error('Error retrieving tokens:', error.message);
    }
  });
}

main().catch(console.error);
