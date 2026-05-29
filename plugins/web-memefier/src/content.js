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
  const ORIGINAL_STYLE = `${EXT}-original-style`;
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
  let pendingOverlayUpdate = false;
  const originalTextByNode = new WeakMap();
  const processedTextNodes = new Set();
  const processedMediaElements = new Set();
  const overlaysByElement = new Map();

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

        if (mutation.type === "childList" && hasRelevantAddedNodes(mutation.addedNodes)) {
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
      attributeFilter: ["src", "srcset", "sizes", "poster", "alt", "title", "aria-label"],
      childList: true,
      characterData: true,
      subtree: true
    });

    window.addEventListener("scroll", scheduleOverlayUpdate, true);
    window.addEventListener("resize", scheduleOverlayUpdate, { passive: true });
  }

  function disableObserver() {
    if (!observer) {
      return;
    }

    observer.disconnect();
    observer = null;
    window.removeEventListener("scroll", scheduleOverlayUpdate, true);
    window.removeEventListener("resize", scheduleOverlayUpdate);
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
    const mediaNodes = collectElements(root, "img, video[poster]");
    for (const element of mediaNodes) {
      if (shouldSkipElement(element)) {
        continue;
      }

      transformVisualMedia(element);
    }

    scheduleOverlayUpdate();
  }

  function transformVisualMedia(element) {
    if (!element.hasAttribute(ORIGINAL_STYLE)) {
      element.setAttribute(ORIGINAL_STYLE, element.getAttribute("style") || "");
    }

    if (!element.hasAttribute(ORIGINAL_SRC)) {
      element.setAttribute(ORIGINAL_SRC, element.getAttribute("src") || "");
    }

    if (!element.hasAttribute(ORIGINAL_SRCSET)) {
      element.setAttribute(ORIGINAL_SRCSET, element.getAttribute("srcset") || "");
    }

    if (!element.hasAttribute(ORIGINAL_SIZES)) {
      element.setAttribute(ORIGINAL_SIZES, element.getAttribute("sizes") || "");
    }

    if (!element.hasAttribute(ORIGINAL_POSTER)) {
      element.setAttribute(ORIGINAL_POSTER, element.getAttribute("poster") || "");
    }

    const meme = getMediaMeme(element);
    element.style.setProperty("--web-memefier-hue", `${meme.hue}deg`);
    element.style.setProperty("--web-memefier-saturate", meme.saturate);
    element.style.setProperty("--web-memefier-contrast", meme.contrast);
    element.classList.add("web-memefier-image");
    setAttributeIfChanged(element, MEME_SRC, String(meme.index));
    element.setAttribute(PROCESSED_MEDIA, "1");
    processedMediaElements.add(element);
    upsertOverlay(element, meme);
  }

  function upsertOverlay(element, meme) {
    const root = getOverlayRoot();
    let overlay = overlaysByElement.get(element);

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "web-memefier-media-overlay";
      overlay.setAttribute("aria-hidden", "true");
      overlaysByElement.set(element, overlay);
      root.append(overlay);
    }

    overlay.textContent = `${meme.emoji} ${meme.caption}`;
    overlay.style.setProperty("--web-memefier-overlay-bg", meme.bg);
    overlay.style.setProperty("--web-memefier-overlay-fg", meme.fg);
    updateOverlayPosition(element, overlay);
  }

  function restoreMedia(root) {
    const mediaNodes = new Set([
      ...Array.from(processedMediaElements).filter((element) => isNodeInsideRoot(element, root)),
      ...collectElements(root, `[${PROCESSED_MEDIA}]`)
    ]);

    for (const element of mediaNodes) {
      restoreOriginalStyle(element);
      element.classList.remove("web-memefier-image");

      element.removeAttribute(PROCESSED_MEDIA);
      element.removeAttribute(MEME_SRC);
      element.removeAttribute(ORIGINAL_SRC);
      element.removeAttribute(ORIGINAL_SRCSET);
      element.removeAttribute(ORIGINAL_SIZES);
      element.removeAttribute(ORIGINAL_POSTER);
      processedMediaElements.delete(element);
      removeOverlay(element);
    }

    if (overlaysByElement.size === 0) {
      document.getElementById(ROOT_ID)?.remove();
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
    return /[\p{L}\p{N}]/u.test(text);
  }

  function abstractText(text) {
    if (!text.trim()) {
      return text;
    }

    const leading = text.match(/^\s*/)?.[0] || "";
    const trailing = text.match(/\s*$/)?.[0] || "";
    const core = text.slice(leading.length, text.length - trailing.length);
    const transformed = abstractCoreText(core);
    return `${leading}${transformed}${trailing}`;
  }

  function abstractCoreText(text) {
    const hasHan = /\p{Script=Han}/u.test(text);
    const hasLatin = /\p{Script=Latin}/u.test(text);
    const suffixes = ["（绷）", " 🤌", "，家人们", "，抽象拉满", "，这很难评", "，尊嘟假嘟"];
    const suffix = suffixes[Math.abs(hash(`${state.seed}:${text}`)) % suffixes.length];

    let transformed = text
      .replace(/的/g, "🉐")
      .replace(/了/g, "辣")
      .replace(/是/g, "系")
      .replace(/我/g, "俺")
      .replace(/你/g, "老铁")
      .replace(/很/g, "尊嘟")
      .replace(/真/g, "顶真")
      .replace(/不/g, "8")
      .replace(/吗/g, "咩")
      .replace(/啊/g, "嗷")
      .replace(/吧/g, "叭")
      .replace(/和/g, "+")
      .replace(/与/g, "+");

    if (hasLatin) {
      transformed = transformed
        .replace(/\bthe\b/gi, "teh")
        .replace(/\bvery\b/gi, "mega")
        .replace(/\bnew\b/gi, "fresh")
        .replace(/\bnews\b/gi, "瓜")
        .replace(/\bupdate\b/gi, "赛博更新");
    }

    if (hasHan) {
      transformed = transformed.replace(/([。！？!?])$/u, `${suffix}$1`);
      if (transformed === text || !/[。！？!?]$/u.test(transformed)) {
        transformed = `${transformed}${suffix}`;
      }
      return transformed;
    }

    if (hasLatin) {
      return `赛博 ${transformed} ${suffix}`.replace(/\s+/g, " ");
    }

    return `${transformed}${suffix}`;
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

  function hasRelevantAddedNodes(nodes) {
    for (const node of nodes) {
      if (node instanceof Element && !isOwnedElement(node)) {
        return true;
      }

      if (node instanceof Text && shouldTransformText(node.nodeValue || "")) {
        return true;
      }
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

  function restoreOriginalStyle(element) {
    if (!element.hasAttribute(ORIGINAL_STYLE)) {
      return;
    }

    const originalStyle = element.getAttribute(ORIGINAL_STYLE) || "";
    if (originalStyle) {
      element.setAttribute("style", originalStyle);
    } else {
      element.removeAttribute("style");
    }
    element.removeAttribute(ORIGINAL_STYLE);
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

  function getMediaMeme(element) {
    const label = getMediaLabel(element);
    const index = stableIndexForElement(element, memeTemplates.length);
    const template = memeTemplates[index];
    const topic = getTopicFromLabel(label);

    return {
      ...template,
      index,
      hue: Math.abs(hash(`${state.seed}:hue:${label}`)) % 42 - 21,
      saturate: String(1.18 + (Math.abs(hash(`${state.seed}:sat:${label}`)) % 34) / 100),
      contrast: String(1.05 + (Math.abs(hash(`${state.seed}:contrast:${label}`)) % 18) / 100),
      caption: `${topic}${getMemeVerdict(label)}`
    };
  }

  function getMediaLabel(element) {
    const rawLabel = [
      element.getAttribute("alt"),
      element.getAttribute("title"),
      element.getAttribute("aria-label"),
      element.getAttribute("src"),
      element.getAttribute("poster"),
      element.currentSrc
    ].filter(Boolean).join(" ");

    return rawLabel || element.outerHTML.slice(0, 160);
  }

  function getTopicFromLabel(label) {
    const normalized = label.toLowerCase();
    if (/avatar|profile|user|face|head|人物|头像|用户/.test(normalized)) {
      return "头像有点东西";
    }
    if (/logo|brand|icon|标志|品牌|图标/.test(normalized)) {
      return "品牌突然抽象";
    }
    if (/banner|hero|cover|背景|封面|横幅/.test(normalized)) {
      return "封面开始整活";
    }
    if (/product|goods|item|商品|产品/.test(normalized)) {
      return "商品图绷不住";
    }
    if (/chart|graph|report|数据|图表|报告/.test(normalized)) {
      return "数据开始发癫";
    }
    return "这图被梗化";
  }

  function getMemeVerdict(label) {
    const verdicts = ["，鉴定为顶真", "，抽象指数拉满", "，家人们细品", "，节目效果来了", "，这合理吗"];
    return verdicts[Math.abs(hash(`${state.seed}:verdict:${label}`)) % verdicts.length];
  }

  function getOverlayRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) {
      return root;
    }

    root = document.createElement("div");
    root.id = ROOT_ID;
    root.setAttribute("aria-hidden", "true");
    document.documentElement.append(root);
    return root;
  }

  function removeOverlay(element) {
    const overlay = overlaysByElement.get(element);
    if (!overlay) {
      return;
    }

    overlay.remove();
    overlaysByElement.delete(element);
  }

  function scheduleOverlayUpdate() {
    if (pendingOverlayUpdate) {
      return;
    }

    pendingOverlayUpdate = true;
    window.requestAnimationFrame(() => {
      pendingOverlayUpdate = false;
      updateAllOverlays();
    });
  }

  function updateAllOverlays() {
    for (const [element, overlay] of overlaysByElement) {
      if (!element.isConnected) {
        overlay.remove();
        overlaysByElement.delete(element);
        processedMediaElements.delete(element);
        continue;
      }

      updateOverlayPosition(element, overlay);
    }
  }

  function updateOverlayPosition(element, overlay) {
    const rect = element.getBoundingClientRect();
    const visible = rect.width >= 36 && rect.height >= 28 && rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

    overlay.hidden = !visible;
    if (!visible) {
      return;
    }

    overlay.style.left = `${Math.max(4, rect.left + 6)}px`;
    overlay.style.top = `${Math.max(4, rect.top + 6)}px`;
    overlay.style.maxWidth = `${Math.max(32, Math.min(rect.width - 12, 240))}px`;
    overlay.style.fontSize = `${Math.max(11, Math.min(15, Math.round(rect.width / 16)))}px`;
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
        filter: saturate(var(--web-memefier-saturate, 1.28)) contrast(var(--web-memefier-contrast, 1.08)) hue-rotate(var(--web-memefier-hue, 0deg)) !important;
      }

      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
      }

      .web-memefier-media-overlay {
        position: fixed;
        display: block;
        box-sizing: border-box;
        padding: 4px 7px;
        border: 1px solid rgba(0, 0, 0, 0.82);
        border-radius: 6px;
        color: var(--web-memefier-overlay-fg, #111);
        background: var(--web-memefier-overlay-bg, #ffdd2d);
        box-shadow: 3px 3px 0 rgba(0, 0, 0, 0.84);
        font-family: Arial, 'Microsoft YaHei', sans-serif;
        font-weight: 800;
        line-height: 1.25;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `;
    document.documentElement.append(style);
  }

  function removeStyle() {
    document.getElementById(STYLE_ID)?.remove();
  }
})();
