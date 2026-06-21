(function runPornhubReplacer(global) {
  "use strict";

  const verseLibrary = global.GoonerBlockVerses;
  const replacedElements = new WeakSet();
  const sessionMappings = new Map();
  let verses = verseLibrary?.fallbackVerses || [];
  let scheduled = false;
  let lastScan = {
    candidates: 0,
    replaced: 0,
    replacementsOnPage: 0
  };

  function debugEnabled() {
    try {
      return global.localStorage.getItem("goonerblockDebug") === "1";
    } catch {
      return false;
    }
  }

  function debugLog(message, details = {}) {
    if (!debugEnabled()) return;
    console.info(`[Goonerblock] ${message}`, details);
  }

  const adapter = {
    name: "pornhub",
    hostnames: new Set(["pornhub.com", "www.pornhub.com"]),
    selectors: [
      "#player",
      ".mgp_player",
      ".video-wrapper",
      ".video-container",
      ".playerFlvContainer",
      "video",
      "iframe[src*='pornhub.com']",
      "li.videoblock",
      ".videoBox",
      ".pcVideoListItem",
      ".phimage",
      "a[href*='/view_video.php?viewkey=']",
      "a[href*='/embed/']"
    ],

    isActive() {
      return this.hostnames.has(global.location.hostname);
    },

    findCandidates(root) {
      const scope = root instanceof Element || root instanceof Document ? root : document;
      const candidates = new Set();

      if (scope instanceof Element) {
        for (const selector of this.selectors) {
          if (scope.matches(selector)) {
            const candidate = this.toReplaceableContainer(scope);
            if (candidate) candidates.add(candidate);
            break;
          }
        }
      }

      for (const selector of this.selectors) {
        scope.querySelectorAll?.(selector).forEach((element) => {
          const candidate = this.toReplaceableContainer(element);
          if (candidate) candidates.add(candidate);
        });
      }

      return [...candidates];
    },

    toReplaceableContainer(element) {
      if (!(element instanceof Element)) return null;
      if (element.closest(".gb-verse-replacement")) return null;
      if (element.matches("html, body, main, section")) return null;

      const linkedVideo = element.matches("a[href*='/view_video.php?viewkey='], a[href*='/embed/']")
        ? element
        : element.querySelector("a[href*='/view_video.php?viewkey='], a[href*='/embed/']");
      const videoLike = element.matches("video, iframe, #player, .mgp_player, .video-wrapper, .video-container, .playerFlvContainer");

      if (!linkedVideo && !videoLike) return null;

      return element.closest("li.videoblock, .videoBox, .pcVideoListItem, .phimage, .video-wrapper, .video-container, .playerFlvContainer")
        || element;
    },

    getOriginalUrl(element) {
      const anchor = element.matches("a[href]") ? element : element.querySelector("a[href]");
      if (!anchor) return global.location.href;

      try {
        return new URL(anchor.getAttribute("href"), global.location.href).href;
      } catch {
        return global.location.href;
      }
    },

    getSizingHint(element) {
      const rect = element.getBoundingClientRect();
      const computed = global.getComputedStyle(element);
      const width = Math.max(rect.width, Number.parseFloat(computed.width) || 0);
      const height = Math.max(rect.height, Number.parseFloat(computed.height) || 0);

      return {
        width,
        height,
        display: computed.display === "inline" ? "inline-grid" : "grid"
      };
    }
  };

  function createReplacement(element, verse) {
    const sizing = adapter.getSizingHint(element);
    const replacement = document.createElement("div");
    const id = `gb-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    replacement.className = "gb-verse-replacement";
    replacement.dataset.gbReplacementId = id;
    replacement.dataset.gbVerseId = verse.id;
    replacement.dataset.gbSourceUrl = verse.sourceUrl;
    replacement.tabIndex = 0;
    replacement.role = "link";
    replacement.setAttribute("aria-label", `Open Bible source for ${verse.reference}`);

    if (sizing.width > 0) replacement.style.width = `${Math.round(sizing.width)}px`;
    if (sizing.height > 0) replacement.style.minHeight = `${Math.max(120, Math.round(sizing.height))}px`;
    replacement.style.display = sizing.display;

    replacement.innerHTML = `
      <span class="gb-verse-text"></span>
      <span class="gb-verse-reference"></span>
    `;
    replacement.querySelector(".gb-verse-text").textContent = verse.text;
    replacement.querySelector(".gb-verse-reference").textContent = verse.reference;

    sessionMappings.set(id, {
      verse,
      originalUrl: adapter.getOriginalUrl(element)
    });

    replacement.addEventListener("click", openVerseSource);
    replacement.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openVerseSource(event);
      }
    });

    return replacement;
  }

  function openVerseSource(event) {
    const target = event.currentTarget;
    const sourceUrl = target?.dataset?.gbSourceUrl;
    if (!sourceUrl) return;
    global.open(sourceUrl, "_blank", "noopener,noreferrer");
  }

  function replaceCandidate(element) {
    if (!(element instanceof Element)) return;
    if (!element.isConnected) return;
    if (replacedElements.has(element)) return;
    if (element.dataset.gbReplaced === "true") return;
    if (element.closest(".gb-verse-replacement")) return;

    const verse = verseLibrary.randomVerse(verses);
    const replacement = createReplacement(element, verse);

    replacedElements.add(element);
    element.dataset.gbReplaced = "true";
    element.replaceWith(replacement);
    return true;
  }

  function scan(root = document) {
    if (!adapter.isActive()) return;

    const candidates = adapter.findCandidates(root);
    let replaced = 0;

    for (const candidate of candidates) {
      if (replaceCandidate(candidate)) replaced += 1;
    }

    lastScan = {
      candidates: candidates.length,
      replaced,
      replacementsOnPage: document.querySelectorAll(".gb-verse-replacement").length
    };
    debugLog("scan complete", lastScan);
  }

  function scheduleScan(root = document) {
    if (scheduled) return;
    scheduled = true;

    global.requestAnimationFrame(() => {
      scheduled = false;
      scan(root);
    });
  }

  async function init() {
    if (!adapter.isActive()) return;

    if (!verseLibrary) {
      console.warn("[Goonerblock] Verse library is not available.");
      return;
    }

    verses = await verseLibrary.loadVerses({ language: "ru" });
    debugLog("initialized", {
      hostname: global.location.hostname,
      verseCount: verses.length
    });
    scan();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            scheduleScan(node);
            return;
          }
        }
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }

  global.__goonerblockDebug = function inspectGoonerblock() {
    const rawSelectorCounts = {};

    for (const selector of adapter.selectors) {
      rawSelectorCounts[selector] = document.querySelectorAll(selector).length;
    }

    return {
      active: adapter.isActive(),
      hostname: global.location.hostname,
      verseLibraryLoaded: Boolean(verseLibrary),
      verseCount: verses.length,
      lastScan,
      replacementsOnPage: document.querySelectorAll(".gb-verse-replacement").length,
      rawSelectorCounts
    };
  };

  init();
})(globalThis);
