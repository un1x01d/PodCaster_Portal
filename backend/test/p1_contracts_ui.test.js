import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const chatController = fs.readFileSync(new URL('../src/controllers/chatController.js', import.meta.url), 'utf8');
const responseMeta = fs.readFileSync(new URL('../src/controllers/chat/responseMeta.js', import.meta.url), 'utf8');
const appShell = fs.readFileSync(new URL('../../frontend/src/AppShell.jsx', import.meta.url), 'utf8');
const dashboardHeader = fs.readFileSync(new URL('../../frontend/src/components/dashboard/DashboardHeader.jsx', import.meta.url), 'utf8');

test('chat responses include audit badge metadata contract', () => {
  assert.match(chatController, /withAuditMeta/);
  assert.match(responseMeta, /audit_badge/);
  assert.match(responseMeta, /assumed_mapping/);
});

test('workspace default view is publish-first for non-admin users', () => {
  assert.match(appShell, /setWorkspaceView\(isFrontendAdminUser\(user\) \? "grid" : "home"\)/);
});

test('trusted report info card includes DLP trust statement', () => {
  assert.match(dashboardHeader, /Secured by TFORN DLP: Zero PII exposed/);
  assert.match(dashboardHeader, /Last sync:/);
});
