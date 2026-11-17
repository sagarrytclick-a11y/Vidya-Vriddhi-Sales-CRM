import { findEnvFiles, validateEnv } from "./env";
import {
  isPortOpen,
  parseLocalMongo,
  type LocalMongo,
} from "./mongo";

export const MIN_NODE_MAJOR = 22;

export interface PreflightResult {
  ok: boolean;
  node: { version: string; required: number; ok: boolean };
  envFiles: string[];
  database: { local: LocalMongo | null; reachable: boolean | null };
  errors: string[];
  warnings: string[];
}

export interface PreflightOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
  /** Skip the TCP probe (used by tests and `--no-db` style callers). */
  checkDatabase?: boolean;
}

/**
 * Everything that has to be true before the app can run: a supported Node
 * version, an env file, valid required variables, and (for local MongoDB) a
 * reachable database port. Startup code calls this so misconfiguration is
 * reported in plain language instead of as a stack trace on the first request.
 */
export async function runPreflight({
  root = process.cwd(),
  env = process.env,
  checkDatabase = true,
}: PreflightOptions = {}): Promise<PreflightResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  const version = process.versions.node;
  const major = Number(version.split(".")[0]) || 0;
  const nodeOk = major >= MIN_NODE_MAJOR;

  if (!nodeOk) {
    errors.push(
      `Node.js ${MIN_NODE_MAJOR}+ is required (found v${version}).`,
    );
  }

  const envFiles = findEnvFiles(root);

  if (envFiles.length === 0) {
    errors.push(
      "No .env file found. Run `npm run setup` to create .env.local from .env.example.",
    );
  }

  const envReport = validateEnv(env);

  for (const issue of envReport.errors) {
    errors.push(`${issue.variable} ${issue.message}`);
  }

  for (const issue of envReport.warnings) {
    warnings.push(`${issue.variable} ${issue.message}`);
  }

  const local = parseLocalMongo(env.MONGODB_URI);
  let reachable: boolean | null = null;

  if (local && checkDatabase) {
    reachable = await isPortOpen(local.host, local.port);
  }

  return {
    ok: errors.length === 0,
    node: { version, required: MIN_NODE_MAJOR, ok: nodeOk },
    envFiles,
    database: { local, reachable },
    errors,
    warnings,
  };
}
