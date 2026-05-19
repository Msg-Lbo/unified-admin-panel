interface ProxyRequestPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
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

function isSafeTarget(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function appendParams(target: URL, params?: Record<string, unknown>): void {
  if (!params || typeof params !== "object") {
    return;
  }
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") {
      continue;
    }
    target.searchParams.set(key, String(value));
  }
}

function sanitizeHeaders(input?: Record<string, string>): Headers {
  const headers = new Headers();
  if (!input || typeof input !== "object") {
    return headers;
  }
  for (const [key, value] of Object.entries(input)) {
    if (!value) {
      continue;
    }
    const normalized = key.toLowerCase();
    if (
      normalized === "host" ||
      normalized === "origin" ||
      normalized === "referer" ||
      normalized === "content-length"
    ) {
      continue;
    }
    headers.set(key, value);
  }
  return headers;
}

function buildBody(method: string, data: unknown): string | undefined {
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  if (data === undefined || data === null) {
    return undefined;
  }
  return JSON.stringify(data);
}

function buildResponseHeaders(upstream: Headers): Headers {
  const output = new Headers();
  const passHeaders = [
    "content-type",
    "cache-control",
    "etag",
    "last-modified"
  ];
  for (const header of passHeaders) {
    const value = upstream.get(header);
    if (value) {
      output.set(header, value);
    }
  }
  return output;
}

function pickEnvText(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) {
      return normalized;
    }
  }
  return undefined;
}

function getRuntimeApiKeyForRequest(
  url: URL,
  headers: Headers,
  env: Env
): string | undefined {
  const platform = headers.get("x-uap-platform")?.trim().toLowerCase();
  if (platform === "cliproxyapi") {
    return pickEnvText(env.CPA_API_KEY, env.CLIPROXYAPI_API_KEY);
  }
  if (platform === "sub2api") {
    return pickEnvText(env.SUB2API_API_KEY);
  }

  const cpaBaseUrl = pickEnvText(env.CPA_BASE_URL, env.CLIPROXYAPI_BASE_URL);
  if (cpaBaseUrl) {
    try {
      const parsed = new URL(cpaBaseUrl);
      if (parsed.origin === url.origin) {
        return pickEnvText(env.CPA_API_KEY, env.CLIPROXYAPI_API_KEY);
      }
    } catch {
      // Ignore invalid optional runtime config.
    }
  }

  const sub2apiBaseUrl = pickEnvText(env.SUB2API_BASE_URL);
  if (sub2apiBaseUrl) {
    try {
      const parsed = new URL(sub2apiBaseUrl);
      if (parsed.origin === url.origin) {
        return pickEnvText(env.SUB2API_API_KEY);
      }
    } catch {
      // Ignore invalid optional runtime config.
    }
  }
  return undefined;
}

export const onRequestPost: PagesFunction = async (context) => {
  let payload: ProxyRequestPayload;
  try {
    payload = (await context.request.json()) as ProxyRequestPayload;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload." }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  }

  const targetRaw = String(payload.url ?? "").trim();
  if (!targetRaw || !isSafeTarget(targetRaw)) {
    return new Response(
      JSON.stringify({ error: "Invalid target url." }),
      {
        status: 400,
        headers: { "content-type": "application/json; charset=utf-8" }
      }
    );
  }

  const method = String(payload.method ?? "GET").toUpperCase();
  const targetUrl = new URL(targetRaw);
  appendParams(targetUrl, payload.params);
  const headers = sanitizeHeaders(payload.headers);
  const body = buildBody(method, payload.data);
  const runtimeApiKey = getRuntimeApiKeyForRequest(targetUrl, headers, context.env as Env);
  if (runtimeApiKey) {
    if (headers.get("authorization") === `Bearer ${RUNTIME_API_KEY_SENTINEL}`) {
      headers.set("authorization", `Bearer ${runtimeApiKey}`);
    }
    if (headers.get("x-api-key") === RUNTIME_API_KEY_SENTINEL) {
      headers.set("x-api-key", runtimeApiKey);
    }
    if (headers.get("x-management-key") === RUNTIME_API_KEY_SENTINEL) {
      headers.set("x-management-key", runtimeApiKey);
    }
  }
  headers.delete("x-uap-platform");

  if (body && !headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      method,
      headers,
      body,
      redirect: "follow"
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Upstream request failed.";
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const responseHeaders = buildResponseHeaders(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders
  });
};
