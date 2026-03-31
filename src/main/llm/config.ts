import type { Config, BuiltInLlmProviderId, FeatureQualityConfig } from "../../shared/types";
import { DEFAULT_FEATURE_QUALITY_CONFIG } from "../../shared/types";

const LEGACY_ANTHROPIC_TIER_TO_QUALITY = {
  haiku: "fast",
  sonnet: "balanced",
  opus: "best",
} as const;

const FEATURE_MODEL_IDS = {
  anthropic: {
    fast: "claude-haiku-4-5-20251001",
    balanced: "claude-sonnet-4-5-20250929",
    best: "claude-opus-4-6",
  },
  openai: {
    fast: "gpt-5-nano",
    balanced: "gpt-5-mini",
    best: "gpt-5.2",
  },
} as const;

export function normalizeLlmConfig(config: Partial<Config>) {
  const legacyFeatureTiers: Partial<FeatureQualityConfig> = config.modelConfig
    ? Object.fromEntries(
      Object.entries(config.modelConfig).map(([key, value]) => [
        key,
        LEGACY_ANTHROPIC_TIER_TO_QUALITY[value as keyof typeof LEGACY_ANTHROPIC_TIER_TO_QUALITY] ?? "balanced",
      ]),
    )
    : {};

  return {
    defaultProvider: config.llm?.defaultProvider ?? "anthropic",
    providers: {
      anthropic: {
        apiKey: config.llm?.providers?.anthropic?.apiKey ?? config.anthropicApiKey,
      },
      openai: {
        apiKey: config.llm?.providers?.openai?.apiKey,
      },
    },
    featureTiers: {
      ...DEFAULT_FEATURE_QUALITY_CONFIG,
      ...legacyFeatureTiers,
      ...config.llm?.featureTiers,
    },
  };
}

export function resolveBuiltInProviderId(config: Partial<Config>): BuiltInLlmProviderId {
  return normalizeLlmConfig(config).defaultProvider;
}

export function resolveDefaultAgentProviderId(config: Partial<Config>): "claude" | "openai" {
  return resolveBuiltInProviderId(config) === "openai" ? "openai" : "claude";
}

export function resolveFeatureModelId(
  config: Partial<Config>,
  feature: keyof FeatureQualityConfig,
  provider: BuiltInLlmProviderId = resolveBuiltInProviderId(config),
): string {
  const normalized = normalizeLlmConfig(config);
  const quality = normalized.featureTiers[feature];
  return FEATURE_MODEL_IDS[provider][quality];
}

export function resolveAnthropicValidationModelId(config: Partial<Config>): string {
  return resolveFeatureModelId(config, "senderLookup", "anthropic");
}
