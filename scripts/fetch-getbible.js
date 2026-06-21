#!/usr/bin/env node

const { writeFile } = require("node:fs/promises");

const translations = [
  { abbreviation: "synodal", output: "data/verses.synodal.full.json" },
  { abbreviation: "asv", output: "data/verses.en.full.json" }
];

async function main() {
  for (const translation of translations) {
    const url = `https://api.getbible.net/v2/${translation.abbreviation}.json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    const data = await response.json();
    await writeFile(translation.output, JSON.stringify(data, null, 2));
    console.log(`Wrote ${translation.output}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
