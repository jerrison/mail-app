# OpenAI Provider Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Anthropic-only built-in AI wiring with a provider-neutral LLM layer that adds full OpenAI support, a UI provider switch, and shared memories across providers.

**Architecture:** Introduce `src/main/llm/` as the single built-in AI boundary for non-extension feature code, then migrate every built-in AI-backed service to it. Keep the existing agent provider registry, add a first-party OpenAI agent provider, and make the renderer/settings/onboarding drive one persisted built-in provider selection for all default AI behavior.

**Tech Stack:** Electron, React, TypeScript, Zod, electron-store, Playwright, Anthropic SDK, OpenAI SDK

---

## Scope Check

This stays as one plan. The feature touches multiple files, but they are not independent subsystems: config migration, built-in LLM abstraction, agent-provider support, and UI switching all depend on the same provider-neutral boundary.

## File Map

### New files

- `src/main/llm/types.ts`
  Shared request/response types for built-in LLM calls.
- `src/main/llm/config.ts`
  Provider normalization, legacy config migration, and model resolution helpers.
- `src/main/llm/providers/anthropic.ts`
  Anthropic adapter behind the provider-neutral built-in LLM interface.
- `src/main/llm/providers/openai.ts`
  OpenAI adapter using the official `openai` SDK and Responses API.
- `src/main/llm/index.ts`
  Factory for the built-in LLM client used by feature code.
- `src/main/agents/providers/openai-agent-provider.ts`
  First-party OpenAI implementation of the existing `AgentProvider` interface.
- `tests/mocks/openai-api-mock.ts`
  OpenAI SDK test double mirroring the current Anthropic mock.
- `tests/mocks/built-in-llm-mock.ts`
  Provider-neutral mock for feature-service unit tests.
- `tests/unit/llm-config.spec.ts`
  Config migration and model-resolution coverage.
- `tests/unit/llm-service.spec.ts`
  Adapter-level Anthropic/OpenAI coverage.
- `tests/unit/openai-agent-provider.spec.ts`
  OpenAI agent-provider coverage.
- `tests/unit/analysis-edit-learner.spec.ts`
  Regression coverage for analysis-learning prompt routing.
- `tests/unit/draft-edit-learner.spec.ts`
  Regression coverage for draft-learning prompt routing.

### Core files to modify

- `package.json`
  Add the OpenAI SDK dependency.
- `src/shared/types.ts`
  Add provider-neutral config schema and keep legacy fields readable.
- `src/main/ipc/settings.ipc.ts`
  Persist normalized LLM config, validate provider keys, and resolve feature/agent defaults.
- `src/main/ipc/gmail.ipc.ts`
  Replace `hasAnthropicKey` onboarding checks with provider-neutral auth checks.
- `src/main/ipc/analysis.ipc.ts`
- `src/main/ipc/archive-ready.ipc.ts`
- `src/main/ipc/compose.ipc.ts`
- `src/main/services/email-analyzer.ts`
- `src/main/services/archive-ready-analyzer.ts`
- `src/main/services/calendaring-agent.ts`
- `src/main/services/draft-generator.ts`
- `src/main/services/draft-pipeline.ts`
- `src/main/ipc/drafts.ipc.ts`
- `src/main/ipc/memory.ipc.ts`
- `src/main/services/draft-edit-learner.ts`
- `src/main/services/analysis-edit-learner.ts`
  Move built-in AI calls off direct Anthropic SDK usage.
- `src/extensions/mail-ext-web-search/src/index.ts`
- `src/extensions/mail-ext-web-search/src/web-search-provider.ts`
  Make sender lookup use provider-neutral web search.
- `src/main/agents/types.ts`
- `src/main/agents/orchestrator.ts`
- `src/main/agents/agent-coordinator.ts`
- `src/main/ipc/agent.ipc.ts`
- `src/main/services/prefetch-service.ts`
  Add OpenAI agent-provider support and update built-in provider defaults.
- `src/renderer/components/SettingsPanel.tsx`
- `src/renderer/components/SetupWizard.tsx`
- `src/renderer/components/AgentCommandPalette.tsx`
- `src/renderer/components/AgentPanel.tsx`
- `src/renderer/components/EmailPreviewSidebar.tsx`
- `src/renderer/store/index.ts`
- `src/renderer/App.tsx`
- `src/preload/index.ts`
  Make the UI/provider-selection flow provider-neutral.
- `README.md`
- `.env.example`
  Document OpenAI support and the new `OPENAI_API_KEY`.

### Existing tests to update

- `tests/unit/email-analyzer.spec.ts`
- `tests/unit/archive-ready.spec.ts`
- `tests/unit/calendaring-agent.spec.ts`
- `tests/unit/draft-generator.spec.ts`
- `tests/unit/draft-pipeline.spec.ts`
- `tests/unit/sender-lookup.spec.ts`
- `tests/e2e/settings.spec.ts`
- `tests/e2e/agent-framework.spec.ts`
- `tests/e2e/sender-profile.spec.ts`

## Task 1: Add Provider-Neutral Config And Model Resolution

**Files:**
- Create: `src/main/llm/config.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/main/ipc/settings.ipc.ts`
- Test: `tests/unit/llm-config.spec.ts`

- [ ] **Step 1: Write the failing config-migration test**

```ts
import { test, expect } from "@playwright/test";
import { normalizeLlmConfig, resolveBuiltInProviderId, resolveDefaultAgentProviderId, resolveFeatureModelId } from "../../src/main/llm/config";

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
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `npx playwright test tests/unit/llm-config.spec.ts --project=unit`

Expected: FAIL with `Cannot find module '../../src/main/llm/config'` and missing provider-neutral schema exports.

- [ ] **Step 3: Add the provider-neutral config schema and migration helpers**

```ts
// src/shared/types.ts
export const BUILT_IN_LLM_PROVIDERS = ["anthropic", "openai"] as const;
export const FEATURE_QUALITIES = ["fast", "balanced", "best"] as const;

export const BuiltInLlmProviderIdSchema = z.enum(BUILT_IN_LLM_PROVIDERS);
export type BuiltInLlmProviderId = z.infer<typeof BuiltInLlmProviderIdSchema>;

export const FeatureQualitySchema = z.enum(FEATURE_QUALITIES);
export type FeatureQuality = z.infer<typeof FeatureQualitySchema>;

export const FeatureQualityConfigSchema = z.object({
  analysis: FeatureQualitySchema.default("balanced"),
  drafts: FeatureQualitySchema.default("balanced"),
  refinement: FeatureQualitySchema.default("balanced"),
  calendaring: FeatureQualitySchema.default("balanced"),
  archiveReady: FeatureQualitySchema.default("balanced"),
  senderLookup: FeatureQualitySchema.default("fast"),
  agentDrafter: FeatureQualitySchema.default("balanced"),
  agentChat: FeatureQualitySchema.default("best"),
});

export type FeatureQualityConfig = z.infer<typeof FeatureQualityConfigSchema>;

export const DEFAULT_FEATURE_QUALITY_CONFIG: FeatureQualityConfig = {
  analysis: "balanced",
  drafts: "balanced",
  refinement: "balanced",
  calendaring: "balanced",
  archiveReady: "balanced",
  senderLookup: "fast",
  agentDrafter: "balanced",
  agentChat: "best",
};

export const LlmConfigSchema = z.object({
  defaultProvider: BuiltInLlmProviderIdSchema.default("anthropic"),
  providers: z.object({
    anthropic: z.object({
      apiKey: z.string().optional(),
    }).optional(),
    openai: z.object({
      apiKey: z.string().optional(),
    }).optional(),
  }).default({}),
  featureTiers: FeatureQualityConfigSchema.default(DEFAULT_FEATURE_QUALITY_CONFIG),
});

export type LlmConfig = z.infer<typeof LlmConfigSchema>;

// Add this field to the existing ConfigSchema alongside modelConfig/anthropicApiKey:
llm: LlmConfigSchema.optional(),
```

```ts
// src/main/llm/config.ts
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
```

```ts
// src/main/ipc/settings.ipc.ts
import { normalizeLlmConfig, resolveBuiltInProviderId, resolveDefaultAgentProviderId, resolveFeatureModelId } from "../llm/config";

