import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const fixtureUrl = pathToFileURL(resolve("test/fixture.html")).href;
const contentScript = await readFile(resolve("src/content.js"), "utf8");
const chromeExecutable = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let messageListener = null;

const browser = await puppeteer.launch({
  headless: "new",
  executablePath: chromeExecutable,
  args: [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions"
  ]
});

try {
  const page = await browser.newPage();
  await page.exposeFunction("__captureWebMemefierListener", () => {});
  await page.evaluateOnNewDocument(() => {
    window.chrome = {
      storage: {
        local: {
          get(_keys, callback) {
            callback({ webMemefierOptions: { images: true, text: true } });
          },
          set() {}
        }
      },
      runtime: {
        getURL(path) {
          return `chrome-extension://test-extension/${path}`;
        },
        onMessage: {
          addListener(listener) {
            window.__webMemefierMessageListener = listener;
          }
        }
      }
    };
  });
  await page.goto(fixtureUrl, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: contentScript });

  await page.waitForFunction(() => typeof window.__webMemefierMessageListener === "function");
  await page.evaluate(() => {
    window.__webMemefierMessageListener(
      { source: "web-memefier-popup", type: "SET_STATE", patch: { enabled: true, images: true, text: true, seed: 123 } },
      {},
      () => {}
    );
  });
  await page.waitForFunction(() => document.querySelector("#title")?.textContent !== "这是严肃的网页标题了");

  const firstPass = await page.evaluate(() => ({
    title: document.querySelector("#title").textContent,
    mixedHtml: document.querySelector("#mixed").innerHTML,
    plainChinese: document.querySelector("#plainChinese").textContent,
    english: document.querySelector("#english").textContent,
    code: document.querySelector("#code").textContent,
    input: document.querySelector("#input").value,
    imageSrc: document.querySelector("#image").getAttribute("src"),
    imageSrcset: document.querySelector("#image").getAttribute("srcset"),
    imageSizes: document.querySelector("#image").getAttribute("sizes"),
    imageStyle: document.querySelector("#image").getAttribute("style"),
    imageRect: document.querySelector("#image").getBoundingClientRect().toJSON(),
    sourceSrcset: document.querySelector("#source").getAttribute("srcset"),
    poster: document.querySelector("#video").getAttribute("poster"),
    mediaCount: document.querySelectorAll("[data-web-memefier-media]").length,
    overlayCount: document.querySelectorAll(".web-memefier-media-overlay").length
  }));

  assert.match(firstPass.title, /^这系严肃🉐网页标题辣/);
  assert.match(firstPass.mixedHtml, /^正常🉐文字/);
  assert.match(firstPass.mixedHtml, /<strong data-web-memefier-text="1">加粗🉐文字辣/);
  assert.notEqual(firstPass.plainChinese, "欢迎使用插件");
  assert.match(firstPass.plainChinese, /欢迎使用插件/);
  assert.notEqual(firstPass.english, "Breaking news update");
  assert.match(firstPass.english, /赛博/);
  assert.equal(firstPass.code, "代码里的文字不应该变了");
  assert.equal(firstPass.input, "输入框里的文字不应该变了");
  assert.equal(firstPass.imageSrc, "https://example.com/original.png");
  assert.equal(firstPass.imageSrcset, "https://example.com/original@2x.png 2x");
  assert.equal(firstPass.imageSizes, "100vw");
  assert.match(firstPass.imageStyle, /--web-memefier-hue:/);
  assert.equal(Math.round(firstPass.imageRect.width), 164);
  assert.equal(Math.round(firstPass.imageRect.height), 94);
  assert.equal(firstPass.sourceSrcset, "https://example.com/source.webp");
  assert.equal(firstPass.poster, "https://example.com/poster.png");
  assert.equal(firstPass.mediaCount, 3);
  assert.equal(firstPass.overlayCount, 3);

  await page.evaluate(() => {
    window.__webMemefierMessageListener(
      { source: "web-memefier-popup", type: "SET_STATE", patch: { enabled: true, images: true, text: true, seed: 123 } },
      {},
      () => {}
    );
  });
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

  const secondPass = await page.evaluate(() => ({
    title: document.querySelector("#title").textContent,
    mixedHtml: document.querySelector("#mixed").innerHTML,
    mediaCount: document.querySelectorAll("[data-web-memefier-media]").length,
    overlayCount: document.querySelectorAll(".web-memefier-media-overlay").length
  }));

  assert.deepEqual(secondPass, {
    title: firstPass.title,
    mixedHtml: firstPass.mixedHtml,
    mediaCount: firstPass.mediaCount,
    overlayCount: firstPass.overlayCount
  });

  await page.evaluate(() => {
    const container = document.querySelector("#dynamic");
    container.innerHTML = '<p id="newText">新增内容</p><img id="newImage" src="https://example.com/new.png" alt="avatar user">';
  });
  await page.waitForFunction(() => document.querySelector("#newText")?.textContent !== "新增内容");

  const dynamicPass = await page.evaluate(() => ({
    text: document.querySelector("#newText").textContent,
    src: document.querySelector("#newImage").getAttribute("src"),
    overlays: document.querySelectorAll(".web-memefier-media-overlay").length
  }));
  assert.match(dynamicPass.text, /新增内容/);
  assert.notEqual(dynamicPass.text, "新增内容");
  assert.equal(dynamicPass.src, "https://example.com/new.png");
  assert.equal(dynamicPass.overlays, 4);

  await page.evaluate(() => {
    window.__webMemefierMessageListener(
      { source: "web-memefier-popup", type: "RESTORE" },
      {},
      () => {}
    );
  });
  await page.waitForFunction(() => document.querySelector("#title")?.textContent === "这是严肃的网页标题了");

  const restored = await page.evaluate(() => ({
    title: document.querySelector("#title").textContent,
    mixedHtml: document.querySelector("#mixed").innerHTML,
    imageSrc: document.querySelector("#image").getAttribute("src"),
    imageSrcset: document.querySelector("#image").getAttribute("srcset"),
    imageSizes: document.querySelector("#image").getAttribute("sizes"),
    imageStyle: document.querySelector("#image").getAttribute("style"),
    sourceSrcset: document.querySelector("#source").getAttribute("srcset"),
    poster: document.querySelector("#video").getAttribute("poster"),
    newText: document.querySelector("#newText").textContent,
    newImageSrc: document.querySelector("#newImage").getAttribute("src"),
    markerCount: document.querySelectorAll("[data-web-memefier-media], [data-web-memefier-text]").length,
    overlayCount: document.querySelectorAll(".web-memefier-media-overlay").length
  }));

  assert.equal(restored.title, "这是严肃的网页标题了");
  assert.equal(restored.mixedHtml, "正常的文字 <strong>加粗的文字了</strong>");
  assert.equal(restored.imageSrc, "https://example.com/original.png");
  assert.equal(restored.imageSrcset, "https://example.com/original@2x.png 2x");
  assert.equal(restored.imageSizes, "100vw");
  assert.equal(restored.imageStyle, null);
  assert.equal(restored.sourceSrcset, "https://example.com/source.webp");
  assert.equal(restored.poster, "https://example.com/poster.png");
  assert.equal(restored.newText, "新增内容");
  assert.equal(restored.newImageSrc, "https://example.com/new.png");
  assert.equal(restored.markerCount, 0);
  assert.equal(restored.overlayCount, 0);

  console.log("Extension behavior check passed.");
} finally {
  await browser.close();
}
