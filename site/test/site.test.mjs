import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = join(root, "public");
const developerDocsURL = "https://github.com/josebarrueta/rallyroo/blob/main/docs/README.md";
const requiredPages = ["index.html", "docs.html", "privacy.html", "terms.html", "support.html", "invite.html", "404.html"];

for (const page of requiredPages) {
  const html = await readFile(join(publicDirectory, page), "utf8");
  assert.match(html, /<html lang="en">/, `${page} must declare its language`);
  assert.match(html, /href="\/docs"/, `${page} must link to the docs`);
  for (const [url] of html.matchAll(/https?:\/\/[^"<>\s]+/g)) {
    assert.ok(
      url === "https://api.rallyroo.dev" || url.startsWith("https://api.rallyroo.dev/")
        || url === developerDocsURL,
      `${page} must remain tracker-free: unexpected external URL`
    );
  }
  if (page !== "invite.html") {
    assert.doesNotMatch(html, /<script\b/i, `${page} must remain script-free`);
  }

  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (href === developerDocsURL) {
      assert.ok(html.includes(`href="${developerDocsURL}" rel="noopener noreferrer"`));
      continue;
    }
    if (href.startsWith("mailto:") || href === "https://api.rallyroo.dev"
      || href.startsWith("https://api.rallyroo.dev/")) continue;
    const path = href.split(/[?#]/, 1)[0];
    if (path === "/") {
      await stat(join(publicDirectory, "index.html"));
    } else if (path === "/styles.css") {
      await stat(join(publicDirectory, "styles.css"));
    } else if (path.startsWith("/")) {
      await stat(join(publicDirectory, `${path.slice(1)}.html`));
    }
  }
}

const homepage = await readFile(join(publicDirectory, "index.html"), "utf8");
assert.match(homepage, /href="\/docs"/);
assert.match(homepage, /class="skip-link"/);
for (const topic of [
  /Schedule and Reminders/,
  /Connected calendars/,
  /Alerts and Day Brief/,
  /Travel and saved places/,
  /Create with AI/,
  /Household and Commuter/,
]) {
  assert.match(homepage, topic, `homepage must summarize ${topic}`);
}

const documentation = await readFile(join(publicDirectory, "docs.html"), "utf8");
assert.match(documentation, /<h1>Rallyroo Docs<\/h1>/);
assert.match(documentation, /class="skip-link"/);
assert.match(documentation, /Beta and build freshness/);
for (const id of [
  "overview",
  "getting-started",
  "schedule",
  "reminders",
  "connected-calendars",
  "alerts-day-brief",
  "travel",
  "create-with-ai",
  "household",
  "commuter",
  "privacy-controls",
  "limitations",
  "help",
]) {
  assert.match(documentation, new RegExp(`id="${id}"`), `docs must include #${id}`);
}
for (const phrase of [
  /occurrence actions/i,
  /Home weather/,
  /Timeline/,
  /Share extension/,
  /on-device/,
  /Expenses/,
  /account deletion/i,
  /Focus settings/,
  /TestFlight/,
]) {
  assert.match(documentation, phrase, `docs must cover ${phrase}`);
}
assert.match(documentation, /rel="noopener noreferrer"/);

// Provider guidance is maintained product content, not an optional paragraph.
assert.match(documentation, /href="#connected-calendars"/);
for (const id of ["connected-calendars", "calendar-google", "calendar-teamsnap", "calendar-outlook", "calendar-other", "calendar-troubleshooting"]) {
  assert.match(documentation, new RegExp(`id="${id}"`));
}
for (const phrase of [/Secret address in iCal format/, /Sync Calendar \/ Export/, /Publish a calendar/, /read-only/, /expired/i, /one-time/, /private/, /anyone with the link/, /administrator/]) {
  assert.match(documentation, phrase);
}

const inventory = await readFile(join(root, "RELEASED_FEATURES.md"), "utf8");
assert.match(inventory, /Last review.*v0\.11\.19/);
assert.match(inventory, /Release review procedure/);
for (const feature of ["Events", "Reminders", "Day Brief", "Travel plans", "Expenses", "Commuter", "account deletion"]) {
  assert.match(inventory, new RegExp(`- \\[x\\].*${feature}`, "i"), `inventory must track ${feature}`);
}

const styles = await readFile(join(publicDirectory, "styles.css"), "utf8");
assert.match(styles, /:focus-visible/);
assert.match(styles, /prefers-reduced-motion:\s*reduce/);
assert.match(styles, /@media\s*\(max-width:\s*760px\)/);

const invitation = await readFile(join(publicDirectory, "invite.html"), "utf8");
assert.match(invitation, /<script type="module" src="\/invite\.js"><\/script>/);
assert.match(invitation, /id="open-rallyroo"/);

const { invitationDeepLink } = await import("../public/invite.js");
assert.equal(
  invitationDeepLink("#code=opaque%20invitation"),
  "rallyroo://invite?code=opaque+invitation"
);
assert.equal(invitationDeepLink("#code="), null);
assert.equal(invitationDeepLink(""), null);

const privacy = await readFile(join(publicDirectory, "privacy.html"), "utf8");
assert.match(privacy, /support@rallyroo\.dev/);
assert.match(privacy, /account deletion/i);

const terms = await readFile(join(publicDirectory, "terms.html"), "utf8");
assert.match(terms, /California/);
assert.match(terms, /TestFlight/);

const headers = await readFile(join(publicDirectory, "_headers"), "utf8");
assert.match(headers, /Content-Security-Policy:/);
assert.match(headers, /script-src 'self'/);
assert.match(headers, /frame-ancestors 'none'/);
assert.match(headers, /Permissions-Policy:/);

const wrangler = JSON.parse(await readFile(join(root, "wrangler.json"), "utf8"));
assert.equal(wrangler.workers_dev, false);
assert.equal(wrangler.preview_urls, false);
assert.equal(wrangler.assets.directory, "./public");
assert.equal(wrangler.assets.not_found_handling, "404-page");
assert.deepEqual(
  wrangler.routes.map((route) => route.pattern).sort(),
  ["rallyroo.dev", "www.rallyroo.dev"]
);
assert.ok(wrangler.routes.every((route) => route.custom_domain === true));

console.log("Rallyroo site contract passed");
