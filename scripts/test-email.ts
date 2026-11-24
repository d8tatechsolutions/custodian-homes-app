import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { sendVerificationEmail } from "@/lib/email";

async function main() {
  const testEmail = process.argv[2] || "test@example.com";
  const testToken = `test-token-${Date.now()}`;

  console.log(`Sending test verification email to: ${testEmail}`);

  const sent = await sendVerificationEmail(testEmail, testToken, "Test User");
  if (!sent) {
    console.error("❌ Email delivery failed. Check the server logs for details.");
    process.exit(1);
  }
  console.log("✅ Email sent successfully (queued by the mail transport).");
}

main();
