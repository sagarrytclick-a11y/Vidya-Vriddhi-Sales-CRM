import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { ENV_FILES, findEnvFiles, withEnvValues } from "./lib/env";
import { runPreflight } from "./lib/preflight";

/**
 * First-run setup: `npm run setup`.
 *
 * Creates `.env.local` from `.env.example` with generated secrets when no env
 * file exists yet, then validates the result. Safe to re-run: an existing env
 * file is never overwritten.
 */

const root = process.cwd();
const target = path.join(root, ".env.local");

function generateSecrets() {
  return {
    JWT_SECRET: crypto.randomBytes(36).toString("base64url"),
    LEAD_API_KEY: crypto.randomBytes(24).toString("hex"),
    SUPER_ADMIN_PASSWORD: crypto.randomBytes(12).toString("base64url"),
  };
}

function createEnvFile(): boolean {
  if (findEnvFiles(root).length > 0) return false;

  const templatePath = path.join(root, ".env.example");

  if (!fs.existsSync(templatePath)) {
    throw new Error(
      `.env.example is missing, so .env.local cannot be generated. Create ${target} manually.`,
    );
  }

  const secrets = generateSecrets();
  const content = withEnvValues(fs.readFileSync(templatePath, "utf8"), secrets);

  fs.writeFileSync(target, content, { flag: "wx" });

  console.log(`Created ${ENV_FILES[0]} with generated secrets:\n`);
  console.log(`  SUPER_ADMIN_USERNAME=owner`);
  console.log(`  SUPER_ADMIN_PASSWORD=${secrets.SUPER_ADMIN_PASSWORD}\n`);
  console.log(
    "Keep these in the file and change them any time. The super admin account is\n" +
      "created (or repaired) automatically when you sign in.\n",
  );

  return true;
}

async function main() {
  const created = createEnvFile();

  if (!created) {
    console.log(
      `Using the existing environment (${findEnvFiles(root).join(", ")}); not touching it.`,
    );
  }

  loadEnvConfig(root);

  const result = await runPreflight();

  if (result.warnings.length > 0) {
    console.log("Warnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }

  if (!result.ok) {
    console.error("\nSetup is incomplete:\n");
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nSetup complete. Next steps:");
  console.log("  1. npm run dev    (starts the app and the local database)");
  console.log("  2. Open http://localhost:3000 and sign in as the super admin.");
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Setup failed.",
  );
  process.exitCode = 1;
});
