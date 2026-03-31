import { test, expect, Page, ElectronApplication } from "@playwright/test";
import { launchElectronApp } from "../e2e/launch-helpers";

/**
 * E2E Tests for Archive Ready (split-tab UI)
 *
 * Tests the archive-ready feature as a split tab:
 * - Tab appears with correct count
 * - Clicking tab filters to archive-ready threads
 * - Archive All button in header
 * - Archive All clears view and returns to "All" inbox
 *
 * Run with: npm run test:e2e -- --grep "Archive Ready"
 */

function tabBar(page: Page) {
  return page.locator("div.overflow-x-auto.border-b, div.border-b.overflow-x-auto").first();
}

test.describe("Archive Ready — Split Tab", () => {
  test.describe.configure({ mode: "serial" });
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex });
    electronApp = result.app;
    page = result.page;

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.error(`[Console Error]: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("Archive Ready tab appears in split tabs with count", async () => {
    // The split tabs bar should show an "Archive Ready" tab with the count of demo threads (6)
    const archiveTab = page.locator("button:has-text('Archive Ready')");
    await expect(archiveTab).toBeVisible({ timeout: 10000 });

    // The tab should display a count
    const tabText = await archiveTab.textContent();
    // Demo mode seeds 6 archive-ready threads
    expect(tabText).toContain("6");
  });

  test("clicking Archive Ready tab filters to archive-ready threads", async () => {
    const splitTabsBar = tabBar(page);
    const allTab = splitTabsBar.locator("button").filter({ hasText: /^All/ }).first();
    await expect(allTab).toBeVisible();
    const allTabText = await allTab.textContent();
    expect(allTabText).toContain("All");
    const allCountMatch = allTabText?.match(/(\d+)/);
    const allCount = allCountMatch ? parseInt(allCountMatch[1], 10) : 0;
    expect(allCount).toBeGreaterThan(0);

    // Click the Archive Ready tab
    const archiveTab = page.locator("button:has-text('Archive Ready')");
    await archiveTab.click();
    await page.waitForTimeout(500);

    // Archive Ready tab should now be active and the list should match its count.
    await expect(archiveTab).toHaveClass(/border-blue-500/);
    const archiveTabText = await archiveTab.textContent();
    const archiveCountMatch = archiveTabText?.match(/(\d+)/);
    const archiveCount = archiveCountMatch ? parseInt(archiveCountMatch[1], 10) : 0;
    expect(archiveCount).toBeGreaterThan(0);

    const visibleThreads = await page.locator("div[data-thread-id]").count();
    expect(visibleThreads).toBe(archiveCount);
  });

  test("Archive All button visible in header when tab is active", async () => {
    // Ensure we're on the archive-ready tab
    const archiveTab = page.locator("button:has-text('Archive Ready')");
    await archiveTab.click();
    await page.waitForTimeout(300);

    // "Archive All" button should be visible in the header
    const archiveAllBtn = page.locator("button:has-text('Archive All')");
    await expect(archiveAllBtn).toBeVisible();
  });

  test("Archive All clears view and returns to All inbox", async () => {
    // Ensure we're on the archive-ready tab
    const archiveTab = page.locator("button:has-text('Archive Ready')");
    await archiveTab.click();
    await page.waitForTimeout(300);

    // Click Archive All
    const archiveAllBtn = page.locator("button:has-text('Archive All')");
    await archiveAllBtn.click();

    // Wait for the action to complete
    await page.waitForTimeout(1000);

    const splitTabsBar = tabBar(page);
    const allTab = splitTabsBar.locator("button").filter({ hasText: /^All/ }).first();
    await expect(allTab).toBeVisible({ timeout: 5000 });

    // The inbox should still have rows visible in the list.
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 5000 });

    // Archive Ready remains visible but should now be empty and no bulk action should remain.
    await expect(archiveTab).toContainText("0");
    await expect(page.locator("button:has-text('Archive All')")).not.toBeVisible();
    await expect(page.locator("text=Select an email to see details")).toBeVisible();
  });
});

test.describe("Archive Ready — Settings", () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex });
    electronApp = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("archive-ready prompt is configurable in settings", async () => {
    // Open settings
    const settingsButton = page.locator("button[title='Settings']");
    await settingsButton.click();
    await page.waitForTimeout(500);

    // Click Prompts tab
    const promptsTab = page.locator("button:has-text('Prompts')");
    await expect(promptsTab).toBeVisible({ timeout: 5000 });
    await promptsTab.click();
    await page.waitForTimeout(300);

    // Should show Archive Ready Prompt textarea
    const archiveReadyLabel = page.locator("text=Archive Ready Prompt");
    await expect(archiveReadyLabel).toBeVisible();
  });
});
