(() => {
  "use strict";

  if (window.__WEB_MEMEFIER_CONTENT_LOADED__) {
    return;
  }
  window.__WEB_MEMEFIER_CONTENT_LOADED__ = true;

  const EXT = "data-web-memefier";
  const ORIGINAL_TEXT = `${EXT}-original-text`;
  const ORIGINAL_SRC = `${EXT}-original-src`;
  const ORIGINAL_SRCSET = `${EXT}-original-srcset`;
  const ORIGINAL_SIZES = `${EXT}-original-sizes`;
  const ORIGINAL_POSTER = `${EXT}-original-poster`;
  const PROCESSED_TEXT = `${EXT}-text`;
  const PROCESSED_MEDIA = `${EXT}-media`;
  const MEME_SRC = `${EXT}-meme-src`;
  const STYLE_ID = "web-memefier-style";
  const ROOT_ID = "web-memefier-root";

  const textWalkerFilter = {
    acceptNode(node) {
      if (!node.nodeValue || !shouldTransformText(node.nodeValue)) {
        return NodeFilter.FILTER_REJECT;
      }

      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) {
        return NodeFilter.FILTER_REJECT;
      }

      return NodeFilter.FILTER_ACCEPT;
    }
  };

  const defaultState = {
    enabled: false,
    images: true,
    text: true,
    seed: Date.now()
  };

  let state = { ...defaultState };
  let observer = null;
  let pendingFlush = false;
  const originalTextByNode = new WeakMap();
  const processedTextNodes = new Set();
  const processedMediaElements = new Set();

  const memeTemplates = [
    { bg: "#ffdd2d", fg: "#111111", accent: "#ff4d4d", emoji: "🤡", top: "我不到啊", bottom: "但是很有精神" },
    { bg: "#1b1b1f", fg: "#ffffff", accent: "#00e5ff", emoji: "😎", top: "互联网冲浪", bottom: "主打一个抽象" },
    { bg: "#f7f1e3", fg: "#151515", accent: "#ff6b00", emoji: "🫠", top: "这合理吗", bottom: "太合理辣" },
    { bg: "#7c3aed", fg: "#ffffff", accent: "#facc15", emoji: "🧐", top: "严肃内容", bottom: "正在梗化中" },
    { bg: "#ffffff", fg: "#101010", accent: "#ef4444", emoji: "😭", top: "绷不住了", bottom: "家人们谁懂啊" },
    { bg: "#0f766e", fg: "#ffffff", accent: "#f97316", emoji: "🤌", top: "细品", bottom: "这味儿对了" },
    { bg: "#111827", fg: "#f9fafb", accent: "#22c55e", emoji: "🚀", top: "直接起飞", bottom: "一眼顶真" },
    { bg: "#fb7185", fg: "#111827", accent: "#ffffff", emoji: "🥵", top: "有点东西", bottom: "但不多" },
    { bg: "#d9f99d", fg: "#1f2937", accent: "#84cc16", emoji: "🤯", top: "知识增加", bottom: "脑袋空空" },
    { bg: "#f97316", fg: "#111111", accent: "#ffffff", emoji: "😤", top: "问题不大", bottom: "已经抽象" }
  ];

  chrome.storage.local.get(["webMemefierOptions"], (stored) => {
    state = normalizeState({
      ...state,
      ...stored.webMemefierOptions,
      enabled: false,
      seed: Date.now()
    });
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== "web-memefier-popup") {
      return false;
    }

    try {
      if (message.type === "GET_STATE") {
        sendResponse({ ok: true, state: getPublicState() });
        return false;
      }

      if (message.type === "SET_STATE") {
        state = normalizeState({ ...state, ...message.patch });
        persistState();

        if (state.enabled) {
          enableObserver();
          transformDocument();
        } else {
          disableObserver();
          restoreDocument();
        }

        sendResponse({ ok: true, state: getPublicState() });
        return false;
      }

      if (message.type === "REROLL") {
        state = normalizeState({ ...state, enabled: true, seed: Date.now() });
        persistState();
        enableObserver();
        rerollDocument();
        sendResponse({ ok: true, state: getPublicState() });
        return false;
      }

      if (message.type === "RESTORE") {
        state = normalizeState({ ...state, enabled: false });
        persistState();
        disableObserver();
        restoreDocument();
        sendResponse({ ok: true, state: getPublicState() });
        return false;
      }

      sendResponse({ ok: false, error: "UNKNOWN_MESSAGE" });
      return false;
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  });

  function normalizeState(nextState) {
    return {
      enabled: Boolean(nextState?.enabled),
      images: nextState?.images !== false,
      text: nextState?.text !== false,
      seed: Number.isFinite(nextState?.seed) ? nextState.seed : Date.now()
    };
  }

  function getPublicState() {
    return {
      enabled: state.enabled,
      images: state.images,
      text: state.text,
      seed: state.seed
    };
  }

  function persistState() {
    chrome.storage.local.set({
      webMemefierOptions: {
        images: state.images,
        text: state.text
      }
    });
  }

  function enableObserver() {
    injectStyle();

    if (observer) {
      return;
    }

    observer = new MutationObserver((mutations) => {
      if (!state.enabled) {
        return;
      }

      for (const mutation of mutations) {
        if (mutation.target instanceof Element && isOwnedElement(mutation.target)) {
          continue;
        }

        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          scheduleTransform();
          return;
        }

        if (mutation.type === "characterData" && mutation.target instanceof Text) {
          const parent = mutation.target.parentElement;
          if (parent && !shouldSkipElement(parent)) {
            scheduleTransform();
            return;
          }
        }

        if (mutation.type === "attributes" && mutation.target instanceof Element) {
          if (!isOwnedElement(mutation.target)) {
            scheduleTransform();
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["src", "srcset", "sizes", "poster"],
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function disableObserver() {
    if (!observer) {
      return;
    }

    observer.disconnect();
    observer = null;
  }

  function scheduleTransform() {
    if (pendingFlush) {
      return;
    }

    pendingFlush = true;
    window.requestAnimationFrame(() => {
      pendingFlush = false;
      if (state.enabled) {
        transformDocument();
      }
    });
  }

  function transformDocument() {
    if (state.images) {
      transformMedia(document);
    } else {
      restoreMedia(document);
    }

    if (state.text) {
      transformText(document);
    } else {
      restoreText(document);
    }
  }

  function rerollDocument() {
    restoreMedia(document);
    transformDocument();
  }

  function restoreDocument() {
    restoreText(document);
    restoreMedia(document);
    removeStyle();
  }

  function transformMedia(root) {
    const mediaNodes = collectElements(root, "img, picture source, video[poster]");
    for (const element of mediaNodes) {
      if (shouldSkipElement(element)) {
        continue;
      }

      if (element.matches("source")) {
        transformSource(element);
      } else if (element.matches("video[poster]")) {
        transformPoster(element);
      } else if (element.matches("img")) {
        transformImage(element);
      }
    }
  }

  function transformImage(img) {
    if (!img.hasAttribute(ORIGINAL_SRC)) {
      img.setAttribute(ORIGINAL_SRC, img.getAttribute("src") || "");
    }

    if (!img.hasAttribute(ORIGINAL_SRCSET)) {
      img.setAttribute(ORIGINAL_SRCSET, img.getAttribute("srcset") || "");
    }

    if (!img.hasAttribute(ORIGINAL_SIZES)) {
      img.setAttribute(ORIGINAL_SIZES, img.getAttribute("sizes") || "");
    }

    const memeSrc = getMemeSrc(img);
    setAttributeIfChanged(img, "srcset", "");
    setAttributeIfChanged(img, "sizes", "");
    if (img.getAttribute("src") !== memeSrc) {
      img.src = memeSrc;
    }
    setAttributeIfChanged(img, MEME_SRC, memeSrc);
    img.setAttribute(PROCESSED_MEDIA, "1");
    img.classList.add("web-memefier-image");
    processedMediaElements.add(img);
  }

  function transformSource(source) {
    if (!source.hasAttribute(ORIGINAL_SRCSET)) {
      source.setAttribute(ORIGINAL_SRCSET, source.getAttribute("srcset") || "");
    }

    const memeSrc = getMemeSrc(source);
    setAttributeIfChanged(source, "srcset", memeSrc);
    setAttributeIfChanged(source, MEME_SRC, memeSrc);
    source.setAttribute(PROCESSED_MEDIA, "1");
    processedMediaElements.add(source);
  }

  function transformPoster(video) {
    if (!video.hasAttribute(ORIGINAL_POSTER)) {
      video.setAttribute(ORIGINAL_POSTER, video.getAttribute("poster") || "");
    }

    const memeSrc = getMemeSrc(video);
    setAttributeIfChanged(video, "poster", memeSrc);
    setAttributeIfChanged(video, MEME_SRC, memeSrc);
    video.setAttribute(PROCESSED_MEDIA, "1");
    video.classList.add("web-memefier-image");
    processedMediaElements.add(video);
  }

  function restoreMedia(root) {
    const mediaNodes = new Set([
      ...Array.from(processedMediaElements).filter((element) => isNodeInsideRoot(element, root)),
      ...collectElements(root, `[${PROCESSED_MEDIA}]`)
    ]);

    for (const element of mediaNodes) {
      if (element.matches("img")) {
        restoreAttribute(element, "src", ORIGINAL_SRC);
        restoreAttribute(element, "srcset", ORIGINAL_SRCSET);
        restoreAttribute(element, "sizes", ORIGINAL_SIZES);
        element.classList.remove("web-memefier-image");
      } else if (element.matches("source")) {
        restoreAttribute(element, "srcset", ORIGINAL_SRCSET);
      } else if (element.matches("video")) {
        restoreAttribute(element, "poster", ORIGINAL_POSTER);
        element.classList.remove("web-memefier-image");
      }

      element.removeAttribute(PROCESSED_MEDIA);
      element.removeAttribute(MEME_SRC);
      processedMediaElements.delete(element);
    }
  }

  function transformText(root) {
    const textNodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, textWalkerFilter);

    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    for (const node of textNodes) {
      const parent = node.parentElement;
      if (!parent || shouldSkipElement(parent)) {
        continue;
      }

      const currentText = node.nodeValue || "";
      const originalText = originalTextByNode.get(node);
      if (originalText === undefined || abstractText(originalText) !== currentText) {
        originalTextByNode.set(node, currentText);
      }

      const abstracted = abstractText(originalTextByNode.get(node));
      if (node.nodeValue !== abstracted) {
        node.nodeValue = abstracted;
      }
      processedTextNodes.add(node);
      parent.setAttribute(PROCESSED_TEXT, "1");
    }
  }

  function restoreText(root) {
    for (const node of Array.from(processedTextNodes)) {
      if (!isNodeInsideRoot(node, root)) {
        processedTextNodes.delete(node);
        continue;
      }

      const original = originalTextByNode.get(node);
      if (original !== undefined) {
        node.nodeValue = original;
      }
      processedTextNodes.delete(node);
    }

    const textContainers = collectElements(root, `[${PROCESSED_TEXT}]`);
    for (const element of textContainers) {
      element.removeAttribute(PROCESSED_TEXT);
      element.removeAttribute(ORIGINAL_TEXT);
    }
  }

  function shouldTransformText(text) {
    return /[的了]/.test(text);
  }

  function abstractText(text) {
    return text.replace(/的/g, "🉐").replace(/了/g, "辣");
  }

  function collectElements(root, selector) {
    if (root instanceof Document || root instanceof DocumentFragment) {
      return Array.from(root.querySelectorAll(selector));
    }

    if (root instanceof Element) {
      const elements = root.matches(selector) ? [root] : [];
      elements.push(...root.querySelectorAll(selector));
      return elements;
    }

    return [];
  }

  function isNodeInsideRoot(node, root) {
    if (root instanceof Document) {
      return true;
    }

    if (root instanceof DocumentFragment || root instanceof Element) {
      return root.contains(node);
    }

    return false;
  }

  function shouldSkipElement(element) {
    if (isOwnedElement(element)) {
      return true;
    }

    const tagName = element.tagName;
    if (["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE", "PRE", "KBD", "SAMP", "SVG", "CANVAS"].includes(tagName)) {
      return true;
    }

    if (element.isContentEditable) {
      return true;
    }

    if (element.closest(`#${ROOT_ID}, script, style, noscript, textarea, input, select, option, code, pre, kbd, samp, svg, canvas, [contenteditable="true"]`)) {
      return true;
    }

    return false;
  }

  function isOwnedElement(element) {
    return Boolean(element.closest?.(`#${ROOT_ID}, #${STYLE_ID}`));
  }

  function restoreAttribute(element, attribute, backupAttribute) {
    if (!element.hasAttribute(backupAttribute)) {
      return;
    }

    const originalValue = element.getAttribute(backupAttribute) || "";
    if (originalValue) {
      element.setAttribute(attribute, originalValue);
    } else {
      element.removeAttribute(attribute);
    }
    element.removeAttribute(backupAttribute);
  }

  function setAttributeIfChanged(element, attribute, value) {
    if (value) {
      if (element.getAttribute(attribute) !== value) {
        element.setAttribute(attribute, value);
      }
    } else if (element.hasAttribute(attribute)) {
      element.removeAttribute(attribute);
    }
  }

  function getMemeSrc(element) {
    const existing = element.getAttribute(MEME_SRC);
    if (existing) {
      return existing;
    }

    const index = stableIndexForElement(element, memeTemplates.length);
    return getMemeAssetSrc(index) || createMemeDataUrl(memeTemplates[index], index);
  }

  function getMemeAssetSrc(index) {
    if (typeof chrome?.runtime?.getURL !== "function") {
      return "";
    }

    return chrome.runtime.getURL(`assets/memes/meme-${String(index + 1).padStart(2, "0")}.svg`);
  }

  function stableIndexForElement(element, size) {
    const source =
      element.getAttribute(ORIGINAL_SRC) ||
      element.getAttribute(ORIGINAL_SRCSET) ||
      element.getAttribute(ORIGINAL_POSTER) ||
      element.getAttribute("alt") ||
      element.getAttribute("aria-label") ||
      element.outerHTML.slice(0, 160);

    return Math.abs(hash(`${state.seed}:${source}`)) % size;
  }

  function hash(value) {
    let result = 0;
    for (let index = 0; index < value.length; index += 1) {
      result = (result << 5) - result + value.charCodeAt(index);
      result |= 0;
    }
    return result;
  }

  function createMemeDataUrl(template, index) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
        <rect width="640" height="420" rx="28" fill="${template.bg}"/>
        <circle cx="520" cy="86" r="58" fill="${template.accent}" opacity="0.9"/>
        <circle cx="116" cy="333" r="74" fill="${template.accent}" opacity="0.32"/>
        <text x="320" y="126" text-anchor="middle" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="52" font-weight="800" fill="${template.fg}">${escapeSvg(template.top)}</text>
        <text x="320" y="238" text-anchor="middle" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif" font-size="104">${template.emoji}</text>
        <text x="320" y="340" text-anchor="middle" font-family="Arial, 'Microsoft YaHei', sans-serif" font-size="46" font-weight="800" fill="${template.fg}">${escapeSvg(template.bottom)}</text>
        <text x="604" y="390" text-anchor="end" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="${template.fg}" opacity="0.58">#${index + 1}</text>
      </svg>
    `.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  function escapeSvg(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .web-memefier-image {
        object-fit: cover !important;
        background: #111 !important;
      }
    `;
    document.documentElement.append(style);
  }

  function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }
})();
