import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { MockBuiltInLlmClient } from "../mocks/built-in-llm-mock";
import { runLearnerJsonPrompt } from "../../src/main/services/draft-edit-learner";

test.describe("draft-edit learner LLM routing", () => {
  test("runLearnerJsonPrompt uses json mode defaults and parses structured output", async () => {
    const mock = new MockBuiltInLlmClient();
    mock.push("```json\n[{\"content\":\"Prefer concise replies\"}]\n```");

    const result = await runLearnerJsonPrompt<Array<{ content: string }>>(
      mock,
      "provider-model",
      "Analyze this edit"
    );

    expect(result).toEqual([{ content: "Prefer concise replies" }]);
    expect(mock.calls).toHaveLength(1);
    expect(mock.calls[0]).toMatchObject({
      model: "provider-model",
      input: "Analyze this edit",
      mode: "json",
      maxOutputTokens: 1024,
    });
  });

  test("compose IPC wires draft learning through shared llm + feature model", () => {
    const code = readFileSync(
      path.join(process.cwd(), "src/main/ipc/compose.ipc.ts"),
      "utf-8"
    );

    expect(code).toContain("createBuiltInLlmClient");
    expect(code).toContain("const llm = createBuiltInLlmClient(config);");
    expect(code).toContain("model: getModelIdForFeature(\"drafts\")");
    expect(code).toContain("learnFromDraftEdit({");
    expect(code).toContain("}, {");
    expect(code).toContain("llm,");
    expect(code).toContain("model: getModelIdForFeature(\"drafts\")");
  });
});