export function getLlmConfig() {
  return normalizeLlmConfig(getConfig());
}

export function getBuiltInProviderId() {
  return resolveBuiltInProviderId(getConfig());
}

export function getDefaultAgentProviderId() {
  return resolveDefaultAgentProviderId(getConfig());
}

export function getModelIdForFeature(
  feature: keyof FeatureQualityConfig,
  provider = getBuiltInProviderId(),
): string {
  return resolveFeatureModelId(getConfig(), feature, provider);
}
```

- [ ] **Step 4: Run the config-migration test and verify it passes**

Run: `npx playwright test tests/unit/llm-config.spec.ts --project=unit`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the config/model-resolution slice**

```bash
git add src/shared/types.ts src/main/llm/config.ts src/main/ipc/settings.ipc.ts tests/unit/llm-config.spec.ts
git commit -m "refactor: normalize built-in llm config"
```

## Task 2: Add The Shared Built-In LLM Client And OpenAI Adapter

**Files:**
- Modify: `package.json`
- Create: `src/main/llm/types.ts`
- Create: `src/main/llm/providers/anthropic.ts`
- Create: `src/main/llm/providers/openai.ts`
- Create: `src/main/llm/index.ts`
- Create: `tests/mocks/openai-api-mock.ts`
- Create: `tests/mocks/built-in-llm-mock.ts`
- Test: `tests/unit/llm-service.spec.ts`

- [ ] **Step 1: Write the failing built-in LLM adapter tests**

```ts
import { test, expect } from "@playwright/test";
import { AnthropicBuiltInLlmProvider } from "../../src/main/llm/providers/anthropic";
import { OpenAIBuiltInLlmProvider } from "../../src/main/llm/providers/openai";
import { MockAnthropic, mockAnthropicResponse, resetAnthropicMock, getCapturedRequests as getAnthropicRequests } from "../mocks/anthropic-api-mock";
import { MockOpenAI, mockOpenAIResponse, resetOpenAIMock, getCapturedOpenAIRequests } from "../mocks/openai-api-mock";

test.beforeEach(() => {
  resetAnthropicMock();
  resetOpenAIMock();
});

test("Anthropic adapter forwards JSON-mode requests through messages.create", async () => {
  mockAnthropicResponse({ text: '{"ok":true}' });
  const provider = new AnthropicBuiltInLlmProvider(new MockAnthropic() as never);

  await provider.generate({
    model: "claude-sonnet-4-5-20250929",
    input: "return json",
    system: "json only",
    mode: "json",
    maxOutputTokens: 64,
  });

  const requests = getAnthropicRequests();
  expect(requests[0].model).toBe("claude-sonnet-4-5-20250929");
});

test("OpenAI adapter uses Responses API json mode and web search tools", async () => {
  mockOpenAIResponse({ outputText: '{"summary":"ok"}' });
  const provider = new OpenAIBuiltInLlmProvider(new MockOpenAI() as never);

  await provider.generate({
    model: "gpt-5-mini",
    input: "find a sender profile",
    system: "respond in json",
    mode: "json",
    webSearch: true,
    maxOutputTokens: 128,
  });

  const requests = getCapturedOpenAIRequests();
  expect(requests[0].model).toBe("gpt-5-mini");
  expect(requests[0].text).toEqual({ format: { type: "json_object" } });
  expect(requests[0].tools).toEqual([{ type: "web_search" }]);
});
```

- [ ] **Step 2: Run the adapter tests and verify they fail**

Run: `npx playwright test tests/unit/llm-service.spec.ts --project=unit`

Expected: FAIL with missing provider files and missing OpenAI mock.

- [ ] **Step 3: Install the OpenAI SDK and add the provider-neutral client**

Run: `npm install openai`

Expected: `package.json` and `package-lock.json` update with the `openai` dependency.

```ts
// src/main/llm/types.ts
export type BuiltInLlmRequest = {
  model: string;
  input: string;
  system?: string;
  mode?: "text" | "json";
  webSearch?: boolean;
  maxOutputTokens: number;
};

export type BuiltInLlmResponse = {
  text: string;
  requestId?: string;
};

export interface BuiltInLlmProvider {
  generate(request: BuiltInLlmRequest): Promise<BuiltInLlmResponse>;
}

export interface BuiltInLlmClient {
  generate(request: BuiltInLlmRequest): Promise<BuiltInLlmResponse>;
}
```

```ts
// src/main/llm/providers/openai.ts
import OpenAI from "openai";
import type { BuiltInLlmProvider, BuiltInLlmRequest, BuiltInLlmResponse } from "../types";

export class OpenAIBuiltInLlmProvider implements BuiltInLlmProvider {
  constructor(private client: OpenAI) {}

  async generate(request: BuiltInLlmRequest): Promise<BuiltInLlmResponse> {
    const response = await this.client.responses.create({
      model: request.model,
      instructions: request.system,
      input: request.input,
      max_output_tokens: request.maxOutputTokens,
      ...(request.mode === "json" ? { text: { format: { type: "json_object" } } } : {}),
      ...(request.webSearch ? { tools: [{ type: "web_search" }] } : {}),
    });

    return {
      text: response.output_text,
      requestId: response._request_id,
    };
  }
}
```

```ts
// src/main/llm/providers/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import type { BuiltInLlmProvider, BuiltInLlmRequest, BuiltInLlmResponse } from "../types";

export class AnthropicBuiltInLlmProvider implements BuiltInLlmProvider {
  constructor(private client: Anthropic) {}

  async generate(request: BuiltInLlmRequest): Promise<BuiltInLlmResponse> {
    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxOutputTokens,
      ...(request.system
        ? {
            system: [
              {
                type: "text",
                text: request.system,
                cache_control: { type: "ephemeral" },
              },
            ],
          }
        : {}),
      ...(request.webSearch
        ? {
            tools: [
              {
                type: "web_search_20250305",
                name: "web_search",
                max_uses: 1,
              },
            ],
          }
        : {}),
      messages: [{ role: "user", content: request.input }],
    });

    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");

    return { text };
  }
}
```

```ts
// src/main/llm/index.ts
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
```

```ts
// tests/mocks/openai-api-mock.ts
type MockOpenAIResponse = {
  id: string;
  output_text: string;
  output?: Array<Record<string, unknown>>;
  _request_id: string;
};

let capturedOpenAIRequests: Array<Record<string, unknown>> = [];
let queuedOpenAIResponses: Array<MockOpenAIResponse | Error> = [];

export function mockOpenAIResponse({
  id = `resp_${queuedOpenAIResponses.length + 1}`,
  outputText,
  output,
}: {
  id?: string;
  outputText: string;
  output?: Array<Record<string, unknown>>;
}) {
  queuedOpenAIResponses.push({
    id,
    output_text: outputText,
    output,
    _request_id: "req_mock_openai",
  });
}

export function getCapturedOpenAIRequests() {
  return [...capturedOpenAIRequests];
}

export function resetOpenAIMock() {
  capturedOpenAIRequests = [];
  queuedOpenAIResponses = [];
}

export class MockOpenAI {
  responses = {
    create: async (params: Record<string, unknown>) => {
      capturedOpenAIRequests.push(params);
      const next = queuedOpenAIResponses.shift();
      if (!next) throw new Error("[MockOpenAI] No response configured");
      if (next instanceof Error) throw next;
      return next;
    },
  };
}
```

```ts
// tests/mocks/built-in-llm-mock.ts
import type { BuiltInLlmClient, BuiltInLlmRequest, BuiltInLlmResponse } from "../../src/main/llm/types";

export class MockBuiltInLlmClient implements BuiltInLlmClient {
  calls: BuiltInLlmRequest[] = [];
  private queue: BuiltInLlmResponse[] = [];

  push(text: string) {
    this.queue.push({ text, requestId: `req_${this.queue.length + 1}` });
    return this;
  }

