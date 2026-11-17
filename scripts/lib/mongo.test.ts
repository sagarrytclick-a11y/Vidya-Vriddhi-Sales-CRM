import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLocalMongo } from "./mongo";

describe("parseLocalMongo", () => {
  it("normalizes localhost to 127.0.0.1", () => {
    assert.deepEqual(parseLocalMongo("mongodb://localhost:27017/sales_crm"), {
      host: "127.0.0.1",
      port: 27017,
      database: "sales_crm",
    });
  });

  it("keeps the configured host, port, and database", () => {
    assert.deepEqual(
      parseLocalMongo("mongodb://127.0.0.1:27018/crm_dev"),
      {
        host: "127.0.0.1",
        port: 27018,
        database: "crm_dev",
      },
    );
  });

  it("supports IPv6 and 0.0.0.0", () => {
    assert.equal(parseLocalMongo("mongodb://[::1]:27017/crm")?.host, "::1");
    assert.equal(parseLocalMongo("mongodb://0.0.0.0:27017/crm")?.host, "127.0.0.1");
  });

  it("defaults the port and database", () => {
    assert.deepEqual(parseLocalMongo("mongodb://localhost"), {
      host: "127.0.0.1",
      port: 27017,
      database: "sales_crm",
    });
  });

  it("ignores remote, SRV, and non-MongoDB URIs", () => {
    assert.equal(
      parseLocalMongo("mongodb://user:pass@cluster0.mongodb.net/crm"),
      null,
    );
    assert.equal(
      parseLocalMongo("mongodb+srv://user:pass@cluster0.mongodb.net/crm"),
      null,
    );
    assert.equal(parseLocalMongo("postgres://localhost/crm"), null);
    assert.equal(parseLocalMongo("not a uri"), null);
    assert.equal(parseLocalMongo(undefined), null);
  });
});
