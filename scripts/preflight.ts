import { loadEnvConfig } from "@next/env";
import { runPreflight } from "./lib/preflight";

/**
 * Environment check: `npm run preflight`.
 *
 * Verifies the Node version, env files, required variables, and (when
 * MONGODB_URI points at localhost) whether MongoDB is reachable. `npm run dev`
 * runs the same checks automatically.
 */

loadEnvConfig(process.cwd());

async function main() {
  const result = await runPreflight();

  console.log("Preflight checks\n");
  console.log(
    `  [${result.node.ok ? "ok" : "!!"}] Node.js v${result.node.version} (requires ${result.node.required}+)`,
  );

  console.log(
    `  [${result.envFiles.length > 0 ? "ok" : "!!"}] Env files: ${
      result.envFiles.length > 0 ? result.envFiles.join(", ") : "none"
    }`,
  );

  if (result.database.local) {
    const { host, port, database } = result.database.local;

    if (result.database.reachable === null) {
      console.log(`  [--] MongoDB ${host}:${port}/${database} (not checked)`);
    } else {
      console.log(
        `  [${result.database.reachable ? "ok" : "--"}] MongoDB ${host}:${port}/${database} ${
          result.database.reachable
            ? "reachable"
            : "not running yet (`npm run dev` will start it)"
        }`,
      );
    }
  } else {
    console.log("  [--] MongoDB: remote/cluster URI (connectivity not checked)");
  }

  if (result.warnings.length > 0) {
    console.log("\nWarnings:");
    for (const warning of result.warnings) console.log(`  - ${warning}`);
  }

  if (result.errors.length > 0) {
    console.error("\nProblems:");
    for (const error of result.errors) console.error(`  - ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("\nEverything looks good.");
}

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Preflight checks failed.",
  );
  process.exitCode = 1;
});
