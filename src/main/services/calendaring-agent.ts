import { stripJsonFences } from "../../shared/strip-json-fences";
import {
  DEFAULT_CALENDARING_PROMPT,
  DEFAULT_EA_DEFERRAL_TEMPLATE,
  type CalendaringResult,
  type EAConfig,
  type Email,
} from "../../shared/types";
import { createBuiltInLlmClient } from "../llm";
import type { BuiltInLlmClient } from "../llm/types";

export class CalendaringAgent {
  private llm: BuiltInLlmClient;
  private model: string;
  private prompt: string;

  constructor(model: string = "claude-sonnet-4-20250514", prompt?: string, llmClient?: BuiltInLlmClient) {
    this.llm = llmClient ?? createBuiltInLlmClient({ anthropicApiKey: process.env.ANTHROPIC_API_KEY });
    this.model = model;
    this.prompt = prompt || DEFAULT_CALENDARING_PROMPT;
  }

  async analyze(email: Email): Promise<CalendaringResult> {
    const response = await this.llm.generate({
      model: this.model,
      maxOutputTokens: 512,
      mode: "json",
      input: `${this.prompt}

---
EMAIL TO ANALYZE:

From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
Date: ${email.date}

${email.body}`,
    });

    if (!response.text) {
      throw new Error("No text response from LLM");
    }

    try {
      const parsed = JSON.parse(stripJsonFences(response.text));
      return {
        hasSchedulingContext: Boolean(parsed.hasSchedulingContext),
        action: parsed.action || "none",
        reason: parsed.reason || "",
      };
    } catch {
      // If JSON parsing fails, return a default
      console.error("Failed to parse calendaring response:", response.text);
      return {
        hasSchedulingContext: false,
        action: "none",
        reason: "Failed to parse calendaring analysis",
      };
    }
  }

  generateEADeferralLanguage(eaConfig: EAConfig): string {
    if (!eaConfig.enabled || !eaConfig.email) {
      return "";
    }

    const template = DEFAULT_EA_DEFERRAL_TEMPLATE;
    return template
      .replace("{{EA_NAME}}", eaConfig.name || "my assistant")
      .replace("{{EA_EMAIL}}", eaConfig.email);
  }
}
