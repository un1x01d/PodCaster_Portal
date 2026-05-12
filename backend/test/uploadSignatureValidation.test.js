import test from "node:test";
import assert from "node:assert/strict";
import { assertUploadSignatureMatchesExtension } from "../src/controllers/sheetController.js";

function zipLikeBuffer() {
  return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x08, 0x00]);
}

function xlsLikeBuffer() {
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
}

test("accepts valid XLSX zip signature", () => {
  assert.doesNotThrow(() => {
    assertUploadSignatureMatchesExtension({
      originalName: "valid.xlsx",
      fileBuffer: zipLikeBuffer(),
    });
  });
});

test("rejects spoofed XLSX non-zip content", () => {
  assert.throws(() => {
    assertUploadSignatureMatchesExtension({
      originalName: "spoofed.xlsx",
      fileBuffer: Buffer.from("name,amount\nalice,10\n", "utf8"),
    });
  }, /unsupported_file_type/);
});

test("accepts valid XLS OLE2 signature", () => {
  assert.doesNotThrow(() => {
    assertUploadSignatureMatchesExtension({
      originalName: "valid.xls",
      fileBuffer: xlsLikeBuffer(),
    });
  });
});

test("rejects spoofed CSV with binary content", () => {
  assert.throws(() => {
    assertUploadSignatureMatchesExtension({
      originalName: "spoofed.csv",
      fileBuffer: Buffer.from([0x00, 0x01, 0x02, 0x03, 0xff, 0xfe]),
    });
  }, /unsupported_file_type/);
});

