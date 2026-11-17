import fs from "node:fs";
import path from "node:path";

export interface EnvIssue {
  variable: string;
  message: string;
}

export interface EnvReport {
  errors: EnvIssue[];
  warnings: EnvIssue[];
}

/** Env files Next.js loads, in priority order. */
export const ENV_FILES = [
  ".env.local",
  ".env.development.local",
  ".env.development",
  ".env",
] as const;

export function findEnvFiles(root: string): string[] {
  return ENV_FILES.filter((file) => fs.existsSync(path.join(root, file)));
}

const PLACEHOLDERS = [
  "replace-with-a-long-random-secret",
  "replace-with-a-long-random-key",
  "change-me-now",
];

/**
 * Replace `KEY=value` lines in a dotenv template, appending keys that are not
 * present yet. Used by `npm run setup` to fill `.env.example` with generated
 * secrets without rewriting the comments around them.
 */
export function withEnvValues(
  template: string,
  values: Record<string, string>,
): string {
  let content = template;

  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^${key}=.*$`, "m");

    content = pattern.test(content)
      ? content.replace(pattern, () => line)
      : `${content.trimEnd()}\n${line}\n`;
  }

  return content;
}

function isPlaceholder(value: string | undefined): boolean {
  return !value || PLACEHOLDERS.includes(value.trim());
}

function sanitizeUsername(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .slice(0, 32);
}

/**
 * Validate the environment the app needs. This mirrors the checks the app
 * itself performs at runtime (`MONGODB_URI`, `JWT_SECRET`, super admin
 * credentials) so failures surface before the dev server starts instead of on
 * the first request.
 */
/** Validate a plain env map (defaults to `process.env` at the call site). */
export function validateEnv(
  env: Record<string, string | undefined>,
): EnvReport {
  const errors: EnvIssue[] = [];
  const warnings: EnvIssue[] = [];

  const uri = env.MONGODB_URI?.trim();

  if (!uri) {
    errors.push({
      variable: "MONGODB_URI",
      message: "is missing. Point it at a MongoDB server or localhost:27017.",
    });
  } else if (!/^mongodb(\+srv)?:\/\/\S+$/.test(uri)) {
    // Atlas/replica-set URIs list several comma-separated hosts, which the
    // WHATWG URL parser rejects, so validate the shape instead of parsing.
    errors.push({
      variable: "MONGODB_URI",
      message:
        "is not a valid MongoDB connection string (expected mongodb:// or mongodb+srv://).",
    });
  }

  const secret = env.JWT_SECRET?.trim();

  if (isPlaceholder(secret)) {
    errors.push({
      variable: "JWT_SECRET",
      message:
        "is missing or still the example value. Use 32+ random characters (openssl rand -base64 32).",
    });
  } else if (secret && secret.length < 32) {
    errors.push({
      variable: "JWT_SECRET",
      message: `is only ${secret.length} characters; use at least 32.`,
    });
  }

  const password = env.SUPER_ADMIN_PASSWORD ?? env.SEED_ADMIN_PASSWORD;

  if (isPlaceholder(password)) {
    errors.push({
      variable: "SUPER_ADMIN_PASSWORD",
      message:
        "is missing or still the example value. Use 8+ characters (quoted if it contains `#`).",
    });
  } else if (password && password.length < 8) {
    errors.push({
      variable: "SUPER_ADMIN_PASSWORD",
      message: `is only ${password.length} characters; use at least 8.`,
    });
  }

  const rawUsername =
    env.SUPER_ADMIN_USERNAME ?? env.SEED_ADMIN_USERNAME ?? "";
  const username = sanitizeUsername(rawUsername);
  const fallback = env.SUPER_ADMIN_EMAIL ?? env.SUPER_ADMIN_NAME;

  if (!username && !fallback) {
    errors.push({
      variable: "SUPER_ADMIN_USERNAME",
      message:
        "is missing. Set a 3–32 character username (or SUPER_ADMIN_EMAIL / SUPER_ADMIN_NAME).",
    });
  } else if (username && username.length < 3) {
    errors.push({
      variable: "SUPER_ADMIN_USERNAME",
      message: "must be at least 3 characters.",
    });
  }

  if (isPlaceholder(env.LEAD_API_KEY)) {
    warnings.push({
      variable: "LEAD_API_KEY",
      message:
        "is not set; the external lead intake endpoint (POST /api/leads/intake) will return 503.",
    });
  }

  const countryCode = env.NEXT_PUBLIC_DEFAULT_COUNTRY_CODE?.trim();
  if (countryCode && !/^\d{1,4}$/.test(countryCode)) {
    warnings.push({
      variable: "NEXT_PUBLIC_DEFAULT_COUNTRY_CODE",
      message: "should be 1–4 digits; imported phone numbers may be prefixed incorrectly.",
    });
  }

  return { errors, warnings };
}
