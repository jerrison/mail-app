import { test, expect } from "@playwright/test";
import {
  normalizeLlmConfig,
  resolveBuiltInProviderId,
  resolveDefaultAgentProviderId,
  resolveFeatureModelId,
} from "../../src/main/llm/config";

test("migrates legacy anthropic fields into provider-neutral llm config", () => {
  const normalized = normalizeLlmConfig({
    anthropicApiKey: "sk-ant-test",
    modelConfig: {
      analysis: "sonnet",
      drafts: "opus",
      refinement: "haiku",
      calendaring: "sonnet",
      archiveReady: "sonnet",
      senderLookup: "haiku",
      agentDrafter: "sonnet",
      agentChat: "opus",
    },
  });

  expect(normalized.defaultProvider).toBe("anthropic");
  expect(normalized.providers.anthropic.apiKey).toBe("sk-ant-test");
  expect(normalized.featureTiers.analysis).toBe("balanced");
  expect(normalized.featureTiers.drafts).toBe("best");
  expect(normalized.featureTiers.refinement).toBe("fast");
});

test("resolves provider-specific model ids from feature quality", () => {
  const config = {
    llm: {
      defaultProvider: "openai",
      providers: { openai: { apiKey: "sk-openai-test" } },
      featureTiers: {
        analysis: "balanced",
        drafts: "best",
        refinement: "fast",
        calendaring: "balanced",
        archiveReady: "balanced",
        senderLookup: "fast",
        agentDrafter: "balanced",
        agentChat: "best",
      },
    },
  };

  expect(resolveBuiltInProviderId(config)).toBe("openai");
  expect(resolveDefaultAgentProviderId(config)).toBe("openai");
  expect(resolveFeatureModelId(config, "analysis")).toBe("gpt-5-mini");
  expect(resolveFeatureModelId(config, "drafts")).toBe("gpt-5.2");
});
