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
