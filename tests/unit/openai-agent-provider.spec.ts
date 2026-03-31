import { test, expect } from "@playwright/test";
import { z } from "zod";
import { OpenAIAgentProvider } from "../../src/main/agents/providers/openai-agent-provider";
import type { AgentEvent, AgentRunParams, AgentRunResult } from "../../src/main/agents/types";
import {
  MockOpenAI,
  mockOpenAIResponse,
  getCapturedOpenAIRequests,
  resetOpenAIMock,
} from "../mocks/openai-api-mock";

test.beforeEach(() => {
  resetOpenAIMock();
});

function baseRunParams(overrides: Partial<AgentRunParams> = {}): AgentRunParams {
  return {
    taskId: "task_openai_test",
    prompt: "Say hello",
    context: {
      accountId: "acct_1",
      userEmail: "user@example.com",
    },
    tools: [],
    toolExecutor: async () => ({}),
    netFetch: async () => ({ status: 200, headers: {}, body: "" }),
    signal: new AbortController().signal,
    ...overrides,
  };
}

async function collectRun(
  provider: OpenAIAgentProvider,
  params: AgentRunParams,
): Promise<{ events: AgentEvent[]; result: AgentRunResult }> {
  const events: AgentEvent[] = [];
  const gen = provider.run(params);

  while (true) {
    const next = await gen.next();
    if (next.done) {
      return { events, result: next.value };
    }
    events.push(next.value);
  }
}

test("OpenAIAgentProvider is unavailable when no API key is configured", async () => {
  const provider = new OpenAIAgentProvider({ model: "gpt-5.2" });
  await expect(provider.isAvailable()).resolves.toBe(false);
});

test("OpenAIAgentProvider emits text_delta for a simple response", async () => {
  mockOpenAIResponse({ id: "resp_1", outputText: "Hello from OpenAI." });

  const provider = new OpenAIAgentProvider(
    { model: "gpt-5.2", openaiApiKey: "sk-openai-test" },
    new MockOpenAI() as never,
  );

  const run = await collectRun(provider, baseRunParams());

  expect(run.events.some((evt) => evt.type === "text_delta" && evt.text.includes("Hello from OpenAI."))).toBe(true);
  expect(run.result).toEqual({ state: "completed", providerTaskId: "resp_1" });
});

test("OpenAIAgentProvider executes tool calls and chains previous_response_id", async () => {
  mockOpenAIResponse({
    id: "resp_1",
    outputText: "",
    output: [
      {
        type: "function_call",
        call_id: "call_1",
        name: "search_context",
        arguments: JSON.stringify({ query: "status update" }),
      },
    ],
  });
  mockOpenAIResponse({
    id: "resp_2",
    outputText: "Final answer after tool execution.",
  });

  const toolExecutorCalls: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const provider = new OpenAIAgentProvider(
    { model: "gpt-5.2", openaiApiKey: "sk-openai-test" },
    new MockOpenAI() as never,
  );

  const run = await collectRun(
    provider,
    baseRunParams({
      prompt: "Use tool",
      tools: [
        {
          name: "search_context",
          description: "Look up extra context",
          inputSchema: z.object({ query: z.string() }),
        },
      ],
      toolExecutor: async (toolName, args) => {
        toolExecutorCalls.push({ toolName, args });
        return { hits: ["match_1"] };
      },
    }),
  );

  expect(toolExecutorCalls).toEqual([
    {
      toolName: "search_context",
      args: { query: "status update" },
    },
  ]);
  expect(run.events.some((evt) => evt.type === "tool_call_start" && evt.toolCallId === "call_1")).toBe(true);
  expect(run.events.some((evt) => evt.type === "tool_call_end" && evt.toolCallId === "call_1")).toBe(true);

  const requests = getCapturedOpenAIRequests();
  expect(requests).toHaveLength(2);
  expect(requests[1].previous_response_id).toBe("resp_1");
  expect(run.result).toEqual({ state: "completed", providerTaskId: "resp_2" });
});
