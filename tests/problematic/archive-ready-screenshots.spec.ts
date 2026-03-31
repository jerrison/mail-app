import { test, expect, Page, ElectronApplication } from "@playwright/test";
import { launchElectronApp } from "../e2e/launch-helpers";

function archiveTab(page: Page) {
  return page.locator("button").filter({ hasText: "Archive Ready" }).first();
}

function allTab(page: Page) {
  return page.locator("button").filter({ hasText: /^All\s*\d*$/ }).first();
}

function projectAlphaRow(page: Page) {
  return page
    .locator("div[data-thread-id]")
    .filter({ hasText: "Project Alpha - Timeline Discussion" })
    .first();
}

async function openArchiveReady(page: Page): Promise<void> {
  const tab = archiveTab(page);
  await expect(tab).toBeVisible({ timeout: 10000 });
  await tab.click();
  await page.waitForTimeout(500);
  await expect(tab).toHaveClass(/border-blue-500/);
}

async function saveScreenshot(page: Page, outputPath: string): Promise<void> {
  await page.screenshot({ path: outputPath, fullPage: true });
}

test.describe("Archive Ready - Screenshots", () => {
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeEach(async ({}, testInfo) => {
    const launched = await launchElectronApp({
      workerIndex: testInfo.workerIndex,
      waitAfterLoad: 1000,
    });
    electronApp = launched.app;
    page = launched.page;
  });

  test.afterEach(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("01 - inbox with archive ready button", async ({}, testInfo) => {
    const tab = archiveTab(page);
    await expect(tab).toBeVisible({ timeout: 10000 });
    await expect(tab).toContainText("Archive Ready");

    await saveScreenshot(page, testInfo.outputPath("01-inbox-with-archive-button.png"));
  });

  test("02 - archive ready view with threads", async ({}, testInfo) => {
    await openArchiveReady(page);

    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator("button:has-text('Archive All')")).toBeVisible();

    await saveScreenshot(page, testInfo.outputPath("02-archive-ready-view.png"));
  });

  test("03 - archive ready thread details", async ({}, testInfo) => {
    await openArchiveReady(page);

    const row = projectAlphaRow(page);
    await expect(row).toBeVisible({ timeout: 5000 });
    await row.click();
    await page.waitForTimeout(500);

    await expect(page.locator("button[title='Reply All']").first()).toBeVisible({ timeout: 5000 });

    await saveScreenshot(page, testInfo.outputPath("03-archive-ready-details.png"));
  });

  test("04 - sent email thread as archive-ready", async ({}, testInfo) => {
    await openArchiveReady(page);

    const row = projectAlphaRow(page);
    await expect(row).toBeVisible({ timeout: 5000 });
    await expect(row).toContainText("4");

    await saveScreenshot(page, testInfo.outputPath("04-sent-email-thread.png"));
  });

  test("05 - archive all action visible", async ({}, testInfo) => {
    await openArchiveReady(page);

    await expect(page.locator("button:has-text('Archive All')")).toBeVisible({ timeout: 5000 });
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 5000 });

    await saveScreenshot(page, testInfo.outputPath("05-archive-all-action.png"));
  });

  test("06 - back to inbox", async ({}, testInfo) => {
    await openArchiveReady(page);

    const tab = allTab(page);
    await expect(tab).toBeVisible({ timeout: 5000 });
    await tab.click();
    await page.waitForTimeout(500);

    await expect(tab).toHaveClass(/border-blue-500/);
    await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 5000 });

    await saveScreenshot(page, testInfo.outputPath("06-back-to-inbox.png"));
  });
});
