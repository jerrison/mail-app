import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";
import { extractPriorityPreferences } from "../../src/main/services/analysis-edit-learner";

test.describe("analysis-edit learner LLM routing", () => {
  test("extractPriorityPreferences uses injected llm/model and parses json output", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("[{\"scope\":\"person\",\"scopeValue\":null,\"content\":\"Emails from this sender always need a reply\",\"emailContext\":\"manager check-ins\"}]");
    const previousDemoMode = process.env.EXO_DEMO_MODE;
    delete process.env.EXO_DEMO_MODE;
    let result;
    try {
      result = await extractPriorityPreferences({
        llm: mock,
        model: "analysis-model",
        override: {
          emailId: "email-1",
          accountId: "acct-1",
          senderEmail: "boss@company.com",
          senderDomain: "company.com",
          subject: "Need your approval",
          bodySnippet: "Can you review this by EOD?",
          originalNeedsReply: false,
          originalPriority: null,
          newNeedsReply: true,
          newPriority: "high",
        },
      });
    } finally {
      process.env.EXO_DEMO_MODE = previousDemoMode;
    }

    expect(result).toEqual([
      {
        scope: "person",
        scopeValue: "boss@company.com",
        content: "Emails from this sender always need a reply",
        emailContext: "manager check-ins",
      },
    ]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({
      model: "analysis-model",
      mode: "json",
      maxOutputTokens: 1024,
    });
  });

  test("analysis IPC wires priority learning through shared llm + analysis model", () => {
    const code = readFileSync(
      path.join(process.cwd(), "src/main/ipc/analysis.ipc.ts"),
      "utf-8"
    );

    expect(code).toContain("const llm = createBuiltInLlmClient(config);");
    expect(code).toContain("const model = getModelIdForFeature(\"analysis\")");
    expect(code).toContain("learnFromPriorityOverrideWithReason({");
    expect(code).toContain("learnFromPriorityOverrideInferred({");
    expect(code).toContain("}, {");
    expect(code).toContain("llm,");
    expect(code).toContain("model,");
  });
});
