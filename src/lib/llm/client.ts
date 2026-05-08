import Anthropic from "@anthropic-ai/sdk";

// Single shared client — API key set via environment variable at build time
// or injected via Tauri's env passthrough.
let _client: Anthropic | null = null;

export function getClient(apiKey?: string): Anthropic {
  if (!_client) {
    _client = new Anthropic({
      apiKey: apiKey ?? import.meta.env.VITE_ANTHROPIC_API_KEY ?? "",
      dangerouslyAllowBrowser: true, // required inside Tauri WebView
    });
  }
  return _client;
}

export function resetClient(): void {
  _client = null;
}
