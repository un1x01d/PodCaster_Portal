import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sheetController = fs.readFileSync(new URL('../src/controllers/sheetController.js', import.meta.url), 'utf8');
const sheetRoutes = fs.readFileSync(new URL('../src/routes/sheetRoutes.js', import.meta.url), 'utf8');

test('cursor row_index predicate is assembled before ORDER BY in getSheetData', () => {
  const cursorBlock = sheetController.indexOf('if (cursorRaw && !sort_by)');
  const sortBlock = sheetController.indexOf('// Apply sorting');
  assert.ok(cursorBlock > -1, 'cursor block should exist');
  assert.ok(sortBlock > -1, 'sorting block should exist');
  assert.ok(cursorBlock < sortBlock, 'cursor predicate must be appended before ORDER BY');
});

test('sheet accounting-mappings route aliases are consolidated to canonical path only', () => {
  assert.match(sheetRoutes, /router\.get\("\/sheets\/:id\/accounting-mappings"/);
  assert.doesNotMatch(sheetRoutes, /"\/api\/sheets\/:id\/accounting-mappings"/);
});
