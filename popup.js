"use strict";

const defaults = {
  enabled: true,
  dismissTips: true,
  aggressiveMode: true
};

const enabled = document.getElementById("enabled");
const dismissTips = document.getElementById("dismissTips");
const aggressiveMode = document.getElementById("aggressiveMode");
const scanNow = document.getElementById("scanNow");
const status = document.getElementById("status");
const counts = document.getElementById("counts");
const statusTime = document.getElementById("statusTime");
const statusHeading = document.getElementById("status-heading");
const liveBadge = document.getElementById("liveBadge");
const liveBadgeText = document.getElementById("liveBadgeText");

function formatRelativeTime(timestamp) {
  if (!timestamp) return "Just now";

  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));

  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setLiveState(isActive) {
  liveBadge.classList.toggle("inactive", !isActive);
  liveBadgeText.textContent = isActive ? "Running" : "Paused";
  statusHeading.textContent = isActive ? "Watching" : "Paused";
}

async function activeTab() {
  const [tab] = await browser.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function updateDiagnostics() {
  const saved = await browser.storage.local.get({
    ...defaults,
    diagnosticStatus: null
  });

  setLiveState(Boolean(saved.enabled));

  const data = saved.diagnosticStatus;

  if (!data) {
    status.textContent = "Open Kimi and reload the tab to connect.";
    counts.textContent = "No page data";
    statusTime.textContent = "Not connected";
    return;
  }

  status.textContent = data.lastAction || "Waiting for a paused task.";

  const continueCount = data.continueFound || 0;
  const dismissCount = data.dismissFound || 0;

  if (continueCount || dismissCount) {
    counts.textContent =
      `${continueCount} resume / ${dismissCount} notice`;
  } else {
    counts.textContent = "No action needed";
  }

  statusTime.textContent = formatRelativeTime(
    data.lastActionAt || data.lastScan
  );
}

async function load() {
  const saved = await browser.storage.local.get(defaults);

  enabled.checked = saved.enabled;
  dismissTips.checked = saved.dismissTips;
  aggressiveMode.checked = saved.aggressiveMode;

  setLiveState(Boolean(saved.enabled));
  await updateDiagnostics();
}

async function save() {
  await browser.storage.local.set({
    enabled: enabled.checked,
    dismissTips: dismissTips.checked,
    aggressiveMode: aggressiveMode.checked
  });

  setLiveState(enabled.checked);

  status.textContent = enabled.checked
    ? "Settings saved. The Kimi tab is being watched."
    : "Automatic actions are disabled.";

  counts.textContent = enabled.checked
    ? "Ready"
    : "No actions";

  statusTime.textContent = "Just now";
}

enabled.addEventListener("change", save);
dismissTips.addEventListener("change", save);
aggressiveMode.addEventListener("change", save);

scanNow.addEventListener("click", async () => {
  scanNow.disabled = true;
  statusHeading.textContent = "Checking";
  status.textContent = "Looking for task and queue controls.";
  counts.textContent = "Scanning page";
  statusTime.textContent = "Now";

  try {
    const tab = await activeTab();

    if (!tab?.id) {
      throw new Error("No active tab");
    }

    await browser.tabs.sendMessage(tab.id, {
      type: "scan-now"
    });

    window.setTimeout(updateDiagnostics, 250);
  } catch {
    statusHeading.textContent = "Offline";
    status.textContent = "Reload the Kimi tab, then run the check again.";
    counts.textContent = "Tab not connected";
    statusTime.textContent = "Action needed";
  } finally {
    window.setTimeout(() => {
      scanNow.disabled = false;
      setLiveState(enabled.checked);
    }, 500);
  }
});

load().catch(() => {
  statusHeading.textContent = "Error";
  status.textContent = "The extension settings could not be loaded.";
  counts.textContent = "Restart Firefox";
  statusTime.textContent = "Unavailable";
});

window.setInterval(updateDiagnostics, 1000);
