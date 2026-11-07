import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = path => readFile(new URL("../" + path, import.meta.url), "utf8");

test("admin login retains real role selection, TOTP and bootstrap while removing decorative footer", async () => {
  const html = await read("web/admin.html");
  assert.match(html, /id="adminLoginForm"/);
  assert.match(html, /id="adminEmail"/);
  assert.match(html, /id="adminPassword"/);
  assert.match(html, /data-role-choice="MASTER"/);
  assert.match(html, /data-role-choice="SUBADMIN"/);
  for (const id of ["adminTotpForm", "totpSetupInfo", "totpSecretText", "totpCode", "totpBack", "loginFeedback", "showAdminSetup", "bootstrapPanel", "bootstrapForm", "recoverForm"]) {
    assert.ok(html.includes('id="' + id + '"'), "Keep admin authentication element: " + id);
  }
  assert.doesNotMatch(html, /class="portal-subtitle"/);
  assert.doesNotMatch(html, /class="portal-foot"/);
  assert.equal((html.match(/data-admin-page=/g) || []).length, 10, "Retain all ten admin modules");
  assert.match(html, /src="\/admin\.mjs"/);
});

test("admin is served only at the admin domain, without frontend routing changes", async () => {
  const gateway = await read("src/http-api.mjs");
  assert.match(gateway, /hostname==="admin\.nuvexapro\.com"/);
  assert.match(gateway, /adminLanding&&\(url\.pathname==="\/"\|\|url\.pathname==="\/index\.html"\)/);
  assert.match(gateway, /"\/admin-cn-v3\.css"/);
  assert.match(gateway, /"cache-control":"no-store"/);
});
