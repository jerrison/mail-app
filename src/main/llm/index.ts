import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import type { Config } from "../../shared/types";
import type { BuiltInLlmClient, BuiltInLlmRequest } from "./types";
import { normalizeLlmConfig, resolveBuiltInProviderId } from "./config";
import { AnthropicBuiltInLlmProvider } from "./providers/anthropic";
import { OpenAIBuiltInLlmProvider } from "./providers/openai";

export function createBuiltInLlmClient(config: Partial<Config>): BuiltInLlmClient {
  const normalized = normalizeLlmConfig(config);
  const provider = resolveBuiltInProviderId(config) === "openai"
    ? new OpenAIBuiltInLlmProvider(new OpenAI({ apiKey: normalized.providers.openai.apiKey }))
    : new AnthropicBuiltInLlmProvider(new Anthropic({ apiKey: normalized.providers.anthropic.apiKey }));

  return {
    generate(request: BuiltInLlmRequest) {
      return provider.generate(request);
    },
  };
}
