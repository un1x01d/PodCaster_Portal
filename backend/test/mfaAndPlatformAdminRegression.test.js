import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const repoRoot = new URL("../../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, repoRoot), "utf8");

test("frontend login flow handles two-factor challenge before setting user", () => {
  const useAuth = read("frontend/src/hooks/useAuth.js");
  const authScreen = read("frontend/src/components/screens/AuthScreen.jsx");
  const appShell = read("frontend/src/AppShell.jsx");

  assert.match(useAuth, /requiresTwoFactor/);
  assert.match(useAuth, /setTwoFactorChallenge/);
  assert.match(useAuth, /\/auth\/2fa\/verify/);
  assert.match(useAuth, /\/auth\/2fa\/sms\/resend/);
  assert.match(authScreen, /Two-factor verification/);
  assert.match(authScreen, /onVerifyTwoFactor/);
  assert.match(appShell, /handleLogin: authHandleLogin/);
  assert.match(appShell, /twoFactorChallenge=\{twoFactorChallenge\}/);
});

test("confirmed backend platform-admin checks use shared helper", () => {
  const authController = read("backend/src/controllers/authController.js");
  const googleController = read("backend/src/controllers/googleController.js");
  const insightController = read("backend/src/controllers/insightController.js");
  const insightHelpers = read("backend/src/controllers/insight/insightAnalyticsHelpers.js");

  assert.match(authController, /import \{ isPlatformAdminUser \}/);
  assert.match(authController, /if \(isPlatformAdminUser\(userRow\)\) return \{\};/);
  assert.match(authController, /if \(isPlatformAdminUser\(existing\)\)/);
  assert.match(googleController, /isPlatformAdminUser\(existing\[0\]\)/);
  assert.match(insightController, /isPlatformAdminUser\(user\) \|\| await hasReportSourceOwnerAccess/);
  assert.match(insightController, /if \(!isPlatformAdminUser\(req\.user\)\) return res\.status\(403\)/);
  assert.match(insightHelpers, /isPlatformAdminUser\(user\) \|\| await hasReportSourceOwnerAccess/);

  for (const source of [authController, googleController, insightController, insightHelpers]) {
    assert.doesNotMatch(source, /role\s*===\s*["']admin["']/);
    assert.doesNotMatch(source, /req\.user\?\.role\s*!==\s*["']admin["']/);
  }
});
