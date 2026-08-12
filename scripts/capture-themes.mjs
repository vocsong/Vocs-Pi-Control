/* Capture review screenshots of every UI theme. */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const OUT = path.join(ROOT, "docs", "screenshots");
mkdirSync(OUT, { recursive: true });

const THEMES = [
  { id: "default", file: "01-core.png" },
  { id: "neon", file: "02-neon.png" },
  { id: "glass", file: "03-glass.png" },
  { id: "holo", file: "04-holo.png" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

for (const theme of THEMES) {
  // set the persisted theme before the app boots
  await page.goto("http://127.0.0.1:5173");
  await page.evaluate((id) => {
    localStorage.setItem("pi-control.theme", id);
  }, theme.id);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900); // let streaming UI settle
  await page.screenshot({ path: path.join(OUT, theme.file) });
  console.log("captured", theme.file);
}

// Also capture the settings tab in NEON for variety
await page.evaluate(() => localStorage.setItem("pi-control.theme", "neon"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.getByRole("button", { name: "Settings" }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, "05-neon-settings.png") });
console.log("captured 05-neon-settings.png");

await browser.close();
console.log("done —", OUT);
