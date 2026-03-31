/**
 * Unit tests for DraftGenerator logic.
 *
 * DraftGenerator imports enrichment-store → db → electron, which prevents
 * direct import in Playwright tests. We re-implement the testable logic
 * inline (following the pattern from pending-actions.spec.ts) and test the
 * core behaviors: reply-all CC extraction, reply address extraction,
 * draft creation flow, and provider-neutral LLM interaction pattern.
 */
import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";
import type { BuiltInLlmClient } from "../../src/main/llm/types";
import type { AnalysisResult, EAConfig } from "../../src/shared/types";
import { DEFAULT_DRAFT_PROMPT, DRAFT_FORMAT_SUFFIX } from "../../src/shared/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, "../../src");

// ---------------------------------------------------------------------------
// Re-implementation of DraftGenerator's extractReplyAllCc (private function)
// Identical to src/main/services/draft-generator.ts lines 19-33
// ---------------------------------------------------------------------------

function extractReplyAllCc(
  email: { from: string; to: string; cc?: string },
  userEmail: string
): string[] {
  const parseAddresses = (field: string): string[] =>
    (field.match(/[\w.+-]+@[\w.-]+\.\w+/g) || []).map((e) => e.toLowerCase());

  const senderEmail = parseAddresses(email.from)[0];
  const exclude = new Set(
    [senderEmail, userEmail.toLowerCase()].filter(Boolean)
  );

  const seen = new Set<string>();
  return [
    ...parseAddresses(email.to),
    ...(email.cc ? parseAddresses(email.cc) : []),
  ].filter((addr) => {
    const dominated = exclude.has(addr) || seen.has(addr);
    seen.add(addr);
    return !dominated;
  });
}

// ---------------------------------------------------------------------------
// Re-implementation of DraftGenerator's extractReplyAddress (private method)
// Identical to src/main/services/draft-generator.ts lines 254-258
// ---------------------------------------------------------------------------

function extractReplyAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from;
}

// ---------------------------------------------------------------------------
// Minimal DraftGenerator that mirrors the real class structure but avoids
// importing enrichment-store (and thus electron/db).
// ---------------------------------------------------------------------------

interface Email {
  id: string;
  threadId: string;
  from: string;
  to: string;
  cc?: string;
  subject: string;
  body: string;
  date: string;
  snippet: string;
  labelIds: string[];
}

interface DraftResult {
  emailId: string;
  threadId: string;
  subject: string;
  draftBody: string;
  draftId?: string;
  created: boolean;
  error?: string;
}

interface GeneratedDraftResponse {
  body: string;
  cc?: string[];
  calendaringResult?: {
    hasSchedulingContext: boolean;
    action: string;
    reason: string;
    eaDeferralLanguage?: string;
  };
}

interface MockGmailClient {
  createDraft(params: {
    to: string;
    subject: string;
    body: string;
    threadId: string;
  }): Promise<{ id: string } | undefined>;
}

class TestDraftGenerator {
  llm: BuiltInLlmClient;
  private model: string;
  private calendaringModel: string;
  private prompt: string;

  constructor(
    model: string = "claude-sonnet-4-20250514",
    prompt: string = DEFAULT_DRAFT_PROMPT,
    calendaringModel?: string,
    llmClient?: BuiltInLlmClient
  ) {
    this.llm = llmClient ?? new MockBuiltInLlmClient();
    this.model = model;
    this.calendaringModel = calendaringModel ?? model;
    this.prompt = prompt + DRAFT_FORMAT_SUFFIX;
  }

  async generateDraft(
    email: Email,
    analysis: AnalysisResult,
    eaConfig?: EAConfig,
    options?: { userEmail?: string }
  ): Promise<GeneratedDraftResponse> {
    let cc: string[] = [];
    let calendaringResult: GeneratedDraftResponse["calendaringResult"];

    if (options?.userEmail) {
      cc.push(...extractReplyAllCc(email, options.userEmail));
    }

    if (eaConfig?.enabled && eaConfig.email) {
      const calResponse = await this.llm.generate({
        model: this.calendaringModel,
        maxOutputTokens: 512,
        mode: "json",
        input: "calendaring analysis",
      });
      const parsed = JSON.parse(calResponse.text || "{}");
      calendaringResult = {
        hasSchedulingContext: Boolean(parsed.hasSchedulingContext),
        action: parsed.action || "none",
        reason: parsed.reason || "",
      };

      if (
        calendaringResult.hasSchedulingContext &&
        calendaringResult.action === "defer_to_ea"
      ) {
        cc.push(eaConfig.email);
      }
    }

    const response = await this.llm.generate({
      model: this.model,
      maxOutputTokens: 1024,
      mode: "text",
      input: `${this.prompt}
---
ANALYSIS (for context):
Reason for reply: ${analysis.reason}
Priority: ${analysis.priority || "medium"}

---
ORIGINAL EMAIL:

From: ${email.from}
To: ${email.to}
Subject: ${email.subject}
Date: ${email.date}

${email.body}`,
    });

    if (!response.text) {
      throw new Error("No text response from LLM");
    }

    return {
      body: response.text.trim(),
      cc: cc.length > 0 ? cc : undefined,
      calendaringResult,
    };
  }

