import { useState, useEffect, useCallback } from "react";
import { DEFAULT_LLM_CONFIG, type IpcResponse, type Config, type LlmConfig, type BuiltInLlmProviderId } from "../../shared/types";
import { reconfigurePostHog } from "../services/posthog";
import { useAppStore } from "../store";

interface SetupWizardProps {
  onComplete: () => void;
}

type Step = "loading" | "credentials" | "apikey" | "oauth" | "extensions" | "analytics";

interface ExtensionAuthInfo {
  extensionId: string;
  displayName: string;
  needsAuth: boolean;
  authType: "extension" | "agent";
}

interface SetupAuthState {
  hasCredentials: boolean;
  hasTokens: boolean;
  defaultProvider: BuiltInLlmProviderId;
  hasDefaultBuiltInProviderAuth: boolean;
  configuredProviders: BuiltInLlmProviderId[];
}

const BUILT_IN_PROVIDER_META: Record<
  BuiltInLlmProviderId,
  { label: string; keyLabel: string; keyPlaceholder: string; helperUrl: string }
> = {
  anthropic: {
    label: "Anthropic",
    keyLabel: "Anthropic API Key",
    keyPlaceholder: "sk-ant-...",
    helperUrl: "https://console.anthropic.com/settings/keys",
  },
  openai: {
    label: "OpenAI",
    keyLabel: "OpenAI API Key",
    keyPlaceholder: "sk-proj-...",
    helperUrl: "https://platform.openai.com/api-keys",
  },
};