  async generate(request: BuiltInLlmRequest): Promise<BuiltInLlmResponse> {
    this.calls.push(request);
    const next = this.queue.shift();
    if (!next) throw new Error("[MockBuiltInLlmClient] No response queued");
    return next;
  }
}
```

- [ ] **Step 4: Run the adapter tests and verify they pass**

Run: `npx playwright test tests/unit/llm-service.spec.ts --project=unit`

Expected: PASS with Anthropic and OpenAI adapter tests green.

- [ ] **Step 5: Commit the shared built-in LLM client**

```bash
git add package.json package-lock.json src/main/llm src/main/llm/providers tests/mocks/openai-api-mock.ts tests/mocks/built-in-llm-mock.ts tests/unit/llm-service.spec.ts
git commit -m "feat: add shared built-in llm adapters"
```

## Task 3: Migrate Structured Analyzers And Memory Classification

**Files:**
- Modify: `src/main/services/email-analyzer.ts`
- Modify: `src/main/services/archive-ready-analyzer.ts`
- Modify: `src/main/services/calendaring-agent.ts`
- Modify: `src/main/ipc/analysis.ipc.ts`
- Modify: `src/main/ipc/archive-ready.ipc.ts`
- Modify: `src/main/services/prefetch-service.ts`
- Modify: `src/main/ipc/memory.ipc.ts`
- Test: `tests/unit/email-analyzer.spec.ts`
- Test: `tests/unit/archive-ready.spec.ts`
- Test: `tests/unit/calendaring-agent.spec.ts`

- [ ] **Step 1: Rewrite the failing service tests to target the built-in LLM client**

```ts
// tests/unit/email-analyzer.spec.ts
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";

function createAnalyzerWithMock(prompt?: string) {
  const llm = new MockBuiltInLlmClient().push('{"needs_reply": true, "reason": "Direct question", "priority": "high"}');
  const analyzer = new EmailAnalyzer("claude-sonnet-4-20250514", prompt, llm);
  return { analyzer, llm };
}

test("analyze() routes through generate() in json mode", async () => {
  const { analyzer, llm } = createAnalyzerWithMock();
  await analyzer.analyze(makeEmail(), "user@company.com");

  expect(llm.calls).toHaveLength(1);
  expect(llm.calls[0].mode).toBe("json");
  expect(llm.calls[0].model).toBe("claude-sonnet-4-20250514");
});
```

```ts
// tests/unit/calendaring-agent.spec.ts
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";

test("CalendaringAgent uses json mode through the built-in llm client", async () => {
  const llm = new MockBuiltInLlmClient().push('{"hasSchedulingContext":true,"action":"defer_to_ea","reason":"meeting request"}');
  const agent = new CalendaringAgent("claude-sonnet-4-20250514", undefined, llm);

  const result = await agent.analyze({
    id: "e1",
    threadId: "t1",
    from: "alice@example.com",
    to: "user@example.com",
    subject: "Can we meet tomorrow?",
    body: "Are you free at 2pm tomorrow?",
    date: "2026-03-31T10:00:00Z",
  });

  expect(result.hasSchedulingContext).toBe(true);
  expect(llm.calls[0].mode).toBe("json");
});
```

- [ ] **Step 2: Run the analyzer tests and verify they fail**

Run: `npx playwright test tests/unit/email-analyzer.spec.ts tests/unit/archive-ready.spec.ts tests/unit/calendaring-agent.spec.ts --project=unit`

Expected: FAIL with constructor-signature errors because the services do not yet accept the built-in LLM mock.

- [ ] **Step 3: Inject the provider-neutral client into the structured analyzers**

```ts
// src/main/services/email-analyzer.ts
import type { BuiltInLlmClient } from "../llm/types";

export class EmailAnalyzer {
  constructor(
    private model: string = "claude-sonnet-4-20250514",
    prompt?: string,
    private llm: BuiltInLlmClient,
  ) {
    this.customPrompt = prompt && prompt !== DEFAULT_ANALYSIS_PROMPT ? prompt : null;
  }

  async analyze(email: Email, userEmail?: string, accountId?: string): Promise<AnalysisResult> {
    const { text } = await this.llm.generate({
      model: this.model,
      system: systemPrompt,
      input: `${userIdentityLine}From: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${emailContent}${analysisMemoryContext}`,
      mode: "json",
      maxOutputTokens: 256,
    });

    const parsed = JSON.parse(stripJsonFences(text));
    return AnalysisResultSchema.parse(parsed);
  }
}
```

```ts
// src/main/services/archive-ready-analyzer.ts
import type { BuiltInLlmClient } from "../llm/types";

export class ArchiveReadyAnalyzer {
  constructor(
    private model: string = "claude-sonnet-4-20250514",
    prompt?: string,
    private llm: BuiltInLlmClient,
  ) {
    this.customPrompt = prompt && prompt !== DEFAULT_ARCHIVE_READY_PROMPT ? prompt : null;
  }

  async analyzeThread(threadEmails: DashboardEmail[], userEmail?: string): Promise<ArchiveReadyResult> {
    const { text } = await this.llm.generate({
      model: this.model,
      system: systemPrompt,
      input: this.formatThreadForAnalysis(threadEmails, userEmail),
      mode: "json",
      maxOutputTokens: 256,
    });

    return ArchiveReadyResultSchema.parse(JSON.parse(stripJsonFences(text)));
  }
}
```

```ts
// src/main/services/calendaring-agent.ts
import type { BuiltInLlmClient } from "../llm/types";

export class CalendaringAgent {
  constructor(
    private model: string = "claude-sonnet-4-20250514",
    prompt?: string,
    private llm: BuiltInLlmClient,
  ) {
    this.prompt = prompt || DEFAULT_CALENDARING_PROMPT;
  }

  async analyze(email: Email): Promise<CalendaringResult> {
    const { text } = await this.llm.generate({
      model: this.model,
      input: `${this.prompt}\n\n---\nEMAIL TO ANALYZE:\n\nFrom: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`,
      mode: "json",
      maxOutputTokens: 512,
    });

    const parsed = JSON.parse(stripJsonFences(text));
    return {
      hasSchedulingContext: Boolean(parsed.hasSchedulingContext),
      action: parsed.action || "none",
      reason: parsed.reason || "",
    };
  }
}
```

```ts
// src/main/ipc/analysis.ipc.ts
import { createBuiltInLlmClient } from "../llm";

function getAnalyzer(): EmailAnalyzer {
  if (!analyzer) {
    const config = getConfig();
    analyzer = new EmailAnalyzer(
      getModelIdForFeature("analysis"),
      config.analysisPrompt,
      createBuiltInLlmClient(config),
    );
  }
  return analyzer;
}
```

```ts
// src/main/ipc/archive-ready.ipc.ts
import { createBuiltInLlmClient } from "../llm";

function getAnalyzer(): ArchiveReadyAnalyzer {
  if (!analyzer) {
    const config = getConfig();
    analyzer = new ArchiveReadyAnalyzer(
      getModelIdForFeature("archiveReady"),
      config.archiveReadyPrompt,
      createBuiltInLlmClient(config),
    );
  }
  return analyzer;
}
```

```ts
// src/main/services/prefetch-service.ts
import { createBuiltInLlmClient } from "../llm";

if (!this.analyzer) {
  const config = getConfig();
  this.analyzer = new EmailAnalyzer(
    getModelIdForFeature("analysis"),
    config.analysisPrompt,
    createBuiltInLlmClient(config),
  );
}

if (!this.archiveReadyAnalyzer) {
  const config = getConfig();
  this.archiveReadyAnalyzer = new ArchiveReadyAnalyzer(
    getModelIdForFeature("archiveReady"),
    config.archiveReadyPrompt,
    createBuiltInLlmClient(config),
  );
}
```

```ts
// src/main/ipc/memory.ipc.ts
import { createBuiltInLlmClient } from "../llm";

const config = getConfig();
const llm = createBuiltInLlmClient(config);
const response = await llm.generate({
  model: getModelIdForFeature("analysis"),
  input: `Classify this email preference/feedback into a scope for future application.\n\nFeedback: "${content}"\nSender email: ${senderEmail}\nSender domain: ${senderDomain}\n\nRespond in JSON only: {"scope":"person","scopeValue":"alice@example.com","content":"Prefer concise replies"}`,
  mode: "json",
  maxOutputTokens: 256,
});

