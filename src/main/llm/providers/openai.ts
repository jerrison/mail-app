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
      requestId: response._request_id ?? undefined,
    };
  }
}
