import test from "node:test";
import assert from "node:assert/strict";
import { parsePagination } from "../src/utils/pagination.js";

test("parsePagination returns no pagination by default", () => {
  const parsed = parsePagination({});
  assert.equal(parsed.hasPagination, false);
  assert.equal(parsed.limit, null);
});

test("parsePagination caps and validates limit/offset", () => {
  const parsed = parsePagination({ limit: "999", offset: "10" }, { maxLimit: 100 });
  assert.equal(parsed.hasPagination, true);
  assert.equal(parsed.limit, 100);
  assert.equal(parsed.offset, 10);
});

test("parsePagination rejects invalid values", () => {
  const badLimit = parsePagination({ limit: "0" });
  const badOffset = parsePagination({ limit: "10", offset: "-1" });
  assert.equal(badLimit.error, "invalid_limit");
  assert.equal(badOffset.error, "invalid_offset");
});