const parsed = JSON.parse(response.text.slice(jsonStart, jsonEnd + 1));
```

- [ ] **Step 4: Run the structured-analyzer tests and verify they pass**

Run: `npx playwright test tests/unit/email-analyzer.spec.ts tests/unit/archive-ready.spec.ts tests/unit/calendaring-agent.spec.ts --project=unit`

Expected: PASS with the analyzer tests green and no direct Anthropic mock injection left in those files.

- [ ] **Step 5: Commit the structured-analyzer migration**

```bash
git add src/main/services/email-analyzer.ts src/main/services/archive-ready-analyzer.ts src/main/services/calendaring-agent.ts src/main/ipc/analysis.ipc.ts src/main/ipc/archive-ready.ipc.ts src/main/services/prefetch-service.ts src/main/ipc/memory.ipc.ts tests/unit/email-analyzer.spec.ts tests/unit/archive-ready.spec.ts tests/unit/calendaring-agent.spec.ts
git commit -m "refactor: route structured analyzers through llm client"
```

## Task 4: Migrate Drafting, Refinement, And Draft Pipeline Flows

**Files:**
- Modify: `src/main/services/draft-generator.ts`
- Modify: `src/main/services/draft-pipeline.ts`
- Modify: `src/main/agents/agent-coordinator.ts`
- Modify: `src/main/ipc/drafts.ipc.ts`
- Test: `tests/unit/draft-generator.spec.ts`
- Test: `tests/unit/draft-pipeline.spec.ts`
- Test: `tests/unit/forward-drafts.spec.ts`

- [ ] **Step 1: Write the failing draft-service tests against the built-in LLM mock**

```ts
// tests/unit/draft-generator.spec.ts
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";

test("generateDraft() uses text mode through the built-in llm client", async () => {
  const llm = new MockBuiltInLlmClient().push("Sounds good — I'll review it today.");
  const generator = new DraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, "claude-sonnet-4-20250514", llm);

  const result = await generator.generateDraft(makeEmail(), {
    needs_reply: true,
    reason: "Direct request",
    priority: "medium",
  }, undefined, { userEmail: "user@company.com" });

  expect(result.body).toContain("Sounds good");
  expect(llm.calls[0].mode).toBe("text");
  expect(llm.calls[0].model).toBe("claude-sonnet-4-20250514");
});
```

```ts
// tests/unit/draft-pipeline.spec.ts
test("generateDraftForEmail() preserves feature-specific model resolution", async () => {
  const llm = new MockBuiltInLlmClient()
    .push('{"needs_reply":true,"reason":"needs reply","priority":"medium"}')
    .push("Happy to — I'll send comments shortly.");

  const result = await generateDraftForEmail({
    emailId: "email-1",
    accountId: "acct-1",
    llm,
  });

  expect(result.body).toContain("Happy to");
  expect(llm.calls.map((call) => call.mode)).toEqual(["json", "text"]);
});
```

- [ ] **Step 2: Run the draft tests and verify they fail**

Run: `npx playwright test tests/unit/draft-generator.spec.ts tests/unit/draft-pipeline.spec.ts tests/unit/forward-drafts.spec.ts --project=unit`

Expected: FAIL with constructor-signature errors and missing `llm` option support in the draft pipeline.

- [ ] **Step 3: Move draft generation and refinement onto the provider-neutral client**

```ts
// src/main/services/draft-generator.ts
import type { BuiltInLlmClient } from "../llm/types";

export class DraftGenerator {
  constructor(
    private model: string = "claude-sonnet-4-20250514",
    prompt: string = DEFAULT_DRAFT_PROMPT,
    calendaringModel?: string,
    private llm: BuiltInLlmClient,
  ) {
    this.calendaringModel = calendaringModel ?? model;
    this.prompt = prompt + DRAFT_FORMAT_SUFFIX;
  }

  async generateDraft(email: Email, analysis: AnalysisResult, eaConfig?: EAConfig, options?: { enableSenderLookup?: boolean; userEmail?: string }) {
    const calAgent = new CalendaringAgent(this.calendaringModel, undefined, this.llm);
    const response = await this.llm.generate({
      model: this.model,
      input: `${this.prompt}\n${senderContext}\n${calendaringContext}\n---\nANALYSIS (for context):\nReason for reply: ${analysis.reason}\nPriority: ${analysis.priority || "medium"}\n\n---\nORIGINAL EMAIL:\n\nFrom: ${email.from}\nTo: ${email.to}\nSubject: ${email.subject}\nDate: ${email.date}\n\n${email.body}`,
      mode: "text",
      maxOutputTokens: 1024,
    });

    return {
      body: response.text.trim(),
      cc: cc.length > 0 ? cc : undefined,
      calendaringResult,
    };
  }
}
```

```ts
// src/main/services/draft-pipeline.ts
export interface GenerateDraftOptions {
  emailId: string;
  accountId?: string;
  instructions?: string;
  llm?: BuiltInLlmClient;
}

const llm = opts.llm ?? createBuiltInLlmClient(config);
const generator = new DraftGenerator(
  getModelIdForFeature("drafts"),
  prompt,
  getModelIdForFeature("calendaring"),
  llm,
);

const analyzer = new EmailAnalyzer(
  getModelIdForFeature("analysis"),
  config.analysisPrompt ?? undefined,
  llm,
);

const instructedGenerator = new DraftGenerator(
  getModelIdForFeature("drafts"),
  `${prompt}\n\nADDITIONAL INSTRUCTIONS:\n${instructions}`,
  getModelIdForFeature("calendaring"),
  llm,
);
```

```ts
// src/main/agents/agent-coordinator.ts
const config = getConfig();
const llm = createBuiltInLlmClient(config);
const generator = new DraftGenerator(
  getModelIdForFeature("drafts"),
  prompt,
  getModelIdForFeature("calendaring"),
  llm,
);
```

```ts
// src/main/ipc/drafts.ipc.ts
const llm = createBuiltInLlmClient(config);
const response = await llm.generate({
  model: getModelIdForFeature("refinement"),
  input: `Refine this email draft based on the feedback provided.\n${memorySection}\nORIGINAL EMAIL BEING REPLIED TO:\nFrom: ${email.from}\nSubject: ${email.subject}\n---\n${email.body}\n---\n\nCURRENT DRAFT:\n${currentDraft}\n---\n\nFEEDBACK TO INCORPORATE:\n${critique}`,
  mode: "text",
  maxOutputTokens: 1024,
});

const refinedDraft = response.text.trim();
```

- [ ] **Step 4: Run the draft tests and verify they pass**

Run: `npx playwright test tests/unit/draft-generator.spec.ts tests/unit/draft-pipeline.spec.ts tests/unit/forward-drafts.spec.ts --project=unit`

Expected: PASS with reply, forward, and pipeline tests green.

- [ ] **Step 5: Commit the drafting-flow migration**

```bash
git add src/main/services/draft-generator.ts src/main/services/draft-pipeline.ts src/main/agents/agent-coordinator.ts src/main/ipc/drafts.ipc.ts tests/unit/draft-generator.spec.ts tests/unit/draft-pipeline.spec.ts tests/unit/forward-drafts.spec.ts
git commit -m "refactor: route drafting flows through llm client"
```

## Task 5: Route Memory-Learning Prompts Through The Shared LLM Client

**Files:**
- Modify: `src/main/services/draft-edit-learner.ts`
- Modify: `src/main/services/analysis-edit-learner.ts`
- Modify: `src/main/ipc/compose.ipc.ts`
- Modify: `src/main/ipc/analysis.ipc.ts`
- Create: `tests/unit/draft-edit-learner.spec.ts`
- Create: `tests/unit/analysis-edit-learner.spec.ts`

- [ ] **Step 1: Write the failing learner tests**

```ts
import { test, expect } from "@playwright/test";
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";
import { extractPriorityPreferences } from "../../src/main/services/analysis-edit-learner";

