import { loadEnvConfig } from "@next/env";
import { connectToDatabase } from "../lib/db/connect";
import { GoogleSheetSyncLog } from "../lib/models/GoogleSheetSyncLog";

loadEnvConfig(process.cwd());

async function main() {
  await connectToDatabase();

  const result = await GoogleSheetSyncLog.updateMany(
    { requestId: null },
    { $unset: { requestId: "" } },
  );

  try {
    await GoogleSheetSyncLog.collection.dropIndex("requestId_1");
  } catch {
    // Index may not exist in fresh databases.
  }

  await GoogleSheetSyncLog.syncIndexes();

  console.log(`Unset requestId on ${result.modifiedCount} sync log(s).`);
  console.log("Google Sheets sync indexes are up to date.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
