/**
 * E2E tests for @mention autocomplete in the ProseMirror inline reply editor.
 */
import { test, expect, Page, ElectronApplication } from "@playwright/test";
import { launchElectronApp } from "../e2e/launch-helpers";

test.describe("Body @mention Autocomplete → CC", () => {
  test.describe.configure({ mode: 'serial' });

  let electronApp: ElectronApplication;
  let page: Page;

  test.beforeAll(async ({}, testInfo) => {
    const result = await launchElectronApp({ workerIndex: testInfo.workerIndex });
    electronApp = result.app;
    page = result.page;

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        console.log(`[Console Error]: ${msg.text()}`);
      }
    });
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
  });

  async function navigateToInlineReply() {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);

    const emailItem = page.locator("button").filter({ hasText: /Garry Tan|Q3 Quarterly Report/i }).first();
    await expect(emailItem).toBeVisible({ timeout: 10000 });
    await emailItem.click();
    await page.waitForTimeout(500);

    const replyButton = page.locator("button[title='Reply All']").first();
    await expect(replyButton).toBeVisible({ timeout: 5000 });
    await replyButton.click();
    await page.waitForTimeout(500);

    const inlineCompose = page.locator("[data-testid='inline-compose']").first();
    await expect(inlineCompose).toBeVisible({ timeout: 5000 });

    const editor = inlineCompose.locator(".ProseMirror").first();
    await expect(editor).toBeVisible({ timeout: 5000 });

    return { inlineCompose, editor };
  }

  test("@mention shows dropdown and Tab adds person to CC", async () => {
    const { inlineCompose, editor } = await navigateToInlineReply();

    // Place cursor at end and type @ali to trigger mention
    await editor.click();
    await page.keyboard.type("\n@ali", { delay: 50 });

    // Wait for mention dropdown
    const mentionDropdown = page.locator("[data-testid='mention-dropdown']");
    await expect(mentionDropdown).toBeVisible({ timeout: 3000 });
    await expect(
      page.locator("[data-testid='mention-suggestion']").filter({ hasText: "Alice Johnson" })
    ).toBeVisible({ timeout: 3000 });

    // First suggestion should be auto-selected (selectedIndex=0), press Tab to confirm
    await page.keyboard.press("Tab");

    // The mention dropdown should close
    await expect(mentionDropdown).not.toBeVisible({ timeout: 2000 });

    // The CC section should now be visible with Alice's email
    const ccSection = inlineCompose.locator("[data-testid='address-input-cc']");
    await expect(ccSection).toBeVisible({ timeout: 3000 });

    const ccChip = inlineCompose
      .locator("[data-testid='address-input-cc'] [data-testid='address-chip']")
      .filter({ hasText: "alice@example.com" });
    await expect(ccChip).toBeVisible({ timeout: 2000 });

    await expect(editor).toContainText("Alice", { timeout: 2000 });
    await expect(editor).not.toContainText("@ali");
  });

  test("clicking @mention suggestion adds person to CC", async () => {
    const { inlineCompose, editor } = await navigateToInlineReply();

    // Type @bob to trigger mention
    await editor.click();
    await page.keyboard.type("\n@bob", { delay: 50 });

    // Wait for mention dropdown
    const mentionDropdown = page.locator("[data-testid='mention-dropdown']");
    await expect(mentionDropdown).toBeVisible({ timeout: 3000 });

    // Click on Bob's suggestion
    const suggestion = page.locator("[data-testid='mention-suggestion']").filter({ hasText: "Bob Smith" });
    await expect(suggestion).toBeVisible({ timeout: 2000 });
    await suggestion.click();

    // Dropdown should close
    await expect(mentionDropdown).not.toBeVisible({ timeout: 2000 });

    // Bob should be added to CC
    const bobChip = inlineCompose
      .locator("[data-testid='address-input-cc'] [data-testid='address-chip']")
      .filter({ hasText: "bob@example.com" });
    await expect(bobChip).toBeVisible({ timeout: 2000 });

    await expect(editor).toContainText("Bob", { timeout: 2000 });
    await expect(editor).not.toContainText("@bob");
  });
});