test("analysis learner uses the shared llm client instead of constructing Anthropic directly", async () => {
  const llm = new MockBuiltInLlmClient().push('[{"content":"Treat investor emails as high priority","scope":"category","scopeValue":"investor"}]');

  const preferences = await extractPriorityPreferences({
    llm,
    model: "gpt-5.2",
    email: {
      from: "Investor <investor@example.com>",
      subject: "Board deck feedback",
      body: "Please reply by EOD.",
    },
    override: {
      originalPriority: "low",
      newPriority: "high",
    },
  });

  expect(preferences).toHaveLength(1);
  expect(llm.calls[0].mode).toBe("json");
});
```

- [ ] **Step 2: Run the learner tests and verify they fail**

Run: `npx playwright test tests/unit/draft-edit-learner.spec.ts tests/unit/analysis-edit-learner.spec.ts --project=unit`

Expected: FAIL with missing exported helper and direct Anthropic construction still in the learner modules.

- [ ] **Step 3: Extract a shared learner-call helper and migrate both learners**

```ts
// src/main/services/analysis-edit-learner.ts
import type { BuiltInLlmClient } from "../llm/types";

async function runLearnerJsonPrompt<T>(
  llm: BuiltInLlmClient,
  model: string,
  input: string,
): Promise<T> {
  const response = await llm.generate({
    model,
    input,
    mode: "json",
    maxOutputTokens: 1024,
  });

  return JSON.parse(response.text) as T;
}

