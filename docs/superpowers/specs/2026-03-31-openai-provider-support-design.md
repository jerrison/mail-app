# OpenAI Provider Support Design

Date: 2026-03-31
Status: Approved design

## Summary

Add full first-party support for OpenAI models alongside Anthropic across all built-in AI features in Exo. The app should let users switch the default built-in LLM provider in the UI, persist both providers' API keys, and reuse the same memory system regardless of which provider is active.

This work replaces Anthropic-specific wiring inside feature code with a provider-neutral LLM layer in the main process. The new layer will back email analysis, draft generation, draft refinement, archive-ready analysis, scheduling detection, memory classification, memory-learning helpers, sender lookup, built-in agent chat, and background auto-drafts.

## Goals

- Support OpenAI as a first-party built-in provider using an `OPENAI_API_KEY`.
- Keep Anthropic support working.
- Make it easy to switch the built-in provider from the UI.
- Ensure all built-in AI-backed features follow the selected provider.
- Keep user memories shared across providers with no provider-specific duplication.
- Preserve the existing extension/provider architecture where possible.

## Non-Goals

- Adding arbitrary new providers beyond Anthropic and OpenAI in this change.
- Reworking the extension system beyond the changes needed to remove Anthropic-only assumptions.
- Replacing the current agent-provider registry with a new framework.
- Changing memory semantics or scope rules.

## Current State

The codebase already has an agent provider registry under `src/main/agents/providers`, but most built-in AI features bypass that abstraction and call Anthropic directly:

- `src/main/services/email-analyzer.ts`
- `src/main/services/draft-generator.ts`
- `src/main/services/archive-ready-analyzer.ts`
- `src/main/services/calendaring-agent.ts`
- `src/main/ipc/drafts.ipc.ts`
- `src/main/ipc/memory.ipc.ts`
- `src/main/services/draft-edit-learner.ts`
- `src/main/services/analysis-edit-learner.ts`
- bundled sender lookup extension in `src/extensions/mail-ext-web-search/`

The renderer also assumes Claude/Anthropic in multiple places:

- Setup wizard requires an Anthropic API key
- Settings describes all model choices as Claude-specific
- Agent defaults hardcode `claude`
- Background auto-drafts and reruns hardcode `["claude"]`

The memory system is already provider-agnostic. Memories are keyed by account and scope, and prompt context is assembled from the DB without storing provider identity. That part should remain unchanged.

## Proposed Architecture

### 1. Add a provider-neutral LLM layer

Create a new main-process module under `src/main/llm/` that exposes provider-neutral capabilities instead of vendor SDK surfaces.

Suggested shape:

- `src/main/llm/types.ts`
- `src/main/llm/config.ts`
- `src/main/llm/provider-registry.ts`
- `src/main/llm/providers/anthropic.ts`
- `src/main/llm/providers/openai.ts`
- `src/main/llm/feature-models.ts`

The shared interface should be capability-based:

- `generateText(request)`
- `generateStructured(request)`
- `searchWebStructured(request)`
- `createAgentRuntime(request)` or equivalent helper for built-in agent providers

Feature code should request capabilities such as "structured email analysis" or "web-backed sender lookup" and should not import vendor SDKs directly.

### 2. Move built-in features onto the shared layer

Refactor these paths to use the new LLM layer:

- Email analysis
- Draft generation
- Draft refinement
- Archive-ready analysis
- Scheduling detection
- Memory scope classification
- Draft-edit learner
- Analysis-edit learner
- Sender lookup extension

The feature modules should keep their current prompt and fallback behavior as much as possible. The main change is replacing direct Anthropic client usage with provider-neutral requests.

### 3. Keep memory provider-agnostic

Do not add provider or model identifiers to `memories` or `draft_memories`. Memories remain shared because they represent user intent, not vendor-specific output.

Allowed metadata additions:

- request/provider metadata in logs
- provider identifiers in agent traces
- provider identifiers in audit entries

