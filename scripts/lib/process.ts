import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

/**
 * Cross-platform process helpers for the scripts in this folder.
 *
 * The `node_modules/.bin` shims cannot be spawned directly on Windows (they
 * are extensionless shell scripts there, so `spawn` fails with ENOENT), so we
 * resolve the real JavaScript entry point of a package's `bin` and run it with
 * the current Node binary instead.
 */

const root = process.cwd();
const requireFromRoot = createRequire(path.join(root, "package.json"));

interface PackageManifest {
  bin?: string | Record<string, string>;
}

/** Absolute path to the JavaScript file behind a dependency's `bin` entry. */
export function resolveBin(packageName: string, binName?: string): string {
  const packageJsonPath = requireFromRoot.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ) as PackageManifest;

  const name = binName ?? packageName.split("/").pop() ?? packageName;
  const bin = manifest.bin;

  const entry = typeof bin === "string" ? bin : bin?.[name];

  if (!entry) {
    throw new Error(
      `\`${packageName}\` does not expose a \`${name}\` binary. Reinstall dependencies with \`npm install\`.`,
    );
  }

  return path.resolve(path.dirname(packageJsonPath), entry);
}

/** Spawn a Node script with inherited stdio, using the current Node binary. */
export function spawnNode(
  entry: string,
  args: string[] = [],
  env: NodeJS.ProcessEnv = process.env,
): ChildProcess {
  return spawn(process.execPath, [entry, ...args], {
    stdio: "inherit",
    env,
  });
}

/**
 * Terminate a child process and everything it started.
 *
 * `child.kill()` only signals the direct child; on Windows the dev database
 * and Next.js run as grandchildren, so the whole tree has to be killed or
 * `mongod`/`next-server` processes are left listening after Ctrl+C.
 */
export function killTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (!child.pid) return;

  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true,
    });
    return;
  }

  child.kill(signal);
}