export async function extractPriorityPreferences(args: {
  llm: BuiltInLlmClient;
  model: string;
  email: { from: string; subject: string; body: string };
  override: { originalPriority: string | null; newPriority: string | null };
}) {
  return runLearnerJsonPrompt<Array<{ content: string; scope: string; scopeValue: string | null }>>(
    args.llm,
    args.model,
    `Extract the durable priority preference from this override.\n\nFrom: ${args.email.from}\nSubject: ${args.email.subject}\nBody: ${args.email.body}\nOriginal priority: ${args.override.originalPriority}\nNew priority: ${args.override.newPriority}`,
  );
}
```

```ts
// src/main/services/draft-edit-learner.ts
async function analyzeDraftEdit(params: {
  originalDraft: string;
  sentBody: string;
  senderEmail: string;
  senderDomain: string;
  subject: string;
}, deps: {
  llm: BuiltInLlmClient;
  model: string;
}) {
  const llm = deps.llm;
const observations = await runLearnerJsonPrompt<Array<{
  content: string;
  scope: "person" | "domain" | "category" | "global";
  scopeValue: string | null;
}>>(
  llm,
  deps.model,
  `Extract durable writing preferences from this before/after draft edit.\n\nOriginal draft:\n${before}\n\nSent draft:\n${after}`,
);
```

```ts
// src/main/ipc/compose.ipc.ts
const config = getConfig();
const llm = createBuiltInLlmClient(config);
learnFromDraftEdit(
  {
    threadId: options.threadId,
    accountId: options.accountId,
    sentBodyHtml: options.bodyHtml || "",
    sentBodyText: options.bodyText,
  },
  {
    llm,
    model: getModelIdForFeature("drafts"),
  },
);
```

```ts
// src/main/ipc/analysis.ipc.ts
const config = getConfig();
const llm = createBuiltInLlmClient(config);
const preferences = await extractPriorityPreferences({
  llm,
  model: getModelIdForFeature("analysis"),
  email: {
    from: email.from,
    subject: email.subject,
    body: bodySnippet,
  },
  override: {
    originalPriority,
    newPriority,
  },
});
```

- [ ] **Step 4: Run the learner tests and verify they pass**

Run: `npx playwright test tests/unit/draft-edit-learner.spec.ts tests/unit/analysis-edit-learner.spec.ts --project=unit`

Expected: PASS with both learners routing through the built-in LLM client.

- [ ] **Step 5: Commit the learner migration**

```bash
git add src/main/services/draft-edit-learner.ts src/main/services/analysis-edit-learner.ts src/main/ipc/compose.ipc.ts src/main/ipc/analysis.ipc.ts tests/unit/draft-edit-learner.spec.ts tests/unit/analysis-edit-learner.spec.ts
git commit -m "refactor: route learning prompts through llm client"
```

## Task 6: Make Sender Lookup Provider-Neutral

**Files:**
- Modify: `src/extensions/mail-ext-web-search/src/index.ts`
- Modify: `src/extensions/mail-ext-web-search/src/web-search-provider.ts`
- Test: `tests/unit/sender-lookup.spec.ts`
- Test: `tests/e2e/sender-profile.spec.ts`

- [ ] **Step 1: Write the failing sender-lookup tests for a provider-neutral search callback**

```ts
// tests/unit/sender-lookup.spec.ts
test("createWebSearchProvider uses injected searchWeb callback instead of constructing Anthropic directly", async () => {
  const calls: Array<{ model: string; prompt: string }> = [];
  const provider = createWebSearchProvider(
    makeContext(),
    {
      resolveModel: () => "gpt-5-nano",
      searchWeb: async ({ model, prompt }) => {
        calls.push({ model, prompt });
        return '{"name":"Alice","summary":"Founder at Acme","company":"Acme","title":"Founder"}';
      },
    },
  );

  const enrichment = await provider.enrich(makeEmail(), [makeEmail()]);
  expect(enrichment?.data.name).toBe("Alice");
  expect(calls[0].model).toBe("gpt-5-nano");
});
```

- [ ] **Step 2: Run the sender-lookup tests and verify they fail**

Run: `npx playwright test tests/unit/sender-lookup.spec.ts --project=unit`

Expected: FAIL because `createWebSearchProvider()` still expects only the old model-resolver callback and constructs `new Anthropic()`.

- [ ] **Step 3: Inject provider-neutral web search from the extension entry point**

```ts
// src/extensions/mail-ext-web-search/src/index.ts
import { createBuiltInLlmClient } from "../../../main/llm";
import { getConfig, getModelIdForFeature } from "../../../main/ipc/settings.ipc";

const extension: ExtensionModule = {
  async activate(context: ExtensionContext, api: ExtensionAPI): Promise<void> {
    const provider = createWebSearchProvider(context, {
      resolveModel: () => getModelIdForFeature("senderLookup"),
      searchWeb: async ({ model, prompt }) => {
        const llm = createBuiltInLlmClient(getConfig());
        const response = await llm.generate({
          model,
          input: prompt,
          mode: "json",
          webSearch: true,
          maxOutputTokens: 200,
        });
        return response.text;
      },
    });

    api.registerEnrichmentProvider(provider);
  },
};
```

```ts
// src/extensions/mail-ext-web-search/src/web-search-provider.ts
type SearchDeps = {
  resolveModel: () => string;
  searchWeb: (args: { model: string; prompt: string }) => Promise<string>;
};

export function createWebSearchProvider(
  context: ExtensionContext,
  deps: SearchDeps,
): EnrichmentProvider {
  return {
    id: "sender-lookup",
    panelId: "sender-profile",
    priority: 100,
    async enrich(email, threadEmails) {
      const prompt = `I received an email from "${senderName}" with email address "${realSenderEmail}".\n\nPlease search the web to find information about who this person is.\n\nRespond with only valid JSON.`;
      const jsonText = await deps.searchWeb({
        model: deps.resolveModel(),
        prompt,
      });

      const profileData = parseProfileResponse(jsonText, senderName, context);
      return {
        extensionId: "web-search",
        panelId: "sender-profile",
        data: profileData,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      };
    },
  };
}
```

- [ ] **Step 4: Run the sender-lookup unit test and the sidebar e2e test**

Run: `npx playwright test tests/unit/sender-lookup.spec.ts --project=unit`

Expected: PASS with sender lookup no longer requiring the Anthropic SDK directly.

Run: `npx playwright test tests/e2e/sender-profile.spec.ts --project=e2e`

Expected: PASS with the sender-profile sidebar still rendering in demo mode.

- [ ] **Step 5: Commit the sender-lookup migration**

```bash
git add src/extensions/mail-ext-web-search/src/index.ts src/extensions/mail-ext-web-search/src/web-search-provider.ts tests/unit/sender-lookup.spec.ts tests/e2e/sender-profile.spec.ts
git commit -m "refactor: make sender lookup provider-neutral"
```

## Task 7: Add The OpenAI Agent Provider And Backend Default Selection

**Files:**
- Create: `src/main/agents/providers/openai-agent-provider.ts`
- Modify: `src/main/agents/types.ts`
- Modify: `src/main/agents/orchestrator.ts`
- Modify: `src/main/agents/agent-coordinator.ts`
- Modify: `src/main/ipc/agent.ipc.ts`
- Modify: `src/main/ipc/settings.ipc.ts`
- Modify: `src/main/services/prefetch-service.ts`
- Modify: `src/main/ipc/drafts.ipc.ts`
- Test: `tests/unit/openai-agent-provider.spec.ts`

- [ ] **Step 1: Write the failing OpenAI agent-provider tests**

```ts
import { test, expect } from "@playwright/test";
import { OpenAIAgentProvider } from "../../src/main/agents/providers/openai-agent-provider";
import { z } from "zod";
import { MockOpenAI, mockOpenAIResponse, getCapturedOpenAIRequests, resetOpenAIMock } from "../mocks/openai-api-mock";

test.beforeEach(() => resetOpenAIMock());

test("OpenAIAgentProvider is unavailable when no API key is configured", async () => {
  const provider = new OpenAIAgentProvider({ model: "gpt-5.2", openaiApiKey: undefined });
  await expect(provider.isAvailable()).resolves.toBe(false);
});

test("OpenAIAgentProvider emits text_delta for a simple response", async () => {
  mockOpenAIResponse({ outputText: "Here is a draft reply." });
  const provider = new OpenAIAgentProvider({
    model: "gpt-5.2",
    openaiApiKey: "sk-openai-test",
  }, new MockOpenAI() as never);

  const events: string[] = [];
  for await (const event of provider.run({
    taskId: "task-1",
    prompt: "Draft a reply",
    context: {
      accountId: "acct-1",
      userEmail: "user@example.com",
      providerConversationIds: {},
    },
    tools: [],
    toolExecutor: async () => null,
    netFetch: async () => ({ status: 200, headers: {}, body: "" }),
    signal: new AbortController().signal,
  })) {
    if (event.type === "text_delta") events.push(event.text);
  }

  expect(events.join("")).toContain("draft reply");
});

test("OpenAIAgentProvider executes tool calls and chains previous_response_id", async () => {
  mockOpenAIResponse({
    id: "resp_1",
    outputText: "",
    output: [
      {
        type: "function_call",
        name: "search_emails",
        call_id: "call_1",
        arguments: '{"query":"from:alice@example.com"}',
      },
    ],
  });
  mockOpenAIResponse({ id: "resp_2", outputText: "I found 3 related threads." });

  const provider = new OpenAIAgentProvider({
    model: "gpt-5.2",
    openaiApiKey: "sk-openai-test",
  }, new MockOpenAI() as never);

  const toolCalls: Array<{ name: string; args: Record<string, unknown> }> = [];

  for await (const _event of provider.run({
    taskId: "task-2",
    prompt: "Find related threads",
    context: {
      accountId: "acct-1",
      userEmail: "user@example.com",
      providerConversationIds: {},
    },
    tools: [
      {
        name: "search_emails",
        description: "Search the inbox",
        inputSchema: z.object({ query: z.string() }),
      },
    ],
    toolExecutor: async (name, args) => {
      toolCalls.push({ name, args });
      return { count: 3 };
    },
    netFetch: async () => ({ status: 200, headers: {}, body: "" }),
    signal: new AbortController().signal,
  })) {}

  const requests = getCapturedOpenAIRequests();
  expect(toolCalls).toEqual([{ name: "search_emails", args: { query: "from:alice@example.com" } }]);
  expect(requests[1].previous_response_id).toBe("resp_1");
});
```

- [ ] **Step 2: Run the agent-provider test and verify it fails**

Run: `npx playwright test tests/unit/openai-agent-provider.spec.ts --project=unit`

Expected: FAIL with missing provider file and missing `openaiApiKey` support in `AgentFrameworkConfig`.

- [ ] **Step 3: Register OpenAI in the existing agent-provider pipeline and switch backend defaults to the configured built-in provider**

```ts
// src/main/agents/types.ts
export interface AgentFrameworkConfig {
  model: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  providers?: Record<string, ProviderSettings>;
  browserConfig?: {
    enabled: boolean;
    chromeDebugPort: number;
    chromeProfilePath?: string;
  };
  mcpServers?: Record<string, McpServerConfig>;
}
```

```ts
// src/main/agents/providers/openai-agent-provider.ts
import OpenAI from "openai";
import { z } from "zod";
import type { AgentFrameworkConfig, AgentProvider, AgentProviderConfig, AgentRunParams, AgentRunResult, AgentEvent } from "../types";

export class OpenAIAgentProvider implements AgentProvider {
  readonly config: AgentProviderConfig = {
    id: "openai",
    name: "OpenAI",
    description: "OpenAI Responses API with function-tool support",
    auth: { type: "api_key", configKey: "OPENAI_API_KEY" },
  };

  private client: OpenAI;
  private inFlight = new Map<string, AbortController>();

  constructor(private frameworkConfig: AgentFrameworkConfig, client?: OpenAI) {
    this.client = client ?? new OpenAI({ apiKey: frameworkConfig.openaiApiKey });
  }

  updateConfig(config: Partial<AgentFrameworkConfig>): void {
    this.frameworkConfig = { ...this.frameworkConfig, ...config };
    this.client = new OpenAI({ apiKey: this.frameworkConfig.openaiApiKey });
  }

  async *run(params: AgentRunParams): AsyncGenerator<AgentEvent, AgentRunResult, void> {
    if (!this.frameworkConfig.openaiApiKey) {
      yield { type: "error", message: "OPENAI_NOT_CONFIGURED" };
      return { state: "failed" };
    }

    yield { type: "state", state: "running" };

    const controller = new AbortController();
    this.inFlight.set(params.taskId, controller);
    params.signal.addEventListener("abort", () => controller.abort(), { once: true });

    let previousResponseId = params.context.providerConversationIds?.openai;
    let input: Array<Record<string, unknown>> = [{ role: "user", content: [{ type: "input_text", text: params.prompt }] }];
    const tools = params.tools.map((tool) => ({
      type: "function" as const,
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.inputSchema),
    }));

    try {
      while (true) {
        const response = await this.client.responses.create({
          model: params.modelOverride ?? this.frameworkConfig.model,
          input,
          previous_response_id: previousResponseId,
          tools,
          parallel_tool_calls: false,
          signal: controller.signal,
        });

        previousResponseId = response.id;

        if (response.output_text) {
          yield { type: "text_delta", text: response.output_text };
        }

        const functionCalls = (response.output ?? []).filter((item): item is {
          type: "function_call";
          name: string;
          call_id: string;
          arguments: string;
        } => item.type === "function_call");

        if (functionCalls.length === 0) {
          yield { type: "done", summary: "Completed" };
          return { state: "completed", providerTaskId: response.id };
        }

        input = [];
        for (const call of functionCalls) {
          const args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
          yield { type: "tool_call_start", toolName: call.name, toolCallId: call.call_id, input: args };
          const result = await params.toolExecutor(call.name, args);
          yield { type: "tool_call_end", toolCallId: call.call_id, result };
          input.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: JSON.stringify(result),
          });
        }
      }
    } finally {
      this.inFlight.delete(params.taskId);
    }
  }

  cancel(taskId: string): void {
    this.inFlight.get(taskId)?.abort();
    this.inFlight.delete(taskId);
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.frameworkConfig.openaiApiKey);
  }
}
```

```ts
// src/main/agents/orchestrator.ts
import { OpenAIAgentProvider } from "./providers/openai-agent-provider";

