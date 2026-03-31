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