Disallowed changes:

- duplicating memories per provider
- filtering memory context by provider
- requiring re-learning after provider switches

### 4. Add OpenAI as a built-in agent provider

Keep the existing agent registry and add a first-party `OpenAIAgentProvider` next to `ClaudeAgentProvider`.

Requirements:

- Register `openai` as a built-in provider in the utility-process orchestrator
- Support follow-up conversations through provider-specific persisted handles
- Support tool calls through the app's existing tool registry
- Surface provider-specific auth failures clearly in the renderer

The default built-in agent should follow the app-wide selected provider, but explicit multi-provider selection in the agent UI should continue to work.

### 5. Remove Anthropic-only sender lookup assumptions

The bundled web-search extension currently constructs an Anthropic client directly. Replace that with an injected provider-neutral web-search capability from the shared LLM layer.

The extension should remain bundled and continue owning the enrichment/panel behavior, but it should no longer know which model vendor is executing the request.

## Configuration Design

### New config shape

Replace the Anthropic-only built-in provider assumptions with a provider-neutral config block in `ConfigSchema`.

Add:

```ts
llm: {
  defaultProvider: "anthropic" | "openai";
  providers: {
    anthropic?: {
      apiKey?: string;
      useClaudeAccount?: boolean;
    };
    openai?: {
      apiKey?: string;
    };
  };
  featureTiers: {
    analysis: "fast" | "balanced" | "best";
    drafts: "fast" | "balanced" | "best";
    refinement: "fast" | "balanced" | "best";
    calendaring: "fast" | "balanced" | "best";
    archiveReady: "fast" | "balanced" | "best";
    senderLookup: "fast" | "balanced" | "best";
    agentDrafter: "fast" | "balanced" | "best";
    agentChat: "fast" | "balanced" | "best";
  };
}
```

### Backward compatibility

Automatically migrate old config on read:

- `anthropicApiKey` -> `llm.providers.anthropic.apiKey`
- `modelConfig` Anthropic tier selections -> provider-neutral feature tiers
- default provider for existing users -> `"anthropic"`

Keep legacy fields readable during migration so old config files do not break app startup. New writes should go to the new config shape.

### Model resolution

The renderer should no longer store Anthropic-specific tier values like `haiku`, `sonnet`, and `opus`.

Use provider-neutral feature tiers:

- `fast`
- `balanced`
- `best`

Then map them per provider in the main process:

- Anthropic: `fast -> haiku`, `balanced -> sonnet`, `best -> opus`
- OpenAI: provider-specific concrete model IDs chosen centrally in `feature-models.ts`

The rest of the app should resolve feature -> provider -> concrete model ID in one place.

## UI Design

### Settings -> General

Replace the Claude-specific "AI Models" area with:

1. `LLM Provider`
   - values: `Anthropic`, `OpenAI`
   - this is the app-wide default for all built-in AI features

2. `Feature Quality`
   - retain the current per-feature rows
   - replace Claude-specific tier labels with `Fast`, `Balanced`, `Best`
   - show resolved provider/model help text under each row

The UI should not force users to understand vendor model catalogs just to pick the right quality level.

### Settings -> Agents

Replace the Anthropic-only framing with:

- Anthropic API key input
- OpenAI API key input
- Claude account login block as Anthropic-specific optional fallback
- indicator showing which built-in provider is currently active

The Claude account login remains useful only for the Anthropic path. OpenAI uses API-key auth only.

### Setup Wizard

Change the setup flow from:

- Google credentials
- Anthropic API key
- Gmail OAuth
- extensions
- analytics

to:

- Google credentials
- choose LLM provider
- provider-specific API key input
- Gmail OAuth
- extensions
- analytics

If both providers are configured later, the user can switch in Settings without revisiting onboarding.

### Agent UI defaults

Update hardcoded defaults in the renderer and main process:

- Command palette default selected provider should be the configured built-in provider
- Background auto-drafts should use the configured built-in provider
- Draft reruns should use the configured built-in provider
- Trace replay should not assume `claude`

Explicit multi-provider selection in the agent sidebar should remain available.

## Feature Behavior

### Built-in AI features

The selected built-in provider must drive all built-in AI-backed behavior:

- inbox analysis
- reply draft generation
- forward/new-email generation
- draft refinement
- archive-ready detection
- scheduling detection
- memory scope classification
- memory-learning helpers
- sender lookup
- built-in agent chat
- background agent auto-drafts

### Provider switching

Switching the default provider should affect new work only.

- In-flight runs continue with the provider they started with, or are explicitly cancelled if the caller already has a cancellation path.
- New runs after the config save use the new provider.
- The app must not mix providers within a single in-flight task.

## Error Handling

Provider failures must be surfaced precisely:

- missing Anthropic key -> Anthropic-specific configuration message
- missing OpenAI key -> OpenAI-specific configuration message
- unsupported capability -> fail fast at startup or provider initialization for that feature path
- structured output parse failure -> keep existing conservative fallbacks
- sender lookup unavailable -> skip enrichment cleanly without failing draft generation

The shared LLM layer should centralize:

- retries
- request IDs
- timeout configuration
- provider-specific error normalization
- logging

## Migration Plan

### Phase 1: shared LLM layer

Create the provider-neutral LLM layer and move non-agent built-in features onto it:

- analysis
- drafts
- refinement
- calendaring
- archive-ready
- memory classification
- memory learners

### Phase 2: agent and sender lookup integration

- add `OpenAIAgentProvider`
- migrate bundled sender lookup extension to the shared LLM search capability
- remove hardcoded `["claude"]` defaults from prefetch, reruns, and UI initialization

### Phase 3: UI and config migration

- land provider-neutral config schema
- update settings and setup wizard copy
- migrate persisted config automatically
- remove remaining Anthropic-specific built-in wording

## Testing Strategy

### Unit tests

Add coverage for:

- config migration from legacy fields
- provider selection logic
- feature tier to concrete model resolution
- structured output normalization and parsing
- provider-specific error normalization

### Integration tests

Add coverage for both Anthropic and OpenAI paths for:

- email analysis
- draft generation
- draft refinement
- archive-ready analysis
- scheduling detection
- memory classification
- agent run routing

### End-to-end tests

Add UI coverage for:

- switching provider in Settings
- configuring OpenAI in onboarding
- saving both API keys
- background auto-draft using selected provider
- command palette default selection following configured provider
- memory learned under one provider still affecting prompts after switching providers

### Interactive verification

Before calling the work complete, manually verify:

- switching providers back and forth repeatedly
- saving each provider key repeatedly
- running agent drafts repeatedly after provider changes
- sender lookup still rendering in the sidebar
- memory created under Anthropic still appearing in OpenAI-backed draft and analysis requests

The UI verification should include repeated interaction rather than one-shot checks, because the app has long-lived renderer and main-process state.

## Risks And Constraints

- Prompt parity across vendors will not be exact. The goal is behavioral equivalence, not identical wording.
- The bundled sender lookup extension is currently the highest-risk Anthropic-only edge because it depends on web-search support.
- Agent conversation persistence differs by provider and must be normalized carefully.
- Existing tests may assume `claude` in task/provider IDs and will need updates.

## Design Decisions

- The provider switch is app-wide for built-in AI features.
- Per-feature quality remains configurable, but quality labels are vendor-neutral.
- Memory remains shared across providers with no provider-specific fork.
- The existing agent provider registry stays in place and gains an OpenAI provider.
- Sender lookup remains an extension but uses provider-neutral LLM execution.

## Scope Check

This work is a single coherent implementation project. It is broad, but it is still one change set with a shared architectural core: replacing Anthropic-specific built-in AI wiring with a provider-neutral LLM layer while preserving current product behavior.

It should be planned and executed in ordered slices rather than as independent specs.