this.providerRegistry.register(new ClaudeAgentProvider(deps.config));
this.providerRegistry.register(new OpenAIAgentProvider(deps.config));
this.providerRegistry.register(new OpenClawAgentProvider({
  enabled: ocSettings?.enabled ?? false,
  gatewayUrl: ocSettings?.gatewayUrl ?? "",
  gatewayToken: ocSettings?.gatewayToken ?? "",
}));
```

```ts
// src/main/agents/agent-coordinator.ts
const llmConfig = getLlmConfig();
const baseConfig: AgentFrameworkConfig = {
  model: getModelIdForFeature("agentDrafter", llmConfig.defaultProvider),
  anthropicApiKey: llmConfig.providers.anthropic.apiKey,
  openaiApiKey: llmConfig.providers.openai.apiKey,
  browserConfig: browser ? {
    enabled: browser.enabled,
    chromeDebugPort: browser.chromeDebugPort,
    chromeProfilePath: browser.chromeProfilePath,
  } : undefined,
  mcpServers: appConfig.mcpServers,
  providers: {
    "openclaw-agent": {
      enabled: appConfig.openclaw?.enabled ?? false,
      gatewayUrl: appConfig.openclaw?.gatewayUrl ?? "",
      gatewayToken: appConfig.openclaw?.gatewayToken ?? "",
    },
  },
};
```

```ts
// src/main/services/prefetch-service.ts
import { getDefaultAgentProviderId } from "../ipc/settings.ipc";

await agentCoordinator.runAgent(taskId, [getDefaultAgentProviderId()], prompt, context);
```

```ts
// src/main/ipc/drafts.ipc.ts
await agentCoordinator.runAgent(taskId, [getDefaultAgentProviderId()], prompt, context);
```

- [ ] **Step 4: Run the agent-provider unit test and verify it passes**

Run: `npx playwright test tests/unit/openai-agent-provider.spec.ts --project=unit`

Expected: PASS with OpenAI provider availability, text emission, and tool-call chaining covered.

- [ ] **Step 5: Commit the OpenAI agent-provider backend**

```bash
git add src/main/agents/providers/openai-agent-provider.ts src/main/agents/types.ts src/main/agents/orchestrator.ts src/main/agents/agent-coordinator.ts src/main/ipc/agent.ipc.ts src/main/ipc/settings.ipc.ts src/main/services/prefetch-service.ts src/main/ipc/drafts.ipc.ts tests/unit/openai-agent-provider.spec.ts
git commit -m "feat: add openai agent provider"
```

## Task 8: Update Settings, Onboarding, And Renderer Defaults

**Files:**
- Modify: `src/main/ipc/gmail.ipc.ts`
- Modify: `src/main/ipc/settings.ipc.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/components/SettingsPanel.tsx`
- Modify: `src/renderer/components/SetupWizard.tsx`
- Modify: `src/renderer/components/AgentCommandPalette.tsx`
- Modify: `src/renderer/components/AgentPanel.tsx`
- Modify: `src/renderer/components/EmailPreviewSidebar.tsx`
- Modify: `src/renderer/store/index.ts`
- Modify: `src/renderer/App.tsx`
- Modify: `README.md`
- Modify: `.env.example`
- Test: `tests/e2e/settings.spec.ts`
- Test: `tests/e2e/agent-framework.spec.ts`

- [ ] **Step 1: Write the failing settings/onboarding e2e assertions**

```ts
// tests/e2e/settings.spec.ts
test("General settings can switch the built-in provider between Anthropic and OpenAI", async () => {
  await page.locator("button[title='Settings']").click();
  await page.locator("button").filter({ hasText: /^General$/ }).click();

  await expect(page.locator("text=LLM Provider")).toBeVisible();
  await page.getByRole("combobox", { name: "LLM Provider" }).selectOption("openai");
  await expect(page.locator("text=OpenAI API Key")).toBeVisible();
});
```

```ts
// tests/e2e/agent-framework.spec.ts
test("Cmd+J defaults to the configured built-in provider instead of hardcoding claude", async () => {
  await page.keyboard.press("Meta+,");
  await page.locator("button:has-text('General')").click();
  await page.getByRole("combobox", { name: "LLM Provider" }).selectOption("openai");
  await page.keyboard.press("Escape");

  await page.keyboard.press("Meta+j");
  await expect(page.locator("text=OpenAI")).toBeVisible();
});
```

- [ ] **Step 2: Run the renderer e2e tests and verify they fail**

Run: `npx playwright test tests/e2e/settings.spec.ts tests/e2e/agent-framework.spec.ts --project=e2e`

Expected: FAIL because the settings UI still shows Claude-only model copy and the command palette still auto-selects `claude`.

- [ ] **Step 3: Persist provider-neutral auth state and update the renderer flow**

```ts
// src/main/ipc/gmail.ipc.ts
ipcMain.handle(
  "gmail:check-auth",
  async (): Promise<IpcResponse<{
    hasCredentials: boolean;
    hasTokens: boolean;
    defaultProvider: BuiltInLlmProviderId;
    hasDefaultBuiltInProviderAuth: boolean;
    configuredProviders: BuiltInLlmProviderId[];
  }>> => {
    const llm = getLlmConfig();
    const configuredProviders = (["anthropic", "openai"] as const).filter((provider) => {
      if (provider === "anthropic") return Boolean(llm.providers.anthropic.apiKey);
      return Boolean(llm.providers.openai.apiKey);
    });

    return {
      success: true,
      data: {
        hasCredentials: client.hasCredentials(),
        hasTokens: client.hasTokens(),
        defaultProvider: llm.defaultProvider,
        hasDefaultBuiltInProviderAuth: configuredProviders.includes(llm.defaultProvider),
        configuredProviders,
      },
    };
  },
);
```

```ts
// src/main/ipc/settings.ipc.ts
ipcMain.handle(
  "settings:validate-provider-api-key",
  async (_, { provider, apiKey }: { provider: "anthropic" | "openai"; apiKey: string }) => {
    if (provider === "openai") {
      const client = new OpenAI({ apiKey, timeout: 10_000 });
      await client.responses.create({ model: "gpt-5-mini", input: "hi", max_output_tokens: 1 });
      return { success: true, data: undefined };
    }

    const client = new Anthropic({ apiKey, timeout: 10_000 });
    await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return { success: true, data: undefined };
  },
);

if ("llm" in config) {
  const llm = getLlmConfig();

  if (llm.providers.anthropic.apiKey) process.env.ANTHROPIC_API_KEY = llm.providers.anthropic.apiKey;
  else delete process.env.ANTHROPIC_API_KEY;

  if (llm.providers.openai.apiKey) process.env.OPENAI_API_KEY = llm.providers.openai.apiKey;
  else delete process.env.OPENAI_API_KEY;

  agentCoordinator.updateConfig({
    model: getModelIdForFeature("agentDrafter", llm.defaultProvider),
    anthropicApiKey: llm.providers.anthropic.apiKey,
    openaiApiKey: llm.providers.openai.apiKey,
  });

  resetAnalyzer();
  resetArchiveReadyAnalyzer();
  prefetchService.reset();
}
```

```ts
// src/preload/index.ts
settings: {
  validateProviderApiKey: (provider: "anthropic" | "openai", apiKey: string): Promise<unknown> =>
    ipcRenderer.invoke("settings:validate-provider-api-key", { provider, apiKey }),
}
```

```tsx
// src/renderer/components/SettingsPanel.tsx
const setDefaultAgentProviderId = useAppStore((s) => s.setDefaultAgentProviderId);
const [defaultProvider, setDefaultProvider] = useState<"anthropic" | "openai">("anthropic");
const [featureTiers, setFeatureTiers] = useState<FeatureQualityConfig>(DEFAULT_FEATURE_QUALITY_CONFIG);
const [anthropicApiKey, setAnthropicApiKey] = useState("");
const [openaiApiKey, setOpenaiApiKey] = useState("");

await window.api.settings.set({
  llm: {
    defaultProvider,
    providers: {
      anthropic: { apiKey: anthropicApiKey || undefined },
      openai: { apiKey: openaiApiKey || undefined },
    },
    featureTiers,
  },
});
setDefaultAgentProviderId(defaultProvider === "openai" ? "openai" : "claude");
```

```tsx
// src/renderer/components/SetupWizard.tsx
type Step = "loading" | "credentials" | "provider" | "apikey" | "oauth" | "extensions" | "analytics";

const [selectedProvider, setSelectedProvider] = useState<"anthropic" | "openai">("anthropic");

if (!authResult.data.hasDefaultBuiltInProviderAuth) flow.push("provider", "apikey");