  async composeNewEmail(
    to: string[],
    subject: string,
    instructions: string
  ): Promise<GeneratedDraftResponse> {
    const response = await this.llm.generate({
      model: this.model,
      maxOutputTokens: 1024,
      mode: "text",
      input: `${this.prompt}
---
Compose a new email (not a reply to an existing thread).

To: ${to.join(", ")}
Subject: ${subject}

INSTRUCTIONS:
${instructions}`,
    });

    if (!response.text) {
      throw new Error("No text response from LLM");
    }

    return { body: response.text.trim() };
  }

  async createDraft(
    gmailClient: MockGmailClient,
    email: Email,
    draftBody: string,
    dryRun: boolean = false
  ): Promise<DraftResult> {
    const replyTo = extractReplyAddress(email.from);
    const subject = email.subject.startsWith("Re:")
      ? email.subject
      : `Re: ${email.subject}`;

    if (dryRun) {
      return {
        emailId: email.id,
        threadId: email.threadId,
        subject,
        draftBody,
        created: false,
      };
    }

    try {
      const result = await gmailClient.createDraft({
        to: replyTo,
        subject,
        body: draftBody,
        threadId: email.threadId,
      });

      return {
        emailId: email.id,
        threadId: email.threadId,
        subject,
        draftBody,
        draftId: result?.id,
        created: true,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        emailId: email.id,
        threadId: email.threadId,
        subject,
        draftBody,
        created: false,
        error: errorMessage,
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: "msg-1",
    threadId: "thread-1",
    from: "Alice Smith <alice@example.com>",
    to: "user@company.com",
    subject: "Q3 Budget Review",
    body: "Hi, could you review the Q3 budget proposal?",
    date: "2025-01-15T10:00:00Z",
    snippet: "Hi, could you review...",
    labelIds: ["INBOX"],
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  return {
    needs_reply: true,
    reason: "Direct question about budget review",
    priority: "medium",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests - generateDraft
// ---------------------------------------------------------------------------

test.describe("DraftGenerator - generateDraft", () => {
  test("returns body text from Claude response", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push(
      "Thanks for sending the Q3 budget proposal. I'll review sections 3 and 4 and get back to you by Friday."
    );
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);

    const result = await generator.generateDraft(
      makeEmail(),
      makeAnalysis()
    );

    expect(result.body).toBe(
      "Thanks for sending the Q3 budget proposal. I'll review sections 3 and 4 and get back to you by Friday."
    );
  });

  test("includes reply-all CC recipients via extractReplyAllCc", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("Sounds good, let's coordinate.");
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);
    const email = makeEmail({
      from: "alice@example.com",
      to: "user@company.com, bob@example.com",
      cc: "carol@example.com",
    });

    const result = await generator.generateDraft(email, makeAnalysis(), undefined, {
      userEmail: "user@company.com",
    });

    expect(result.cc).toBeDefined();
    expect(result.cc).toContain("bob@example.com");
    expect(result.cc).toContain("carol@example.com");
    expect(result.cc).not.toContain("alice@example.com");
    expect(result.cc).not.toContain("user@company.com");
  });

  test("cc is undefined when no extra recipients", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("Will do.");
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);
    const email = makeEmail({
      from: "alice@example.com",
      to: "user@company.com",
    });

    const result = await generator.generateDraft(email, makeAnalysis(), undefined, {
      userEmail: "user@company.com",
    });

    expect(result.cc).toBeUndefined();
  });

  test("includes analysis context in the prompt", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("Reply body");
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);

