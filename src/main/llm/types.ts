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