const validation = await window.api.settings.validateProviderApiKey(selectedProvider, apiKey.trim());
await window.api.settings.set({
  llm: {
    defaultProvider: selectedProvider,
    providers: {
      anthropic: selectedProvider === "anthropic" ? { apiKey: apiKey.trim() } : undefined,
      openai: selectedProvider === "openai" ? { apiKey: apiKey.trim() } : undefined,
    },
    featureTiers: DEFAULT_FEATURE_QUALITY_CONFIG,
  },
});
```

```tsx
// src/renderer/components/AgentCommandPalette.tsx
const defaultAgentProviderId = useAppStore((s) => s.defaultAgentProviderId);

useEffect(() => {
  if (!isOpen) return;
  if (selectedAgentIds.length === 0 && defaultAgentProviderId) {
    setSelectedAgentIds([defaultAgentProviderId]);
  }
}, [isOpen, selectedAgentIds.length, defaultAgentProviderId, setSelectedAgentIds]);
```

```ts
// src/renderer/store/index.ts
defaultAgentProviderId: string | null;
setDefaultAgentProviderId: (providerId: string | null) => void;

defaultAgentProviderId: "claude",
setDefaultAgentProviderId: (providerId) => set({ defaultAgentProviderId: providerId }),
```

```tsx
// src/renderer/App.tsx
window.api.settings.get().then((result: IpcResponse<Config>) => {
  if (result.success) {
    const providerId = result.data.llm?.defaultProvider === "openai" ? "openai" : "claude";
    useAppStore.getState().setDefaultAgentProviderId(providerId);
  }
});

window.api.gmail.checkAuth().then((result: IpcResponse<{
  hasCredentials: boolean;
  hasTokens: boolean;
  hasDefaultBuiltInProviderAuth: boolean;
}>) => {
  if (result.success) {
    setNeedsSetup(!result.data.hasDefaultBuiltInProviderAuth || !result.data.hasTokens);
  }
});

const autoDraftProviderId = event.providerId ?? store.defaultAgentProviderId ?? "claude";
store.startAgentTask(taskId, emailId, [autoDraftProviderId], "", {
  accountId: email.accountId || "",
  currentEmailId: emailId,
  currentThreadId: email.threadId,
  userEmail: "",
});
```

```tsx
// src/renderer/components/AgentPanel.tsx
const defaultAgentProviderId = useAppStore((s) => s.defaultAgentProviderId);

startAgentTask(taskId, emailId, [defaultAgentProviderId ?? "claude"], task?.prompt || "", task?.context || {
  accountId: email?.accountId || "",
  currentEmailId: emailId,
  currentThreadId: email?.threadId || "",
  userEmail: "",
});
```

```tsx
// src/renderer/components/EmailPreviewSidebar.tsx
const providerIds = [...new Set(result.data.events.map((event) => event.providerId).filter(Boolean))] as string[];

replayAgentTrace(
  taskId,
  email.id,
  providerIds.length > 0 ? providerIds : [useAppStore.getState().defaultAgentProviderId ?? "claude"],
  "",
  {
    accountId: email.accountId || "",
    currentEmailId: email.id,
    currentThreadId: email.threadId,
    userEmail: "",
  },
  result.data.events,
);
```

```md
<!-- README.md -->
### 2. Set API Key

```bash
export OPENAI_API_KEY=your_key_here
# or
export ANTHROPIC_API_KEY=your_key_here
```

Exo supports Anthropic and OpenAI for built-in AI features. Configure either provider in Setup or Settings -> General.
```

- [ ] **Step 4: Run the settings and agent e2e tests and verify they pass**

Run: `npx playwright test tests/e2e/settings.spec.ts tests/e2e/agent-framework.spec.ts --project=e2e`

Expected: PASS with provider switching visible in Settings and the command palette following the configured provider.

- [ ] **Step 5: Commit the renderer/onboarding/docs slice**

```bash
git add src/main/ipc/gmail.ipc.ts src/main/ipc/settings.ipc.ts src/preload/index.ts src/renderer/components/SettingsPanel.tsx src/renderer/components/SetupWizard.tsx src/renderer/components/AgentCommandPalette.tsx src/renderer/components/AgentPanel.tsx src/renderer/components/EmailPreviewSidebar.tsx src/renderer/store/index.ts src/renderer/App.tsx README.md .env.example tests/e2e/settings.spec.ts tests/e2e/agent-framework.spec.ts
git commit -m "feat: add built-in provider switch UI"
```

## Task 9: Run Full Verification And Manual Provider-Switch Checks

**Files:**
- Modify: none unless verification finds defects
- Test: `tests/unit/llm-config.spec.ts`
- Test: `tests/unit/llm-service.spec.ts`
- Test: `tests/unit/email-analyzer.spec.ts`
- Test: `tests/unit/archive-ready.spec.ts`
- Test: `tests/unit/calendaring-agent.spec.ts`
- Test: `tests/unit/draft-generator.spec.ts`
- Test: `tests/unit/draft-pipeline.spec.ts`
- Test: `tests/unit/draft-edit-learner.spec.ts`
- Test: `tests/unit/analysis-edit-learner.spec.ts`
- Test: `tests/unit/openai-agent-provider.spec.ts`
- Test: `tests/unit/sender-lookup.spec.ts`
- Test: `tests/e2e/settings.spec.ts`
- Test: `tests/e2e/agent-framework.spec.ts`
- Test: `tests/e2e/sender-profile.spec.ts`

- [ ] **Step 1: Run targeted typecheck and quick automation**

Run: `npm run typecheck`

Expected: PASS with no TypeScript errors.

Run: `npm run test:quick`

Expected: PASS with unit and integration quick paths green.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`

Expected: PASS with unit, integration, and e2e projects green.

- [ ] **Step 3: Run the manual repeated-interaction checks**

```text
1. Launch the app in demo mode.
2. Open Settings -> General and switch provider Anthropic -> OpenAI -> Anthropic ten times.
3. Save both API-key fields repeatedly and confirm the selected provider does not drift.
4. Open Cmd+J after each switch and confirm the default selected provider matches the saved setting.
5. Trigger a sender profile lookup and confirm the sidebar still renders.
6. Save a memory under Anthropic, switch to OpenAI, and verify that memory still appears in a generated draft/analysis prompt path.
7. Rerun an agent draft repeatedly and confirm it follows the selected built-in provider.
```

Expected: No renderer desync, no stale provider selection, no memory partitioning by provider, and no sender-profile regression.

- [ ] **Step 4: If verification finds issues, fix them immediately with the same TDD loop**

```bash
npx playwright test tests/e2e/agent-framework.spec.ts --project=e2e
# write failing assertion first
# implement minimal fix
npx playwright test tests/e2e/agent-framework.spec.ts --project=e2e
```

Expected: Any regressions are fixed before closing the feature.

- [ ] **Step 5: Commit the verification and final polish**

```bash
git status --short
# If Step 4 changed files, commit only those fixes, for example:
git add src/main/ipc/settings.ipc.ts src/renderer/components/AgentCommandPalette.tsx tests/e2e/agent-framework.spec.ts
git commit -m "fix: address openai provider verification findings"
```

## Self-Review

### Spec coverage

- Provider-neutral built-in LLM layer: Tasks 1-5
- Full OpenAI support across built-in AI features: Tasks 3-8
- Shared memories across providers: Tasks 3, 5, and 9 manual verification
- OpenAI first-party agent provider: Task 7
- Easy UI switching through Settings and onboarding: Task 8
- Sender lookup no longer Anthropic-only: Task 6
- Docs and environment setup updates: Task 8

No spec gaps remain.

### Placeholder scan

- No `TODO`, `TBD`, or "implement later" placeholders remain.
- Every task includes exact files, concrete commands, and code snippets.
- Every verification step names the exact tests or manual flow.

### Type consistency

- Provider ID type is consistently `BuiltInLlmProviderId`, while the adapter interface remains `BuiltInLlmProvider`.
- Renderer-visible quality config is consistently `FeatureQualityConfig`.
- Shared LLM boundary uses `BuiltInLlmClient` and `BuiltInLlmRequest`.
- Agent defaults use `getDefaultAgentProviderId()` so Anthropic maps to `claude` and OpenAI maps to `openai`.
- OpenAI backend config uses `openaiApiKey` consistently in `AgentFrameworkConfig`.
