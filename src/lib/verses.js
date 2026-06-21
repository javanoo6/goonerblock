(function attachVerseLibrary(global) {
  "use strict";

  const runtime = global.browser?.runtime || global.chrome?.runtime;

  const fallbackVerses = [
    {
      id: "synodal:43:3:16",
      translation: "synodal",
      language: "ru",
      bookNumber: 43,
      book: "От Иоанна",
      chapter: 3,
      verse: 16,
      reference: "Иоанна 3:16",
      text: "Ибо так возлюбил Бог мир, что отдал Сына Своего Единородного, дабы всякий верующий в Него, не погиб, но имел жизнь вечную.",
      sourceUrl: "https://api.getbible.net/v2/synodal/43/3.json"
    }
  ];

  let cachedVerses = null;

  function extensionUrl(path) {
    if (!runtime?.getURL) return path;
    return runtime.getURL(path);
  }

  async function readJson(path) {
    const response = await fetch(extensionUrl(path));
    if (!response.ok) {
      throw new Error(`Unable to load ${path}: ${response.status}`);
    }
    return response.json();
  }

  async function loadVerses(options = {}) {
    if (cachedVerses) return cachedVerses;

    const language = options.language || "ru";
    const primaryPath = language === "en" ? "data/verses.en.json" : "data/verses.synodal.json";

    try {
      const data = await readJson(primaryPath);
      cachedVerses = normalizeVerses(data);
    } catch (error) {
      console.warn("[Goonerblock] Falling back to built-in verse data.", error);
      cachedVerses = fallbackVerses;
    }

    return cachedVerses;
  }

  function normalizeVerses(data) {
    const verses = Array.isArray(data) ? data : data.verses;
    if (!Array.isArray(verses) || verses.length === 0) {
      throw new Error("Verse data is empty or malformed.");
    }

    return verses.map((verse) => ({
      ...verse,
      sourceUrl: verse.sourceUrl || buildSourceUrl(verse)
    }));
  }

  function buildSourceUrl(verse) {
    const translation = encodeURIComponent(verse.translation || "synodal");
    return `https://api.getbible.net/v2/${translation}/${verse.bookNumber}/${verse.chapter}.json`;
  }

  function randomVerse(verses) {
    const source = Array.isArray(verses) && verses.length > 0 ? verses : fallbackVerses;
    const index = Math.floor(Math.random() * source.length);
    return source[index];
  }

  global.GoonerBlockVerses = {
    loadVerses,
    randomVerse,
    buildSourceUrl,
    fallbackVerses
  };
})(globalThis);
