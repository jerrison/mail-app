import { test, expect, Page, ElectronApplication } from "@playwright/test";
import { launchElectronApp } from "../e2e/launch-helpers";

/**
 * Flaky archive/trash tests extracted from tests/e2e/archive.spec.ts
 *
 * These tests pass individually but fail in the full suite due to:
 * - Demo database state isolation issues
 * - Timing-sensitive keyboard event handling in Electron
 * - Shared state between tests in serial mode
 *
 * To run these tests: npx playwright test tests/problematic/archive-flaky.spec.ts
 */

/** Count inbox thread rows (buttons inside the email list scroll container). */
async function countInboxThreads(page: Page): Promise<number> {
  const rows = page.locator(".overflow-y-auto div[data-thread-id]");
  return rows.count();
}

/** Get the text content of the currently selected email row. */
async function getSelectedRowText(page: Page): Promise<string | null> {
  const selected = page.locator(".overflow-y-auto div[data-thread-id][data-selected='true']").first();
  if (await selected.isVisible().catch(() => false)) {
    return selected.textContent();
  }
  return null;
}

/** Select the first inbox thread by pressing 'j' and wait for selection. */
async function selectFirstThread(page: Page): Promise<void> {
  await page.keyboard.press("j");
  await page.waitForTimeout(300);
  const selected = page.locator(".overflow-y-auto div[data-thread-id][data-selected='true']");
  await expect(selected).toBeVisible({ timeout: 3000 });
}

/** Normalize back to split inbox view so keyboard tests start from the list. */
async function ensureSplitInbox(page: Page): Promise<void> {
  const backButton = page.locator("button").filter({ hasText: "Back" }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    const listVisible = await page.locator("div[data-thread-id]").first().isVisible().catch(() => false);
    if (listVisible && !(await backButton.isVisible().catch(() => false))) {
      break;
    }
    if (await backButton.isVisible().catch(() => false)) {
      await backButton.click();
    } else {
      await page.keyboard.press("Escape");
    }
    await page.waitForTimeout(250);
  }

  const allTab = page.locator("button").filter({ hasText: /^All\s*\d*$/ }).first();
  if (await allTab.isVisible().catch(() => false)) {
    await allTab.click();
    await page.waitForTimeout(250);
  }

  await expect(page.locator("div[data-thread-id]").first()).toBeVisible({ timeout: 5000 });
  await expect(backButton).not.toBeVisible();
}