    await generator.generateDraft(makeEmail(), makeAnalysis({
      reason: "Urgent budget question",
      priority: "high",
    }));

    const content = mock.calls[0].input;
    expect(content).toContain("Reason for reply: Urgent budget question");
    expect(content).toContain("Priority: high");
  });

  test("includes email details in the prompt", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("Reply body");
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);
    const email = makeEmail({
      from: "bob@corp.com",
      subject: "Project Update",
    });

    await generator.generateDraft(email, makeAnalysis());

    const content = mock.calls[0].input;
    expect(content).toContain("From: bob@corp.com");
    expect(content).toContain("Subject: Project Update");
  });

  test("uses text mode for draft generation and reuses same llm for calendaring", async () => {
    const mock = new MockBuiltInLlmClient();
    mock
      .push('{"hasSchedulingContext": true, "action": "defer_to_ea", "reason": "Scheduling request"}')
      .push("Draft body");
    const generator = new TestDraftGenerator("draft-model", DEFAULT_DRAFT_PROMPT, "cal-model", mock);

    const result = await generator.generateDraft(
      makeEmail(),
      makeAnalysis(),
      { enabled: true, email: "ea@company.com", name: "EA" }
    );

    expect(result.cc).toContain("ea@company.com");
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0].model).toBe("cal-model");
    expect(mock.calls[0].mode).toBe("json");
    expect(mock.calls[1].model).toBe("draft-model");
    expect(mock.calls[1].mode).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests - composeNewEmail
// ---------------------------------------------------------------------------

test.describe("DraftGenerator - composeNewEmail", () => {
  test("returns body for new email composition", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("Hi team, I wanted to share the project update for this sprint.");
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);

    const result = await generator.composeNewEmail(
      ["team@company.com"],
      "Sprint Update",
      "Write a brief project update"
    );

    expect(result.body).toBe(
      "Hi team, I wanted to share the project update for this sprint."
    );
    expect(result.cc).toBeUndefined();
    expect(result.calendaringResult).toBeUndefined();
  });

  test("includes recipients and instructions in the prompt", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("Draft body");
    const generator = new TestDraftGenerator("claude-sonnet-4-20250514", DEFAULT_DRAFT_PROMPT, undefined, mock);

    await generator.composeNewEmail(
      ["alice@example.com", "bob@example.com"],
      "Hello",
      "Introduce yourself"
    );

    const content = mock.calls[0].input;
    expect(content).toContain("alice@example.com, bob@example.com");
    expect(content).toContain("Hello");
    expect(content).toContain("Introduce yourself");
    expect(mock.calls[0].mode).toBe("text");
  });
});

// ---------------------------------------------------------------------------
// Tests - createDraft
// ---------------------------------------------------------------------------

test.describe("DraftGenerator - createDraft", () => {
  test("calls gmailClient.createDraft with correct params", async () => {
    const generator = new TestDraftGenerator();
    const email = makeEmail();
    const createdDrafts: Array<{ to: string; subject: string; body: string; threadId: string }> = [];
    const mockGmailClient: MockGmailClient = {
      createDraft: async (params) => {
        createdDrafts.push(params);
        return { id: "draft-123" };
      },
    };

    const result = await generator.createDraft(
      mockGmailClient,
      email,
      "Here is my reply."
    );

    expect(createdDrafts).toHaveLength(1);
    expect(createdDrafts[0].to).toBe("alice@example.com");
    expect(createdDrafts[0].subject).toBe("Re: Q3 Budget Review");
    expect(createdDrafts[0].body).toBe("Here is my reply.");
    expect(createdDrafts[0].threadId).toBe("thread-1");
    expect(result.created).toBe(true);
    expect(result.draftId).toBe("draft-123");
    expect(result.emailId).toBe("msg-1");
  });

  test("preserves existing Re: prefix in subject", async () => {
    const generator = new TestDraftGenerator();
    const email = makeEmail({ subject: "Re: Q3 Budget Review" });
    const createdDrafts: Array<{ to: string; subject: string; body: string; threadId: string }> = [];
    const mockGmailClient: MockGmailClient = {
      createDraft: async (params) => {
        createdDrafts.push(params);
        return { id: "draft-456" };
      },
    };

    await generator.createDraft(mockGmailClient, email, "Reply body");

    expect(createdDrafts[0].subject).toBe("Re: Q3 Budget Review");
  });

  test("in dry run mode does not call Gmail", async () => {
    const generator = new TestDraftGenerator();
    const email = makeEmail();
    let gmailCalled = false;
    const mockGmailClient: MockGmailClient = {
      createDraft: async () => {
        gmailCalled = true;
        return { id: "draft-789" };
      },
    };

    const result = await generator.createDraft(
      mockGmailClient,
      email,
      "Draft body",
      true // dryRun
    );

    expect(gmailCalled).toBe(false);
    expect(result.created).toBe(false);
    expect(result.draftBody).toBe("Draft body");
    expect(result.subject).toBe("Re: Q3 Budget Review");
    expect(result.error).toBeUndefined();
  });

  test("handles error gracefully", async () => {
    const generator = new TestDraftGenerator();
    const email = makeEmail();
    const mockGmailClient: MockGmailClient = {
      createDraft: async () => {
        throw new Error("Gmail API rate limit exceeded");
      },
    };

    const result = await generator.createDraft(
      mockGmailClient,
      email,
      "Draft body"
    );

    expect(result.created).toBe(false);
    expect(result.error).toBe("Gmail API rate limit exceeded");
    expect(result.emailId).toBe("msg-1");
  });
});

