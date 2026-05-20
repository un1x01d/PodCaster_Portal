import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const userController = fs.readFileSync(new URL('../src/controllers/userController.js', import.meta.url), 'utf8');
const groupRoutes = fs.readFileSync(new URL('../src/controllers/user/groupRoutes.js', import.meta.url), 'utf8');
const storageController = fs.readFileSync(new URL('../src/controllers/storageController.js', import.meta.url), 'utf8');
const sheetController = fs.readFileSync(new URL('../src/controllers/sheetController.js', import.meta.url), 'utf8');
const uploadHandlers = fs.readFileSync(new URL('../src/controllers/sheet/uploadHandlers.js', import.meta.url), 'utf8');

test('controllers avoid leaking raw details.message in key public error responses', () => {
  assert.doesNotMatch(userController, /details:\s*\{\s*message:/);
  assert.doesNotMatch(groupRoutes, /details:\s*\{\s*message:/);
  assert.doesNotMatch(storageController, /storage_import_failed",\s*details/);
  assert.doesNotMatch(sheetController, /sheet_data_fetch_failed",\s*details/);
  assert.doesNotMatch(uploadHandlers, /upload_failed",\s*details/);
});

test('forbidden responses use stable forbidden code in hardened controllers', () => {
  assert.match(userController, /error:\s*"forbidden"/);
  assert.match(groupRoutes, /error:\s*"forbidden"/);
  assert.match(storageController, /error:\s*"forbidden"/);
});
