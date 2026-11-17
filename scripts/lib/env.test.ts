import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateEnv, withEnvValues } from "./env";

const validEnv: Record<string, string | undefined> = {
  MONGODB_URI: "mongodb://localhost:27017/sales_crm",
  JWT_SECRET: "s".repeat(40),
  SUPER_ADMIN_USERNAME: "owner",
  SUPER_ADMIN_PASSWORD: "super-secret-1",
};

function invalidEnv(
  overrides: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return { ...validEnv, ...overrides };
}

describe("validateEnv", () => {
  it("accepts a complete configuration", () => {
    const report = validateEnv(validEnv);

    assert.deepEqual(report.errors, []);
  });

  it("requires MONGODB_URI", () => {
    const report = validateEnv(invalidEnv({ MONGODB_URI: undefined }));

    assert.equal(report.errors.length, 1);
    assert.equal(report.errors[0]?.variable, "MONGODB_URI");
  });

  it("rejects a malformed MONGODB_URI", () => {
    const report = validateEnv(invalidEnv({ MONGODB_URI: "postgres://db" }));

    assert.ok(
      report.errors.some((issue) => issue.variable === "MONGODB_URI"),
    );
  });

  it("accepts mongodb+srv cluster URIs", () => {
    const report = validateEnv(
      invalidEnv({ MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net/db" }),
    );

    assert.deepEqual(report.errors, []);
  });

  it("accepts multi-host replica set URIs", () => {
    const report = validateEnv(
      invalidEnv({
        MONGODB_URI:
          "mongodb://user:pass@a.example.com:27017,b.example.com:27017,c.example.com:27017/?ssl=true&replicaSet=rs0",
      }),
    );

    assert.deepEqual(report.errors, []);
  });

  it("rejects short and placeholder secrets", () => {
    assert.ok(
      validateEnv(invalidEnv({ JWT_SECRET: "too-short" })).errors.some(
        (issue) => issue.variable === "JWT_SECRET",
      ),
    );

    assert.ok(
      validateEnv(
        invalidEnv({ JWT_SECRET: "replace-with-a-long-random-secret" }),
      ).errors.some((issue) => issue.variable === "JWT_SECRET"),
    );
  });

  it("rejects short and placeholder super admin passwords", () => {
    assert.ok(
      validateEnv(invalidEnv({ SUPER_ADMIN_PASSWORD: "short" })).errors.some(
        (issue) => issue.variable === "SUPER_ADMIN_PASSWORD",
      ),
    );

    assert.ok(
      validateEnv(
        invalidEnv({ SUPER_ADMIN_PASSWORD: "change-me-now" }),
      ).errors.some((issue) => issue.variable === "SUPER_ADMIN_PASSWORD"),
    );
  });

  it("allows a username derived from the email or name", () => {
    const report = validateEnv(
      invalidEnv({
        SUPER_ADMIN_USERNAME: undefined,
        SUPER_ADMIN_EMAIL: "owner@example.com",
      }),
    );

    assert.deepEqual(report.errors, []);
  });

  it("requires a username when there is nothing to derive one from", () => {
    const report = validateEnv(
      invalidEnv({
        SUPER_ADMIN_USERNAME: undefined,
        SUPER_ADMIN_EMAIL: undefined,
        SUPER_ADMIN_NAME: undefined,
      }),
    );

    assert.ok(
      report.errors.some((issue) => issue.variable === "SUPER_ADMIN_USERNAME"),
    );
  });

  it("warns when the lead intake key is missing", () => {
    const report = validateEnv(validEnv);

    assert.deepEqual(report.errors, []);
    assert.ok(
      report.warnings.some((issue) => issue.variable === "LEAD_API_KEY"),
    );
  });

  it("rejects single-character usernames", () => {
    const report = validateEnv(invalidEnv({ SUPER_ADMIN_USERNAME: "o" }));

    assert.ok(
      report.errors.some((issue) => issue.variable === "SUPER_ADMIN_USERNAME"),
    );
  });
});

describe("withEnvValues", () => {
  const template = [
    "# Secrets",
    "JWT_SECRET=replace-with-a-long-random-secret",
    "LEAD_API_KEY=replace-with-a-long-random-key",
    "",
  ].join("\n");

  it("replaces existing keys and keeps comments", () => {
    const result = withEnvValues(template, { JWT_SECRET: "generated" });

    assert.match(result, /^# Secrets$/m);
    assert.match(result, /^JWT_SECRET=generated$/m);
    assert.match(result, /^LEAD_API_KEY=replace-with-a-long-random-key$/m);
  });

  it("appends keys that are not in the template", () => {
    const result = withEnvValues(template, { SUPER_ADMIN_PASSWORD: "pw" });

    assert.match(result, /^SUPER_ADMIN_PASSWORD=pw$/m);
  });

  it("does not interpret `$` sequences in values", () => {
    const result = withEnvValues(template, { JWT_SECRET: "abc$&def" });

    assert.match(result, /^JWT_SECRET=abc\$&def$/m);
  });
});