test("DraftGenerator source accepts BuiltInLlmClient injection", () => {
  const code = readFileSync(path.join(srcDir, "main/services/draft-generator.ts"), "utf-8");
  expect(code).toContain("import { createBuiltInLlmClient } from \"../llm\";");
  expect(code).toContain("import type { BuiltInLlmClient } from \"../llm/types\";");
  expect(code).toContain("constructor(model: string = \"claude-sonnet-4-20250514\", prompt: string = DEFAULT_DRAFT_PROMPT, calendaringModel?: string, llmClient?: BuiltInLlmClient)");
  expect(code).toContain("this.llm = llmClient ?? createBuiltInLlmClient({ anthropicApiKey: process.env.ANTHROPIC_API_KEY });");
  expect(code).toContain("const calAgent = new CalendaringAgent(this.calendaringModel, undefined, this.llm);");
  expect(code).toContain("mode: \"text\"");
});

// ---------------------------------------------------------------------------
// Tests - extractReplyAddress (standalone function test)
// ---------------------------------------------------------------------------

test.describe("extractReplyAddress", () => {
  test('handles "Name <email>" format', () => {
    expect(extractReplyAddress("Alice Smith <alice@example.com>")).toBe(
      "alice@example.com"
    );
  });

  test("handles bare email format", () => {
    expect(extractReplyAddress("alice@example.com")).toBe("alice@example.com");
  });

  test("handles email with special chars in name", () => {
    expect(
      extractReplyAddress('"O\'Brien, John" <john@example.com>')
    ).toBe("john@example.com");
  });
});

// ---------------------------------------------------------------------------
// Tests - extractReplyAllCc (standalone function test)
// ---------------------------------------------------------------------------

test.describe("extractReplyAllCc", () => {
  test("extracts CC recipients excluding sender and user", () => {
    const result = extractReplyAllCc(
      {
        from: "alice@example.com",
        to: "user@company.com, bob@example.com",
        cc: "carol@example.com",
      },
      "user@company.com"
    );

    expect(result).toEqual(["bob@example.com", "carol@example.com"]);
  });

  test("handles Name <email> format", () => {
    const result = extractReplyAllCc(
      {
        from: "Alice <alice@example.com>",
        to: "User <user@company.com>, Bob <bob@example.com>",
      },
      "user@company.com"
    );

    expect(result).toEqual(["bob@example.com"]);
  });

  test("deduplicates addresses", () => {
    const result = extractReplyAllCc(
      {
        from: "alice@example.com",
        to: "user@company.com, bob@example.com",
        cc: "bob@example.com",
      },
      "user@company.com"
    );

    expect(result).toEqual(["bob@example.com"]);
  });

  test("returns empty array when only sender and user", () => {
    const result = extractReplyAllCc(
      {
        from: "alice@example.com",
        to: "user@company.com",
      },
      "user@company.com"
    );

    expect(result).toEqual([]);
  });

  test("is case-insensitive", () => {
    const result = extractReplyAllCc(
      {
        from: "Alice@Example.COM",
        to: "USER@Company.com, bob@example.com",
      },
      "user@company.com"
    );

    expect(result).toEqual(["bob@example.com"]);
  });
});
