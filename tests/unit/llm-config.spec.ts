import { test, expect } from "@playwright/test";
import {
  normalizeLlmConfig,
  resolveAnthropicValidationModelId,
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

test("resolves anthropic validation model even when default provider is openai", () => {
  const config = {
    llm: {
      defaultProvider: "openai" as const,
      featureTiers: {
        analysis: "balanced" as const,
        drafts: "best" as const,
        refinement: "fast" as const,
        calendaring: "balanced" as const,
        archiveReady: "balanced" as const,
        senderLookup: "fast" as const,
        agentDrafter: "balanced" as const,
        agentChat: "best" as const,
      },
    },
  };

  expect(resolveFeatureModelId(config, "senderLookup")).toBe("gpt-5-nano");
  expect(resolveAnthropicValidationModelId(config)).toBe("claude-haiku-4-5-20251001");
});
