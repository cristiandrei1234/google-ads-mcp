import dotenv from 'dotenv';
import config from '../src/config/env';
import { listAccounts } from '../src/tools/listAccounts';
import { runQuery } from '../src/tools/runQuery';
import { listBillingSetups } from '../src/tools/billing';
import { listMerchantCenterLinks } from '../src/tools/merchantLinking';
import logger from '../src/observability/logger';

dotenv.config();

async function main() {
  console.log("=== Starting Integration Test ===\n");
  const userId = process.env.TEST_USER_ID?.trim();

  // 1. Test Auth & List Accounts
  console.log("1. Testing account discovery...");
  if (userId) {
    console.log(`Using dynamic OAuth mode with TEST_USER_ID=${userId}`);
  }
  let customerId: string | null = config.GOOGLE_ADS_LOGIN_CUSTOMER_ID || null;
  
  try {
    const accounts = await listAccounts({ userId });
    console.log(`✅ Success! Found ${accounts.length} accessible accounts.`);
    if (accounts.length > 0) {
      const resourceName = accounts[0];
      console.log(`   Discovery found: ${resourceName}`);
      customerId = resourceName.split('/')[1];
    }
  } catch (error: any) {
    console.warn(`⚠️  Discovery failed: ${error.message}. Falling back to login_customer_id.`);
  }

  if (!customerId) {
      console.error("❌ No Customer ID available (discovery failed and GOOGLE_ADS_LOGIN_CUSTOMER_ID not set).");
      return;
  }
  
  console.log(`Using Customer ID: ${customerId}`);
  
  // Clean ID
  customerId = customerId.replace(/-/g, '');

  // 2. Test Reporting (GAQL)
  console.log("\n2. Testing 'run_gaql_query' (Fetching Campaigns)...");
  try {
    const query = "SELECT campaign.id, campaign.name, campaign.status FROM campaign LIMIT 5";
    const campaigns = await runQuery({ customerId, query, userId });
    console.log(`✅ Success! Retrieved ${campaigns.length} campaigns.`);
    if (campaigns.length > 0 && campaigns[0].campaign) {
      console.log(`   Sample: ${campaigns[0].campaign.name} (${campaigns[0].campaign.status})`);
    }
  } catch (error: any) {
    console.error(`❌ Failed: ${error.message}`);
    console.error(JSON.stringify(error, null, 2));
  }

  // 3. Test Billing
  console.log("\n3. Testing 'list_billing_setups'...");
  try {
    const billing = await listBillingSetups({ customerId, userId });
    console.log(`✅ Success! Retrieved ${billing.length} billing setups.`);
  } catch (error: any) {
    // Billing often requires admin access or specific permissions
    console.warn(`⚠️  Warning (Billing): ${error.message}`);
  }

  // 4. Test Merchant Center Links
  console.log("\n4. Testing 'list_merchant_center_links'...");
  try {
    const links = await listMerchantCenterLinks({ customerId, userId });
    console.log(`✅ Success! Retrieved ${links.length} merchant links.`);
  } catch (error: any) {
    console.warn(`⚠️  Warning (Merchant): ${error.message}`);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
