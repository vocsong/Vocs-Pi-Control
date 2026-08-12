/* Objective theme verification: computed styles + no console errors per theme. */
import { chromium } from "playwright";

const THEMES = ["default", "neon", "glass", "holo"];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));

await page.goto("http://127.0.0.1:5173", { waitUntil: "networkidle" });

let failures = 0;
const check = (label, ok, detail = "") => {
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

for (const theme of THEMES) {
  await page.evaluate((id) => {
    localStorage.setItem("pi-control.theme", id);
  }, theme);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  const styles = await page.evaluate(() => {
    const html = document.documentElement;
    const body = getComputedStyle(document.body);
    const sidebar = getComputedStyle(document.querySelector(".sidebar"));
    const btn = getComputedStyle(document.querySelector(".btn"));
    const header = getComputedStyle(document.querySelector(".app-header"));
    const activeTab = getComputedStyle(document.querySelector(".tab.active"));
    return {
      htmlClass: html.className,
      dataTheme: html.getAttribute("data-theme"),
      bodyBg: body.backgroundColor,
      bodyBgImage: body.backgroundImage.slice(0, 60),
      bodyFont: body.fontFamily.slice(0, 40),
      sidebarBg: sidebar.backgroundColor,
      sidebarRadius: sidebar.borderRadius,
      btnBorder: btn.borderColor,
      btnRadius: btn.borderRadius,
      headerBg: header.backgroundColor,
      activeTabColor: activeTab.color,
    };
  });

  check(`${theme}: theme class applied`, styles.htmlClass.includes(`theme-${theme}`), styles.htmlClass);
  check(`${theme}: data-theme set`, styles.dataTheme === theme, styles.dataTheme ?? "none");
  check(
    `${theme}: body background`,
    (styles.bodyBg && styles.bodyBg !== "rgba(0, 0, 0, 0)") || styles.bodyBgImage.length > 10,
    `${styles.bodyBg} img:${styles.bodyBgImage.length > 0}`,
  );
  check(`${theme}: font family`, styles.bodyFont.length > 5, styles.bodyFont);

  // Theme distinctness: at least one surface differs from core
  if (theme !== "default") {
    const core = await page.evaluate(() => {
      localStorage.setItem("pi-control.theme", "default");
    });
    void core;
    await page.reload({ waitUntil: "networkidle" });
    const coreBtn = await page.evaluate(() => getComputedStyle(document.querySelector(".btn")).borderColor);
    check(`${theme}: button style differs from core`, styles.btnBorder !== coreBtn, `${styles.btnBorder} vs ${coreBtn}`);
    await page.evaluate((id) => {
      localStorage.setItem("pi-control.theme", id);
    }, theme);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForTimeout(400);
  }
}

// functional sanity: settings tab opens, sidebar renders workspaces
await page.evaluate(() => localStorage.setItem("pi-control.theme", "neon"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
const hasWorkspace = await page.evaluate(() => document.body.textContent?.includes("demo") ?? false);
check("neon: workspace 'demo' visible", hasWorkspace);
const wsCount = await page.evaluate(() => document.querySelectorAll(".project-main").length);
check("neon: workspace rows rendered", wsCount >= 1, `rows=${wsCount}`);
const sessionCount = await page.evaluate(() => document.querySelectorAll(".session-item").length);
check("neon: session rows rendered", sessionCount >= 1, `sessions=${sessionCount}`);

check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

await browser.close();
console.log(failures === 0 ? "\nALL THEME CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
