/**
 * Unit tests for EmailAnalyzer service.
 *
 * Strategy: Inject MockBuiltInLlmClient so we can control provider-neutral
 * LLM responses and inspect generated requests.
 */
import { test, expect } from "@playwright/test";
import { EmailAnalyzer } from "../../src/main/services/email-analyzer";
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";
import type { Email } from "../../src/shared/types";
import { ANALYSIS_JSON_FORMAT } from "../../src/shared/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "msg-1",
    threadId: "thread-1",
    from: "alice@example.com",
    to: "user@example.com",
    subject: "Test email",
    body: "Hey, can you review this document by Friday?",
    date: "2025-01-15T10:00:00Z",
    snippet: "Hey, can you review...",
    labelIds: ["INBOX"],
    ...overrides,
  };
}

function createAnalyzerWithMock(prompt?: string): {
  analyzer: EmailAnalyzer;
  mock: MockBuiltInLlmClient;
} {
  const mock = new MockBuiltInLlmClient();
  const analyzer = new EmailAnalyzer("claude-sonnet-4-20250514", prompt, mock);
  return { analyzer, mock };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("EmailAnalyzer", () => {
  test("analyze() returns correct AnalysisResult for a needs-reply email", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push(
      '{"needs_reply": true, "reason": "Direct question about document review", "priority": "high"}'
    );
    const email = makeEmail();

    const result = await analyzer.analyze(email);

    expect(result.needs_reply).toBe(true);
    expect(result.reason).toBe("Direct question about document review");
    expect(result.priority).toBe("high");
  });

  test("analyze() returns correct result for newsletter (no reply needed)", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push('{"needs_reply": false, "reason": "Newsletter/marketing content"}');
    const email = makeEmail({
      from: "newsletter@techdigest.com",
      subject: "Weekly Tech Digest",
      body: "Top 10 AI stories this week...",
    });

    const result = await analyzer.analyze(email);

    expect(result.needs_reply).toBe(false);
    expect(result.reason).toBe("Newsletter/marketing content");
    expect(result.priority).toBeUndefined();
  });

  test("analyze() with custom prompt appends ANALYSIS_JSON_FORMAT", async () => {
    const customPrompt = "You are a custom email analyzer. Analyze this email.";
    const { analyzer, mock } = createAnalyzerWithMock(customPrompt);
    mock.push(
      '{"needs_reply": true, "reason": "Custom prompt test", "priority": "medium"}'
    );
    const email = makeEmail();

    await analyzer.analyze(email);

    // The custom prompt should have ANALYSIS_JSON_FORMAT appended
    const requests = mock.calls;
    expect(requests).toHaveLength(1);
    const systemText = requests[0].system;
    expect(systemText).toBe(customPrompt + ANALYSIS_JSON_FORMAT);
  });

  test("analyze() with default prompt uses ANALYSIS_SYSTEM_PROMPT (not appending JSON format)", async () => {
    // Pass the default prompt explicitly — should NOT be treated as custom
    const { DEFAULT_ANALYSIS_PROMPT } = await import("../../src/shared/types");
    const { analyzer, mock } = createAnalyzerWithMock(DEFAULT_ANALYSIS_PROMPT);
    mock.push('{"needs_reply": false, "reason": "test"}');
    const email = makeEmail();

    await analyzer.analyze(email);

    const requests = mock.calls;
    const systemText = requests[0].system ?? "";
    // Default prompt path uses the long ANALYSIS_SYSTEM_PROMPT, not the user-editable default
    expect(systemText).not.toContain(ANALYSIS_JSON_FORMAT);
    // The system prompt should contain the full example-rich prompt
    expect(systemText).toContain("You are an email triage assistant");
  });

  test("analyze() handles JSON fenced in markdown code blocks", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push(
      '```json\n{"needs_reply": true, "reason": "Fenced JSON", "priority": "low"}\n```'
    );
    const email = makeEmail();

    const result = await analyzer.analyze(email);

    expect(result.needs_reply).toBe(true);
    expect(result.reason).toBe("Fenced JSON");
    expect(result.priority).toBe("low");
  });

  test("analyze() handles parse failure gracefully (returns default no-reply)", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push("I'm not sure how to analyze this email, here are some thoughts...");
    const email = makeEmail();

    const result = await analyzer.analyze(email);

    expect(result.needs_reply).toBe(false);
    expect(result.reason).toBe("Failed to parse analysis - skipping for safety");
    expect(result.priority).toBeUndefined();
  });

  test("analyze() includes userEmail in the prompt when provided", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push('{"needs_reply": false, "reason": "test"}');
    const email = makeEmail();

    await analyzer.analyze(email, "user@company.com");

    const requests = mock.calls;
    expect(requests[0].input).toContain("Your email address: user@company.com");
  });

  test("analyze() omits userEmail line when not provided", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push('{"needs_reply": false, "reason": "test"}');
    const email = makeEmail();

    await analyzer.analyze(email);

    const requests = mock.calls;
    expect(requests[0].input).not.toContain("Your email address:");
  });

  test("formatEmailForAnalysis truncates body at 4000 chars", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push('{"needs_reply": false, "reason": "test"}');
    const longBody = "A".repeat(5000);
    const email = makeEmail({ body: longBody });

    await analyzer.analyze(email);

    const requests = mock.calls;
    // Body should be truncated — the full message should contain the truncation marker
    expect(requests[0].input).toContain("[... email truncated ...]");
    // The original 5000-char body should NOT appear in full
    expect(requests[0].input).not.toContain("A".repeat(5000));
  });

  test("analyze() strips quoted content from email body", async () => {
    const { analyzer, mock } = createAnalyzerWithMock();
    mock.push(
      '{"needs_reply": true, "reason": "Direct question", "priority": "medium"}'
    );
    const email = makeEmail({
      body: "Can you review the budget?\n\nOn Jan 10, 2025, Bob wrote:\n> Here is the budget doc\n> Please take a look",
    });

    await analyzer.analyze(email);

    const requests = mock.calls;
    // Quoted content should be stripped — the "On ... wrote:" and ">" lines removed
    expect(requests[0].input).toContain("Can you review the budget?");
    expect(requests[0].input).not.toContain("Here is the budget doc");
  });
});
