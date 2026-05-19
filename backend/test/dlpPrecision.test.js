import test from "node:test";
import assert from "node:assert/strict";

test("DLP does not mask finance metric columns on phone-like numeric values", async () => {
  const dlp = await import(`../src/utils/dlp.js?t=${Date.now()}_dlp_precision_finance`);
  const sheets = {
    "P&L": [
      { Revenue: "1234567890", "Operating Expense": "8000000", Notes: "ok" },
      { Revenue: "9876543210", "Operating Expense": "7000000", Notes: "ok" },
      { Revenue: "5555555555", "Operating Expense": "6500000", Notes: "ok" },
      { Revenue: "4444444444", "Operating Expense": "6400000", Notes: "ok" },
      { Revenue: "3333333333", "Operating Expense": "6300000", Notes: "ok" },
    ],
  };
  const scan = dlp.scanRowsForDlp(sheets, { enabled: true, checkPhone: true, checkCreditCard: true });
  const maskedCols = scan.maskedColumns?.["P&L"] || [];
  assert.equal(maskedCols.includes("Revenue"), false);
  assert.equal(maskedCols.includes("Operating Expense"), false);
});

test("DLP still flags true phone/email signals in non-financial text columns", async () => {
  const dlp = await import(`../src/utils/dlp.js?t=${Date.now()}_dlp_precision_text`);
  const sheets = {
    Contacts: [
      { Name: "Alice", Contact: "+1 (415) 555-1212", Email: "alice@example.com" },
      { Name: "Bob", Contact: "+1 (212) 555-9999", Email: "bob@example.com" },
    ],
  };
  const scan = dlp.scanRowsForDlp(sheets, { enabled: true, checkPhone: true, checkEmail: true });
  const maskedCols = scan.maskedColumns?.Contacts || [];
  assert.equal(maskedCols.includes("Contact"), true);
  assert.equal(maskedCols.includes("Email"), true);
});

