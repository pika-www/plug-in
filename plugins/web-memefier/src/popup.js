"use strict";

const elements = {
  statusText: document.getElementById("statusText"),
  toggleButton: document.getElementById("toggleButton"),
  rerollButton: document.getElementById("rerollButton"),
  restoreButton: document.getElementById("restoreButton"),
  imagesToggle: document.getElementById("imagesToggle"),
  textToggle: document.getElementById("textToggle"),
  hint: document.getElementById("hint")
};

let currentState = {
  enabled: false,
  images: true,
  text: true,
  seed: Date.now()
};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();

  const response = await sendToActiveTab({ type: "GET_STATE" });
  if (response.ok) {
    currentState = response.state;
    render();
    return;
  }

  showUnavailable(response.error);
}

function bindEvents() {
  elements.toggleButton.addEventListener("click", async () => {
    const response = await sendToActiveTab({
      type: "SET_STATE",
      patch: { enabled: !currentState.enabled }
    });
    applyResponse(response);
  });

  elements.rerollButton.addEventListener("click", async () => {
    const response = await sendToActiveTab({ type: "REROLL" });
    applyResponse(response);
  });

  elements.restoreButton.addEventListener("click", async () => {
    const response = await sendToActiveTab({ type: "RESTORE" });
    applyResponse(response);
  });

  elements.imagesToggle.addEventListener("change", updateOptions);
  elements.textToggle.addEventListener("change", updateOptions);
}

async function updateOptions() {
  const response = await sendToActiveTab({
    type: "SET_STATE",
    patch: {
      enabled: true,
      images: elements.imagesToggle.checked,
      text: elements.textToggle.checked
    }
  });
  applyResponse(response);
}

function applyResponse(response) {
  if (!response.ok) {
    showUnavailable(response.error);
    return;
  }

  currentState = response.state;
  render();
}

function render() {
  elements.imagesToggle.checked = currentState.images;
  elements.textToggle.checked = currentState.text;
  elements.toggleButton.textContent = currentState.enabled ? "关闭梗化" : "开启梗化";
  elements.statusText.textContent = currentState.enabled ? "当前页面已抽象化" : "当前页面保持原样";
  elements.rerollButton.disabled = !currentState.enabled || !currentState.images;
  elements.restoreButton.disabled = !currentState.enabled;
  elements.hint.textContent = currentState.enabled
    ? "新增内容会自动梗化，重复点击不会叠加污染。"
    : "点击开启后，只改当前网页的显示效果。";
}

function showUnavailable(error) {
  elements.statusText.textContent = "这个页面暂时不能梗化";
  elements.toggleButton.disabled = true;
  elements.rerollButton.disabled = true;
  elements.restoreButton.disabled = true;
  elements.imagesToggle.disabled = true;
  elements.textToggle.disabled = true;
  elements.hint.textContent = normalizeError(error);
}

function normalizeError(error) {
  if (!error) {
    return "请在普通 http/https 网页中使用。";
  }

  if (String(error).includes("Receiving end does not exist")) {
    return "请刷新当前网页后再试，或在普通 http/https 网页中使用。";
  }

  return String(error);
}

async function sendToActiveTab(payload) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    return { ok: false, error: "没有找到当前标签页。" };
  }

  try {
    return await chrome.tabs.sendMessage(tab.id, {
      source: "web-memefier-popup",
      ...payload
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Receiving end does not exist")) {
      return { ok: false, error: message };
    }

    const injected = await injectContentScript(tab.id);
    if (!injected.ok) {
      return injected;
    }

    try {
      return await chrome.tabs.sendMessage(tab.id, {
        source: "web-memefier-popup",
        ...payload
      });
    } catch (retryError) {
      return {
        ok: false,
        error: retryError instanceof Error ? retryError.message : String(retryError)
      };
    }
  }
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/content.js"]
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
