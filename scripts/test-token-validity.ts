import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

async function testToken() {
  console.log("Testing refresh token...");
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.GOOGLE_ADS_CLIENT_ID,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET,
      refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    });
    console.log("✅ Success! Token is valid.");
    console.log("Access Token starts with:", response.data.access_token.substring(0, 10));
  } catch (error: any) {
    console.error("❌ Failed to refresh token:", error.response?.data || error.message);
  }
}

testToken();
