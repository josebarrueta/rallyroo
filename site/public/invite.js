export function invitationDeepLink(hash) {
  const code = new URLSearchParams(hash.replace(/^#/, "")).get("code")?.trim();
  if (!code) return null;
  const url = new URL("rallyroo://invite");
  url.searchParams.set("code", code);
  return url.toString();
}

if (typeof document !== "undefined") {
  const openButton = document.querySelector("#open-rallyroo");
  const status = document.querySelector("#invitation-status");
  const deepLink = invitationDeepLink(globalThis.location.hash);

  if (openButton instanceof HTMLAnchorElement && deepLink) {
    openButton.href = deepLink;
    openButton.removeAttribute("aria-disabled");
  } else {
    openButton?.remove();
    if (status) {
      status.textContent = "This invitation link is incomplete. Ask the inviting parent to resend it.";
    }
  }
}
