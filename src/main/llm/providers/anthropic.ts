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