// ---------------------------------------------------------------------------
// Archive persistence — email should not come back after re-fetch
// ---------------------------------------------------------------------------
// This test passes individually but fails in the full suite due to demo database
// state isolation issues. Earlier tests archive emails which affects this test's count.
test.describe("Archive - Persistence", () => {
  test.describe.configure({ mode: 'serial' });
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex + 100, waitAfterLoad: 1000 });
    electronApp = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("archived email does not reappear after clicking Refresh", async () => {
    await page.waitForTimeout(1000);
    await selectFirstThread(page);

    const archivedText = await getSelectedRowText(page);
    expect(archivedText).toBeTruthy();

    const countBefore = await countInboxThreads(page);
    expect(countBefore).toBeGreaterThan(1);

    // Archive
    await page.keyboard.press("e");
    await expect(async () => {
      const countAfter = await countInboxThreads(page);
      expect(countAfter).toBe(countBefore - 1);
    }).toPass({ timeout: 2000 });

    // Click Refresh — this triggers sync:get-emails which re-fetches from DB
    const refreshButton = page.locator("button[title='Refresh']");
    await refreshButton.click();
    await page.waitForTimeout(2000);

    // The archived email should still be gone
    const countAfterRefresh = await countInboxThreads(page);
    expect(countAfterRefresh).toBe(countBefore - 1);

    // Verify the specific text is not in the list
    const allRowTexts = await page.locator(".overflow-y-auto div[data-thread-id]").allTextContents();
    const stillPresent = allRowTexts.some((t) => t === archivedText);
    expect(stillPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Rapid-succession archive tests
// ---------------------------------------------------------------------------
// These tests are inherently flaky due to timing-sensitive keyboard event handling
// in Electron. The core archive functionality is tested in "Archive - Optimistic UI".
test.describe("Archive - Rapid Succession", () => {
  test.describe.configure({ mode: 'serial' });
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex + 200, waitAfterLoad: 1000 });
    electronApp = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("can archive multiple threads in rapid succession", async () => {
    await page.waitForTimeout(1000);
    await selectFirstThread(page);

    const countBefore = await countInboxThreads(page);
    expect(countBefore).toBeGreaterThan(3);

    for (let i = 0; i < 3; i++) {
      await expect(page.locator(".overflow-y-auto div[data-thread-id][data-selected='true']")).toBeVisible({ timeout: 3000 });
      await page.waitForTimeout(200);

      const before = await countInboxThreads(page);
      await page.keyboard.press("e");

      // Wait for count to decrease
      await expect(async () => {
        const after = await countInboxThreads(page);
        expect(after).toBe(before - 1);
      }).toPass({ timeout: 3000 });
    }

    // Total: 3 fewer than when we started
    const countAfter = await countInboxThreads(page);
    expect(countAfter).toBe(countBefore - 3);
  });
});

// ---------------------------------------------------------------------------
// Rapid-succession trash tests
// ---------------------------------------------------------------------------
// These tests are inherently flaky due to timing-sensitive keyboard event handling
// in Electron. The core trash functionality is tested in the single-thread test.
test.describe("Trash - Rapid Succession", () => {
  test.describe.configure({ mode: 'serial' });
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async () => {
    const result = await launchElectronApp();
    electronApp = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("can trash multiple threads in rapid succession", async () => {
    await page.waitForTimeout(1000);
    const isSelected = await page.locator(".overflow-y-auto div[data-thread-id][data-selected='true']").isVisible().catch(() => false);
    if (!isSelected) {
      await selectFirstThread(page);
    }

    const countBefore = await countInboxThreads(page);
    expect(countBefore).toBeGreaterThan(2);

    // Trash first thread and wait for count to decrease
    await page.keyboard.type("#");
    await expect(async () => {
      const count = await countInboxThreads(page);
      expect(count).toBe(countBefore - 1);
    }).toPass({ timeout: 3000 });

    // Ensure selection is still visible before second trash
    await expect(page.locator(".overflow-y-auto div[data-thread-id][data-selected='true']")).toBeVisible({ timeout: 2000 });
    await page.waitForTimeout(200);

    // Trash second thread
    await page.keyboard.type("#");
    await expect(async () => {
      const countAfter = await countInboxThreads(page);
      expect(countAfter).toBe(countBefore - 2);
    }).toPass({ timeout: 3000 });
  });
});

// ---------------------------------------------------------------------------
// Navigation edge case - navigate then archive
// ---------------------------------------------------------------------------
// This test is flaky due to shared state with previous test in serial mode.
// The core navigation and archive functionality is tested in other describe blocks.
test.describe("Archive - Navigate Then Archive", () => {
  test.describe.configure({ mode: 'serial' });
  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex + 300, waitAfterLoad: 1000 });
    electronApp = result.app;
    page = result.page;
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  test("navigate down then archive selects the next thread", async () => {
    await page.waitForTimeout(500);
    await ensureSplitInbox(page);

    // Start from an explicit keyboard selection so the test exercises the
    // same list-selection path as the rest of the archive shortcut suite.
    await selectFirstThread(page);

    // Navigate down twice to get to the third thread
    await page.keyboard.press("j");
    await page.waitForTimeout(300);
    await page.keyboard.press("j");
    await page.waitForTimeout(300);

    // Verify selection is active before measuring count
    await expect(page.locator(".overflow-y-auto div[data-thread-id][data-selected='true']")).toBeVisible({ timeout: 2000 });

    const countBefore = await countInboxThreads(page);
    const selectedBefore = await getSelectedRowText(page);
    expect(selectedBefore).toBeTruthy();

    // Archive the current thread
    await page.keyboard.press("e");

    // Count should decrease
    await expect(async () => {
      const countAfter = await countInboxThreads(page);
      expect(countAfter).toBe(countBefore - 1);
    }).toPass({ timeout: 3000 });

    // A new thread should be selected (not the same one)
    const selectedAfter = await getSelectedRowText(page);
    expect(selectedAfter).toBeTruthy();
    expect(selectedAfter).not.toBe(selectedBefore);
  });
});
