import test from "node:test";
import assert from "node:assert/strict";

import { classifyBusinessDomain } from "../src/services/chat/businessDomainClassifier.js";

test("accounting: gross margin classification", () => {
  const d = classifyBusinessDomain("What is gross margin?");
  assert.equal(d.primary_domain, "accounting");
});

test("finance: current ratio classification", () => {
  const d = classifyBusinessDomain("What is current ratio?");
  assert.equal(d.primary_domain, "finance");
});

test("marketing: best ROAS classification", () => {
  const d = classifyBusinessDomain("Which campaign had the best ROAS?");
  assert.equal(d.primary_domain, "marketing");
});

test("sales: rep revenue classification", () => {
  const d = classifyBusinessDomain("Which sales rep closed the most revenue?");
  assert.equal(d.primary_domain, "sales");
});

test("tax question returns tax-not-enabled action", () => {
  const d = classifyBusinessDomain("How much sales tax do I owe?");
  assert.equal(d.primary_domain, "tax");
  assert.equal(d.safe_next_action, "tax_not_enabled");
});

test("ambiguous revenue drop asks followup", () => {
  const d = classifyBusinessDomain("Why did revenue drop?");
  assert.ok(d.domains.includes("accounting") && d.domains.includes("sales"));
  assert.equal(d.safe_next_action, "ask_followup");
});

test("classifier payload has no raw rows", () => {
  const d = classifyBusinessDomain("What is current ratio?");
  assert.equal(Object.prototype.hasOwnProperty.call(d, "rows"), false);
});
