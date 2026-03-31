import type { ExtensionContext, ExtensionAPI, ExtensionModule } from "../../../shared/extension-types";
import { createBuiltInLlmClient } from "../../../main/llm";
import { getConfig, getModelIdForFeature } from "../../../main/ipc/settings.ipc";
import { createWebSearchProvider } from "./web-search-provider";

/**
 * Web Search Extension for Mail Client
 * Looks up sender information using web search
 */
const extension: ExtensionModule = {
  async activate(context: ExtensionContext, api: ExtensionAPI): Promise<void> {
    context.logger.info("Activating web-search extension");

    // Register the enrichment provider.
    // Model resolver is injected here (entry point) rather than deep in the provider,
    // keeping the provider decoupled from Electron main-process internals.
    const provider = createWebSearchProvider(context, {
      resolveModel: () => getModelIdForFeature("senderLookup"),
      searchWeb: async ({ model, prompt }) => {
        const llm = createBuiltInLlmClient(getConfig());
        const response = await llm.generate({
          model,
          input: prompt,
          mode: "json",
          webSearch: true,
          maxOutputTokens: 200,
        });

        return response.text;
      },
    });
    api.registerEnrichmentProvider(provider);

    context.logger.info("Web-search extension activated");
  },

  async deactivate(): Promise<void> {
    console.log("[Ext:web-search] Deactivated");
  },
};

export const { activate, deactivate } = extension;
