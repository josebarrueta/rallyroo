import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const publicDirectory = join(root, "public");
const requiredPages = ["index.html", "privacy.html", "terms.html", "support.html", "invite.html", "404.html"];

for (const page of requiredPages) {
  const html = await readFile(join(publicDirectory, page), "utf8");
  assert.match(html, /<html lang="en">/, `${page} must declare its language`);
  assert.doesNotMatch(html, /https?:\/\/(?!api\.rallyroo\.dev)/i, `${page} must remain tracker-free`);
  if (page !== "invite.html") {
    assert.doesNotMatch(html, /<script\b/i, `${page} must remain script-free`);
  }

  for (const [, href] of html.matchAll(/href="([^"]+)"/g)) {
    if (href.startsWith("mailto:") || href.startsWith("https://api.rallyroo.dev")) continue;
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
