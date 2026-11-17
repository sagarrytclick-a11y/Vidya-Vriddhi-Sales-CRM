import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { resolveBin } from "./process";

describe("resolveBin", () => {
  it("resolves the next CLI entry point", () => {
    const entry = resolveBin("next");

    assert.ok(fs.existsSync(entry), `${entry} should exist`);
    assert.equal(fs.statSync(entry).isFile(), true);
  });

  it("resolves the tsx CLI entry point", () => {
    const entry = resolveBin("tsx");

    assert.ok(fs.existsSync(entry), `${entry} should exist`);
    assert.match(entry, /cli\.mjs$/);
  });

  it("throws a helpful error for a binary that does not exist", () => {
    assert.throws(
      () => resolveBin("next", "definitely-not-a-bin"),
      /does not expose a `definitely-not-a-bin` binary/,
    );
  });
});
