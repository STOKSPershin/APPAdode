/**
 * TopicHunter — Background Service Worker (Manifest V3)
 *
 * Click behavior:
 * - On stock.adobe.com → TOGGLE_PANEL content script panel
 * - On any other site → Open/focus dashboard tab
 */

const DASHBOARD_PATH = "src/pages/dashboard/index.html";

async function openDashboard() {
  const dashboardUrl = chrome.runtime.getURL(DASHBOARD_PATH);
  const existing = await chrome.tabs.query({ url: dashboardUrl });

  if (existing.length > 0 && existing[0].id) {
    await chrome.tabs.update(existing[0].id, { active: true });
    if (existing[0].windowId) {
      await chrome.windows.update(existing[0].windowId, { focused: true });
    }
    await chrome.tabs.reload(existing[0].id);
  } else {
    await chrome.tabs.create({ url: dashboardUrl });
  }
}

// ── Icon click handler ─────────────────────────────────────────────
chrome.action.onClicked.addListener(async (tab) => {
  const url = tab.url || "";

  // On Adobe Stock → toggle the content script panel
  if (url.includes("stock.adobe.com") && tab.id) {
    chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_PANEL" });
    return;
  }

  // On any other site → open dashboard
  await openDashboard();
});

// ── Message router ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "PING":
      sendResponse({ status: "PONG", version: chrome.runtime.getManifest().version });
      return true;

    case "OPEN_DASHBOARD":
      openDashboard().then(() => sendResponse({ status: "OK" }));
      return true;

    default:
      sendResponse({ error: `Unknown message type: ${message.type}` });
      return false;
  }
});

export {};
