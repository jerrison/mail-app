import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "../../src");

test.describe("Provider-neutral settings UI", () => {
  test("SettingsPanel exposes built-in provider switching and provider-aware validation", () => {
    const code = readFileSync(
      path.join(srcDir, "renderer/components/SettingsPanel.tsx"),
      "utf-8"
    );

    expect(code).toContain("Built-in AI Provider");
    expect(code).toContain("OpenAI");
    expect(code).toContain("Anthropic");
    expect(code).toContain("featureTiers");
    expect(code).toContain("validateProviderApiKey");
    expect(code).toContain("setDefaultAgentProviderId");
  });

  test("SetupWizard uses provider-neutral auth state and provider-aware API key validation", () => {
    const code = readFileSync(
      path.join(srcDir, "renderer/components/SetupWizard.tsx"),
      "utf-8"
    );

    expect(code).toContain("hasDefaultBuiltInProviderAuth");
    expect(code).toContain("configuredProviders");
    expect(code).toContain("defaultProvider");
    expect(code).toContain("validateProviderApiKey");
    expect(code).toContain("defaultProvider: selectedProvider");
  });
});
