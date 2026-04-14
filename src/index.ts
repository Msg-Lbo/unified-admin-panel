interface ProxyRequestPayload {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  params?: Record<string, unknown>;
  data?: unknown;
}

interface AssetFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface Env {
  ASSETS: AssetFetcher;
}

function jsonResponse(status: number, payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

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

function buildProxyResponseHeaders(upstream: Headers): Headers {
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

async function handleProxy(request: Request): Promise<Response> {
  let payload: ProxyRequestPayload;
  try {
    payload = (await request.json()) as ProxyRequestPayload;
  } catch {
    return jsonResponse(400, { error: "Invalid JSON payload." });
  }

  const targetRaw = String(payload.url ?? "").trim();
  if (!targetRaw || !isSafeTarget(targetRaw)) {
    return jsonResponse(400, { error: "Invalid target url." });
  }

  const method = String(payload.method ?? "GET").toUpperCase();
  const targetUrl = new URL(targetRaw);
  appendParams(targetUrl, payload.params);
  const headers = sanitizeHeaders(payload.headers);
  const body = buildBody(method, payload.data);

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
    return jsonResponse(502, {
      error: error instanceof Error ? error.message : "Upstream request failed."
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: buildProxyResponseHeaders(upstream.headers)
  });
}

function shouldServeSpaIndex(request: Request, url: URL, response: Response): boolean {
  if (response.status !== 404 || request.method !== "GET") {
    return false;
  }
  if (url.pathname.startsWith("/api/")) {
    return false;
  }
  if (url.pathname.includes(".")) {
    return false;
  }
  return true;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/proxy" && request.method === "POST") {
      return handleProxy(request);
    }

    const response = await env.ASSETS.fetch(request);
    if (!shouldServeSpaIndex(request, url, response)) {
      return response;
    }

    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl.toString(), request));
  }
};
