const log = (...args) => console.log('[MCP][Popup]', ...args);
const statusEl = document.getElementById("status");
const actionBtn = document.getElementById("actionButton");

let attachedInfo = null; // {id, title} | null

function updateUI() {
  if (attachedInfo) {
    statusEl.textContent = `Attached to: ${attachedInfo.title}`;
    log('UI update: attached', attachedInfo);
    actionBtn.textContent = "Detach";
    actionBtn.dataset.action = "detach";
  } else {
    statusEl.textContent = "Not Attached";
    log('UI update: not attached');
    actionBtn.textContent = "Attach to this Tab";
    actionBtn.dataset.action = "attach";
  }
}

function fetchStatus() {
  chrome.runtime.sendMessage({ type: "GET_ATTACHMENT_STATUS" }, (resp) => {
    log('GET_ATTACHMENT_STATUS resp', resp);
    attachedInfo = resp?.attachedTabInfo ?? null;
    updateUI();
  });
}

async function attachCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    log('Attach flow: tabs', tabs);
    const activeTab = tabs[0];
    if (!activeTab) return;
    chrome.runtime.sendMessage(
      { type: "ATTACH_TAB", tabId: activeTab.id, title: activeTab.title },
      (resp) => {
        log('ATTACH_TAB resp', resp);
        attachedInfo = resp?.attachedTabInfo ?? null;
        updateUI();
      }
    );
  });
}

function detachTab() {
  log('DETACH_TAB click');
  chrome.runtime.sendMessage({ type: "DETACH_TAB" }, (resp) => {
    attachedInfo = null;
    updateUI();
  });
}

actionBtn.addEventListener("click", () => {
  const action = actionBtn.dataset.action;
  log('Action button clicked', action);
  if (action === "attach") {
    attachCurrentTab();
  } else if (action === "detach") {
    detachTab();
  }
});

// init
log('Popup init');
fetchStatus(); 

// Probe button removed per request
