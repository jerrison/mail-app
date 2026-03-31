import { test, expect } from "@playwright/test";
import { AnthropicBuiltInLlmProvider } from "../../src/main/llm/providers/anthropic";
import { OpenAIBuiltInLlmProvider } from "../../src/main/llm/providers/openai";
import {
  MockAnthropic,
  mockAnthropicResponse,
  resetAnthropicMock,
  getCapturedRequests as getAnthropicRequests,
} from "../mocks/anthropic-api-mock";
import {
  MockOpenAI,
  mockOpenAIResponse,
  resetOpenAIMock,
  getCapturedOpenAIRequests,
} from "../mocks/openai-api-mock";

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
