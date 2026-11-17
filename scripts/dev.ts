import type { ChildProcess } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { isPortOpen, waitForPort } from "./lib/mongo";
import { runPreflight } from "./lib/preflight";
import { killTree, resolveBin, spawnNode } from "./lib/process";

/**
 * Development launcher.
 *
 * `npm run dev` normally just starts Next.js. When MONGODB_URI points at
 * localhost and nothing is listening yet, this launcher also starts the local
 * development MongoDB (`scripts/dev-db.ts`) so a fresh checkout works with a
 * single command. Remote/cluster URIs are left untouched.
 *
 * Before anything is spawned, the environment is validated (Node version, env
 * file, required variables) so misconfiguration is explained up front.
 *
 * Use `npm run dev:next` to start Next.js without these checks.
 */

loadEnvConfig(process.cwd());

const children: ChildProcess[] = [];
let shuttingDown = false;

function stopChildren(signal: NodeJS.Signals = "SIGTERM") {
  for (const child of children.splice(0).reverse()) {
    killTree(child, signal);
  }
}

function shutdown(code: number) {
  if (shuttingDown) return;
  shuttingDown = true;
  stopChildren();
  process.exit(code);
}

async function main() {
  const preflight = await runPreflight();

  for (const warning of preflight.warnings) {
    console.warn(`Warning: ${warning}`);
  }

  if (!preflight.ok) {
    console.error("\nCannot start the development server:\n");
    for (const error of preflight.errors) console.error(`  - ${error}`);
    console.error(
      "\nRun `npm run setup` to create the environment file, then try again.\n",
    );
    process.exit(1);
  }

  const local = preflight.database.local;

  if (local && !(await isPortOpen(local.host, local.port))) {
    console.log(
      `\nMongoDB is not running on ${local.host}:${local.port}. Starting the local dev database…\n`,
    );

    const database = spawnNode(resolveBin("tsx"), ["scripts/dev-db.ts"], {
      ...process.env,
      DEV_DB_PORT: String(local.port),
      DEV_DB_NAME: local.database,
    });

    children.push(database);
    database.once("exit", (code) => {
      if (!shuttingDown && code !== 0) {
        console.error("The local MongoDB process stopped unexpectedly.");
        shutdown(code ?? 1);
      }
    });

    const ready = await waitForPort(local.host, local.port);

    if (!ready) {
      console.error(
        `MongoDB did not start on ${local.host}:${local.port}. Run \`npm run db\` manually to see the error.`,
      );
      shutdown(1);
    }
  }

  const next = spawnNode(resolveBin("next"), [
    "dev",
    ...process.argv.slice(2),
  ]);

  children.push(next);

  next.once("exit", (code, signal) => {
    shutdown(code ?? (signal ? 1 : 0));
  });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => shutdown(0));
}

process.once("exit", () => stopChildren());

main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : "Failed to start the dev server.",
  );
  shutdown(1);
});
