interface RuntimePlatformConfig {
  id: "cliproxyapi" | "sub2api";
  baseUrl?: string;
  apiKey?: string;
}

interface Env {
  CPA_BASE_URL?: string;
  CPA_API_KEY?: string;
  CLIPROXYAPI_BASE_URL?: string;
  CLIPROXYAPI_API_KEY?: string;
  SUB2API_BASE_URL?: string;
  SUB2API_API_KEY?: string;
}

const RUNTIME_API_KEY_SENTINEL = "__CF_RUNTIME_API_KEY__";

function pickEnvText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function buildRuntimePlatforms(env: Env): RuntimePlatformConfig[] {
  return [
    {
      id: "cliproxyapi",
      baseUrl: pickEnvText(env.CPA_BASE_URL, env.CLIPROXYAPI_BASE_URL),
      apiKey: pickEnvText(env.CPA_API_KEY, env.CLIPROXYAPI_API_KEY)
        ? RUNTIME_API_KEY_SENTINEL
        : undefined
    },
    {
      id: "sub2api",
      baseUrl: pickEnvText(env.SUB2API_BASE_URL),
      apiKey: pickEnvText(env.SUB2API_API_KEY) ? RUNTIME_API_KEY_SENTINEL : undefined
    }
  ];
}

export const onRequestGet: PagesFunction = (context) => {
  return new Response(
    JSON.stringify({
      platforms: buildRuntimePlatforms(context.env as Env)
    }),
    {
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
};