function normalizeWizardLlmConfig(config?: Config["llm"]): LlmConfig {
  return {
    ...DEFAULT_LLM_CONFIG,
    ...config,
    providers: {
      anthropic: {
        ...DEFAULT_LLM_CONFIG.providers.anthropic,
        ...config?.providers?.anthropic,
      },
      openai: {
        ...DEFAULT_LLM_CONFIG.providers.openai,
        ...config?.providers?.openai,
      },
    },
    featureTiers: {
      ...DEFAULT_LLM_CONFIG.featureTiers,
      ...config?.featureTiers,
    },
  };
}

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const setDefaultAgentProviderId = useAppStore((state) => state.setDefaultAgentProviderId);
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Track which steps are in the flow (determined at init)
  const [visibleSteps, setVisibleSteps] = useState<Step[]>([]);

  // Google OAuth credentials input
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleClientSecret, setGoogleClientSecret] = useState("");

  // API key input
  const [apiKey, setApiKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<BuiltInLlmProviderId>("anthropic");
  const [configuredProviders, setConfiguredProviders] = useState<BuiltInLlmProviderId[]>([]);
  const [llmConfig, setLlmConfig] = useState<LlmConfig>(DEFAULT_LLM_CONFIG);

  // Extension auth state
  const [extensionAuths, setExtensionAuths] = useState<ExtensionAuthInfo[]>([]);
  const [authenticatingExtension, setAuthenticatingExtension] = useState<string | null>(null);

  // Analytics opt-in (default ON — session replay is bundled under analytics)
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);

  const enterExtensionsStep = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await window.api.extensions.getPendingAuths() as IpcResponse<ExtensionAuthInfo[]>;
      if (result.success && result.data.length > 0 && result.data.some((ext) => ext.needsAuth)) {
        setExtensionAuths(result.data.filter((ext) => ext.needsAuth));
        setStep("extensions");
        setIsLoading(false);
      } else {
        if (!result.success) {
          console.error("[SetupWizard] getPendingAuths failed:", result.error);
        }
        setVisibleSteps((prev) => prev.filter((s) => s !== "extensions"));
        setIsLoading(false);
        setStep("analytics");
      }
    } catch (err) {
      console.error("[SetupWizard] getPendingAuths failed:", err);
      setVisibleSteps((prev) => prev.filter((s) => s !== "extensions"));
      setIsLoading(false);
      setStep("analytics");
    }
  }, []);

  // Check what's already configured and skip to the right step.
  useEffect(() => {
    let cancelled = false;

    Promise.all([
      window.api.gmail.checkAuth() as Promise<IpcResponse<SetupAuthState>>,
      window.api.settings.get() as Promise<IpcResponse<Config>>,
    ])
      .then(([authResult, settingsResult]) => {
        if (cancelled) return;

        const fallbackAuth: SetupAuthState = {
          hasCredentials: false,
          hasTokens: false,
          defaultProvider: "anthropic",
          hasDefaultBuiltInProviderAuth: false,
          configuredProviders: [],
        };
        const authState = authResult.success ? authResult.data : fallbackAuth;
        const nextLlmConfig = settingsResult.success
          ? normalizeWizardLlmConfig(settingsResult.data.llm)
          : DEFAULT_LLM_CONFIG;

        setConfiguredProviders(authState.configuredProviders);
        setLlmConfig({
          ...nextLlmConfig,
          defaultProvider: authState.defaultProvider,
        });
        setSelectedProvider(authState.defaultProvider);
        setDefaultAgentProviderId(authState.defaultProvider === "openai" ? "openai" : "claude");

        const flow: Step[] = [];
        if (!authState.hasCredentials) flow.push("credentials");
        if (!authState.hasDefaultBuiltInProviderAuth) flow.push("apikey");
        if (!authState.hasTokens) flow.push("oauth");
        flow.push("extensions");
        flow.push("analytics");
        setVisibleSteps(flow);

        if (!authState.hasCredentials) {
          setStep("credentials");
        } else if (!authState.hasDefaultBuiltInProviderAuth) {
          setStep("apikey");
        } else if (!authState.hasTokens) {
          setStep("oauth");
        } else {
          void enterExtensionsStep();
        }
      })
      .catch(() => {
        if (cancelled) return;
        setVisibleSteps(["credentials", "apikey", "oauth", "extensions", "analytics"]);
        setStep("credentials");
      });

    return () => {
      cancelled = true;
    };
  }, [enterExtensionsStep, setDefaultAgentProviderId]);

  const handleSaveCredentials = async () => {
    if (!googleClientId.trim() || !googleClientSecret.trim()) {
      setError("Both Client ID and Client Secret are required");
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.api.gmail.saveCredentials(googleClientId.trim(), googleClientSecret.trim()) as IpcResponse<void>;
      if (result.success) {
        const credIdx = visibleSteps.indexOf("credentials");
        const next = visibleSteps[credIdx + 1];
        if (next) {
          setStep(next);
        } else {
          setStep("apikey");
        }
      } else {
        setError(result.error ?? "Failed to save credentials");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveApiKey = async () => {
    const trimmedApiKey = apiKey.trim();
    const existingProviderApiKey = llmConfig.providers[selectedProvider].apiKey?.trim() || "";

    if (!trimmedApiKey && !existingProviderApiKey) {
      setError(`Please enter your ${BUILT_IN_PROVIDER_META[selectedProvider].keyLabel}`);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      if (trimmedApiKey && trimmedApiKey !== existingProviderApiKey) {
        const validation = await window.api.settings.validateProviderApiKey(selectedProvider, trimmedApiKey) as IpcResponse<void>;
        if (!validation.success) {
          setError(validation.error ?? "Invalid API key");
          return;
        }
      }

      const nextLlmConfig: LlmConfig = {
        ...llmConfig,
        defaultProvider: selectedProvider,
        providers: {
          ...llmConfig.providers,
          [selectedProvider]: {
            ...llmConfig.providers[selectedProvider],
            apiKey: trimmedApiKey || existingProviderApiKey || undefined,
          },
        },
      };

      const result = await window.api.settings.set({
        llm: {
          ...nextLlmConfig,
          defaultProvider: selectedProvider,
        },
        anthropicApiKey: nextLlmConfig.providers.anthropic.apiKey?.trim() || undefined,
      }) as IpcResponse<void>;
      if (result.success) {
        setLlmConfig(nextLlmConfig);
        setConfiguredProviders((prev) =>
          prev.includes(selectedProvider) ? prev : [...prev, selectedProvider]
        );
        setDefaultAgentProviderId(selectedProvider === "openai" ? "openai" : "claude");
        window.api.agent.providers?.();

        const authResult = await window.api.gmail.checkAuth() as IpcResponse<SetupAuthState>;
        if (authResult.success && authResult.data.hasTokens) {
          setConfiguredProviders(authResult.data.configuredProviders);
          await enterExtensionsStep();
        } else {
          setStep("oauth");
        }
      } else {
        setError(result.error ?? "Failed to save API key");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOAuth = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.api.gmail.startOAuth();
      if (result.success) {
        await enterExtensionsStep();
      } else {
        setError(result.error);
        setIsLoading(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authorization failed. Please try again.");
      setIsLoading(false);
    }
  };

  const handleExtensionAuth = async (extensionId: string, authType: "extension" | "agent") => {
    setAuthenticatingExtension(extensionId);
    setError(null);

    try {
      let success = false;
      if (authType === "agent") {
        const result = await window.api.agent.authenticate(extensionId) as IpcResponse<{ success: boolean }>;
        if (result.success) {
          success = result.data.success;
        }
        if (!success) {
          setError(!result.success ? (result.error ?? "Authentication failed") : "Authentication failed or was cancelled");
        }
      } else {
        const result = await window.api.extensions.authenticate(extensionId) as IpcResponse<void>;
        success = result.success;
        if (!result.success) {
          setError(result.error ?? "Authentication failed");
        }
      }

      if (success) {
        setExtensionAuths((prev) =>
          prev.map((ext) =>
            ext.extensionId === extensionId ? { ...ext, needsAuth: false } : ext
          )
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setAuthenticatingExtension(null);
    }
  };

  // Step indicator — only show steps the user will actually visit
  const currentStepIndex = visibleSteps.indexOf(step);

  return (
    <div className="h-screen flex flex-col bg-gray-100 dark:bg-gray-900">
      {/* Titlebar */}
      <div className="titlebar-drag h-12 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center px-4">
        <div className="w-20" /> {/* Space for traffic lights */}
        <h1 className="text-lg font-semibold text-gray-800 dark:text-gray-200">Exo Setup</h1>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-xl w-full bg-white dark:bg-gray-800 rounded-xl shadow-lg dark:shadow-black/40 p-8">
          {step === "loading" && (
            <div className="flex justify-center">
              <div className="w-8 h-8 border-4 border-blue-200 dark:border-blue-800 border-t-blue-600 dark:border-t-blue-400 rounded-full animate-spin" />
            </div>
          )}

          {step === "credentials" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Google Cloud Credentials
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Exo needs Google OAuth credentials to access your Gmail account.
                You'll need to create a Google Cloud project with the Gmail API enabled.
              </p>

              <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg mb-6">
                <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">Setup steps:</h3>
                <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-2 list-decimal list-inside">
                  <li>
                    Go to the{" "}
                    <a
                      href="https://console.cloud.google.com/apis/credentials"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                    >
                      Google Cloud Console
                    </a>
                  </li>
                  <li>Create a project (or select an existing one)</li>
                  <li>Enable the <strong>Gmail API</strong> and <strong>Google Calendar API</strong></li>
                  <li>Go to Credentials → Create Credentials → OAuth client ID</li>
                  <li>Choose <strong>Desktop app</strong> as the application type</li>
                  <li>Copy the Client ID and Client Secret below</li>
                </ol>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Client ID
                  </label>
                  <input
                    type="text"
                    value={googleClientId}
                    onChange={(e) => setGoogleClientId(e.target.value)}
                    placeholder="your-client-id.apps.google..."
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Client Secret
                  </label>
                  <input
                    type="password"
                    value={googleClientSecret}
                    onChange={(e) => setGoogleClientSecret(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !isLoading && handleSaveCredentials()}
                    placeholder="your-client-secret"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              )}

              <button
                onClick={handleSaveCredentials}
                disabled={isLoading || !googleClientId.trim() || !googleClientSecret.trim()}
                className="w-full py-3 bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Saving..." : "Continue"}
              </button>
            </>
          )}

          {step === "apikey" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Built-in AI Provider
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Choose which provider powers Exo’s built-in AI features. Memories, prompts, and learned behavior stay shared when you switch.
              </p>

              <div className="flex flex-wrap gap-2 mb-6">
                {(Object.keys(BUILT_IN_PROVIDER_META) as BuiltInLlmProviderId[]).map((provider) => (
                  <button
                    key={provider}
                    onClick={() => {
                      setSelectedProvider(provider);
                      setApiKey("");
                      setError(null);
                    }}
                    data-active={selectedProvider === provider ? "true" : undefined}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      selectedProvider === provider
                        ? "bg-blue-600 dark:bg-blue-500 text-white"
                        : "bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                    }`}
                  >
                    {BUILT_IN_PROVIDER_META[provider].label}
                  </button>
                ))}
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-lg mb-6">
                <h3 className="font-semibold text-blue-900 dark:text-blue-200 mb-2">
                  {BUILT_IN_PROVIDER_META[selectedProvider].label} setup
                </h3>
                <ol className="text-sm text-blue-800 dark:text-blue-300 space-y-2 list-decimal list-inside">
                  <li>
                    Go to{" "}
                    <a
                      href={BUILT_IN_PROVIDER_META[selectedProvider].helperUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:no-underline"
                    >
                      {BUILT_IN_PROVIDER_META[selectedProvider].helperUrl.replace(/^https?:\/\//, "")}
                    </a>
                  </li>
                  <li>Create a new API key (or use an existing one)</li>
                  <li>Paste it below, or keep the saved key and continue</li>
                </ol>
              </div>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {BUILT_IN_PROVIDER_META[selectedProvider].keyLabel}
                  </label>
                  <input
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !isLoading && handleSaveApiKey()}
                    placeholder={BUILT_IN_PROVIDER_META[selectedProvider].keyPlaceholder}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                {configuredProviders.includes(selectedProvider) && !apiKey.trim() && (
                  <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-sm text-green-800 dark:text-green-300">
                    A saved {BUILT_IN_PROVIDER_META[selectedProvider].label} key is already available. Continue to make it the default provider.
                  </div>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              )}

              <button
                onClick={handleSaveApiKey}
                disabled={isLoading}
                className="w-full py-3 bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Saving..." : "Continue"}
              </button>
            </>
          )}

          {step === "oauth" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Authorize Gmail Access
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Click the button below to authorize Exo to read your emails and create
                drafts. A browser window will open for you to sign in with Google.
              </p>

              <div className="bg-yellow-50 dark:bg-yellow-900/30 p-4 rounded-lg mb-6">
                <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-2">Permissions requested:</h3>
                <ul className="text-sm text-yellow-800 dark:text-yellow-300 space-y-1 list-disc list-inside">
                  <li>Read your emails (gmail.readonly)</li>
                  <li>Create draft emails (gmail.compose)</li>
                  <li>View your calendar events (calendar.readonly)</li>
                </ul>
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              )}

              <button
                onClick={handleStartOAuth}
                disabled={isLoading}
                className="w-full py-3 bg-green-600 dark:bg-green-500 text-white font-medium rounded-lg hover:bg-green-700 dark:hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                {isLoading ? "Authorizing..." : "Authorize with Google"}
              </button>
            </>
          )}

          {step === "extensions" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Connect Services
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                Some extensions need authentication to enrich your emails. You can connect them now or later.
              </p>

              <div className="space-y-3 mb-6">
                {extensionAuths.map((ext) => (
                  <div
                    key={ext.extensionId}
                    className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 rounded-lg"
                  >
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {ext.displayName}
                    </span>
                    {ext.needsAuth ? (
                      <button
                        onClick={() => handleExtensionAuth(ext.extensionId, ext.authType)}
                        disabled={authenticatingExtension !== null}
                        className="px-4 py-1.5 text-sm bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50"
                      >
                        {authenticatingExtension === ext.extensionId ? (
                          <span className="flex items-center gap-2">
                            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                            Connecting...
                          </span>
                        ) : (
                          "Login"
                        )}
                      </button>
                    ) : (
                      <span className="text-green-600 dark:text-green-400 flex items-center gap-1.5">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                        Connected
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {error && (
                <div className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-lg mb-4">
                  <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
              )}

              <button
                onClick={() => setStep("analytics")}
                disabled={authenticatingExtension !== null}
                className="w-full py-3 bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                Continue
              </button>
            </>
          )}

          {step === "analytics" && (
            <>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-4">
                Help Improve Exo
              </h2>
              <p className="text-gray-600 dark:text-gray-400 mb-6">
                We collect usage data and error reports to improve the app.
                No email content is ever sent — only app interactions and crash diagnostics.
                Your email address is sent so we can identify you in error reports.
                You can change this anytime in Settings.
              </p>

              <label className="flex items-center justify-between p-4 border border-gray-200 dark:border-gray-600 rounded-lg cursor-pointer mb-6">
                <div>
                  <div className="font-medium text-gray-900 dark:text-gray-100">Usage Analytics</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400">Crash reports, app usage data, and session recordings for debugging</div>
                </div>
                <div
                  role="switch"
                  aria-checked={analyticsEnabled}
                  onClick={() => setAnalyticsEnabled(!analyticsEnabled)}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${
                    analyticsEnabled ? "bg-blue-600 dark:bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    analyticsEnabled ? "translate-x-6" : "translate-x-1"
                  }`} />
                </div>
              </label>

              <button
                onClick={async () => {
                  setIsLoading(true);
                  try {
                    // Session replay is bundled with analytics — both on or both off
                    const result = await window.api.settings.set({
                      posthog: { enabled: analyticsEnabled, sessionReplay: analyticsEnabled },
                    }) as IpcResponse<void>;
                    if (!result.success) {
                      console.error("[SetupWizard] Failed to save analytics config");
                      // Analytics save failure is non-critical — still complete wizard
                    }
                    // Only reconfigure if save succeeded — prevents runtime/persisted state divergence
                    const apiKey = import.meta.env.VITE_POSTHOG_API_KEY;
                    const host = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
                    if (apiKey && result.success) {
                      reconfigurePostHog({
                        enabled: analyticsEnabled,
                        apiKey,
                        host,
                        sessionReplay: analyticsEnabled,
                      });
                    }
                    onComplete();
                  } finally {
                    setIsLoading(false);
                  }
                }}
                disabled={isLoading}
                className="w-full py-3 bg-blue-600 dark:bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-700 dark:hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                Get Started
              </button>
            </>
          )}

          {/* Step indicator — only shows steps the user will actually visit */}
          {step !== "loading" && visibleSteps.length > 0 && (
            <div className="flex justify-center gap-2 mt-6">
              {visibleSteps.map((s, i) => (
                <div
                  key={s}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i <= currentStepIndex
                      ? "bg-blue-600 dark:bg-blue-400"
                      : "bg-gray-300 dark:bg-gray-600"
                  }`}
                />
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
