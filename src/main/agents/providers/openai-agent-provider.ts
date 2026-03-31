import OpenAI from "openai";
import { z } from "zod";
import type {
  AgentContext,
  AgentEvent,
  AgentFrameworkConfig,
  AgentProvider,
  AgentProviderConfig,
  AgentRunParams,
  AgentRunResult,
  AgentToolSpec,
} from "../types";

const MAX_TOOL_TURNS = 24;

type OpenAIFunctionCall = {
  type: "function_call";
  call_id: string;
  name: string;
  arguments: string;
};

function buildSystemPrompt(context: AgentContext, tools: AgentToolSpec[], memoryContext?: string): string {
  const parts: string[] = [
    "You are an AI assistant embedded in a Gmail client application.",
    "You help users read, analyze, draft, and organize email.",
    "",
    `Current account: ${context.userEmail}${context.userName ? ` (${context.userName})` : ""}`,
    `Account ID: ${context.accountId}`,
  ];

  if (context.currentEmailId) parts.push(`Current email ID: ${context.currentEmailId}`);
  if (context.currentThreadId) parts.push(`Current thread ID: ${context.currentThreadId}`);
  if (context.currentDraftId) parts.push(`Current draft ID: ${context.currentDraftId}`);

  if (memoryContext) {
    parts.push("", memoryContext);
  }

  const toolGuidance = tools
    .filter((tool) => tool.systemPromptGuidance)
    .map((tool) => tool.systemPromptGuidance!);
  if (toolGuidance.length > 0) {
    parts.push("", "## Additional Tools", ...toolGuidance);
  }

  return parts.join("\n");
}

function toOpenAIFunctionTools(tools: AgentToolSpec[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.inputSchema),
    strict: true,
  }));
}

function parseFunctionCalls(output: unknown): OpenAIFunctionCall[] {
  if (!Array.isArray(output)) return [];
  const calls: OpenAIFunctionCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (row.type !== "function_call") continue;
    if (typeof row.call_id !== "string" || typeof row.name !== "string") continue;
    calls.push({
      type: "function_call",
      call_id: row.call_id,
      name: row.name,
      arguments: typeof row.arguments === "string" ? row.arguments : "{}",
    });
  }
  return calls;
}

function normalizeToolOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class OpenAIAgentProvider implements AgentProvider {
  readonly config: AgentProviderConfig = {
    id: "openai",
    name: "OpenAI Agent",
    description: "OpenAI Responses API agent with function tool calling",
    auth: { type: "api_key", configKey: "OPENAI_API_KEY" },
  };

  private frameworkConfig: AgentFrameworkConfig;
  private client: OpenAI | null;
  private inFlight = new Map<string, AbortController>();
  private readonly hasInjectedClient: boolean;

  constructor(frameworkConfig: AgentFrameworkConfig, client?: OpenAI) {
    this.frameworkConfig = frameworkConfig;
    this.client = client ?? this.buildClient(frameworkConfig.openaiApiKey);
    this.hasInjectedClient = Boolean(client);
  }

  async *run(params: AgentRunParams): AsyncGenerator<AgentEvent, AgentRunResult, void> {
    if (!this.frameworkConfig.openaiApiKey || !this.client) {
      yield { type: "error", message: "OPENAI_NOT_CONFIGURED" };
      return { state: "failed" };
    }

    const taskController = new AbortController();
    this.inFlight.set(params.taskId, taskController);
    const onParentAbort = () => taskController.abort();
    params.signal.addEventListener("abort", onParentAbort, { once: true });

    const combinedSignal = AbortSignal.any([params.signal, taskController.signal]);

    try {
      yield { type: "state", state: "running" };

      const model = params.modelOverride ?? this.frameworkConfig.model;
      const systemPrompt = buildSystemPrompt(params.context, params.tools, params.context.memoryContext);
      const openaiTools = toOpenAIFunctionTools(params.tools);
      const toolsByName = new Map(params.tools.map((tool) => [tool.name, tool]));

      let previousResponseId = params.context.providerConversationIds?.openai;
      let nextInput: unknown = params.prompt;
      let lastResponseId: string | undefined;

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const request: Record<string, unknown> = {
          model,
          instructions: systemPrompt,
          input: nextInput,
        };
        if (openaiTools.length > 0) request.tools = openaiTools;
        if (previousResponseId) request.previous_response_id = previousResponseId;

        const response = await this.client.responses.create(request, {
          signal: combinedSignal,
        });

        lastResponseId = response.id;
        if (response.output_text) {
          yield { type: "text_delta", text: response.output_text };
        }

        const functionCalls = parseFunctionCalls(response.output);
        if (functionCalls.length === 0) {
          yield { type: "done", summary: "OpenAI response completed" };
          return { state: "completed", providerTaskId: lastResponseId };
        }

        const toolOutputs: Array<Record<string, unknown>> = [];
        for (const call of functionCalls) {
          let rawArgs: Record<string, unknown> = {};
          try {
            rawArgs = JSON.parse(call.arguments) as Record<string, unknown>;
          } catch {
            rawArgs = {};
          }

          yield {
            type: "tool_call_start",
            toolName: call.name,
            toolCallId: call.call_id,
            input: rawArgs,
          };

          let toolResult: unknown;
          try {
            const spec = toolsByName.get(call.name);
            const parsedArgs = spec
              ? (spec.inputSchema.parse(rawArgs) as Record<string, unknown>)
              : rawArgs;
            toolResult = await params.toolExecutor(call.name, parsedArgs);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            toolResult = { error: message };
          }

          yield {
            type: "tool_call_end",
            toolCallId: call.call_id,
            result: toolResult,
          };

          toolOutputs.push({
            type: "function_call_output",
            call_id: call.call_id,
            output: normalizeToolOutput(toolResult),
          });
        }

        previousResponseId = response.id;
        nextInput = toolOutputs;
      }

      yield { type: "error", message: "OpenAI agent exceeded maximum tool turns" };
      return { state: "failed", providerTaskId: previousResponseId };
    } catch (error) {
      if (combinedSignal.aborted) {
        yield { type: "state", state: "cancelled" };
        return { state: "cancelled" };
      }
      const message = error instanceof Error ? error.message : String(error);
      yield { type: "error", message };
      return { state: "failed" };
    } finally {
      params.signal.removeEventListener("abort", onParentAbort);
      this.inFlight.delete(params.taskId);
    }
  }

  cancel(taskId: string): void {
    const controller = this.inFlight.get(taskId);
    if (controller) {
      controller.abort();
      this.inFlight.delete(taskId);
    }
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(this.frameworkConfig.openaiApiKey);
  }

  updateConfig(config: Partial<AgentFrameworkConfig>): void {
    this.frameworkConfig = { ...this.frameworkConfig, ...config };

    if (!this.hasInjectedClient && "openaiApiKey" in config) {
      this.client = this.buildClient(config.openaiApiKey);
    }
  }

  private buildClient(apiKey?: string): OpenAI | null {
    if (!apiKey) return null;
    return new OpenAI({ apiKey });
  }
}
