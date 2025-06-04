const statusEl = document.getElementById("status");
const actionBtn = document.getElementById("actionButton");

let attachedInfo = null; // {id, title} | null

function updateUI() {
  if (attachedInfo) {
    statusEl.textContent = `Attached to: ${attachedInfo.title}`;
    actionBtn.textContent = "Detach";
    actionBtn.dataset.action = "detach";
  } else {
    statusEl.textContent = "Not Attached";
    actionBtn.textContent = "Attach to this Tab";
    actionBtn.dataset.action = "attach";
  }
}

function fetchStatus() {
  chrome.runtime.sendMessage({ type: "GET_ATTACHMENT_STATUS" }, (resp) => {
    attachedInfo = resp?.attachedTabInfo ?? null;
    updateUI();
  });
}

async function attachCurrentTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs[0];
    if (!activeTab) return;
    chrome.runtime.sendMessage(
      { type: "ATTACH_TAB", tabId: activeTab.id, title: activeTab.title },
      (resp) => {
        attachedInfo = resp?.attachedTabInfo ?? null;
        updateUI();
      }
    );
  });
}

function detachTab() {
  chrome.runtime.sendMessage({ type: "DETACH_TAB" }, (resp) => {
    attachedInfo = null;
    updateUI();
  });
}

actionBtn.addEventListener("click", () => {
  const action = actionBtn.dataset.action;
  if (action === "attach") {
    attachCurrentTab();
  } else if (action === "detach") {
    detachTab();
  }
});

// init
fetchStatus(); 