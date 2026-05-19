import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

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

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });
    request.on("error", reject);
  });
}

function sendJson(
  response: import("node:http").ServerResponse,
  statusCode: number,
  payload: Record<string, unknown>
): void {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function createDevProxyPlugin() {
  return {
    name: "dev-api-proxy",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/api/config", (req, res, next) => {
        if (req.method !== "GET") {
          return next();
        }
        sendJson(res, 200, {
          platforms: [
            {
              id: "cliproxyapi",
              baseUrl: pickEnvText(process.env.CPA_BASE_URL, process.env.CLIPROXYAPI_BASE_URL),
              apiKey: pickEnvText(process.env.CPA_API_KEY, process.env.CLIPROXYAPI_API_KEY)
                ? RUNTIME_API_KEY_SENTINEL
                : undefined
            },
            {
              id: "sub2api",
              baseUrl: pickEnvText(process.env.SUB2API_BASE_URL),
              apiKey: pickEnvText(process.env.SUB2API_API_KEY)
                ? RUNTIME_API_KEY_SENTINEL
                : undefined
            }
          ]
        });
      });

      server.middlewares.use("/api/proxy", async (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        let bodyText = "";
        try {
          bodyText = await readBody(req);
        } catch {
          sendJson(res, 400, { error: "Invalid request body." });
          return;
        }

        let payload: {
          url?: string;
          method?: string;
          headers?: Record<string, string>;
          params?: Record<string, unknown>;
          data?: unknown;
        };
        try {
          payload = JSON.parse(bodyText);
        } catch {
          sendJson(res, 400, { error: "Invalid JSON payload." });
          return;
        }

        const target = String(payload.url ?? "").trim();
        let parsed: URL;
        try {
          parsed = new URL(target);
        } catch {
          sendJson(res, 400, { error: "Invalid target URL." });
          return;
        }

        if (!["http:", "https:"].includes(parsed.protocol)) {
          sendJson(res, 400, { error: "Unsupported target protocol." });
          return;
        }

        if (payload.params && typeof payload.params === "object") {
          for (const [key, value] of Object.entries(payload.params)) {
            if (value === undefined || value === null || value === "") {
              continue;
            }
            parsed.searchParams.set(key, String(value));
          }
        }

        const method = String(payload.method ?? "GET").toUpperCase();
        const headers = new Headers();
        for (const [key, value] of Object.entries(payload.headers ?? {})) {
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

        const cpaBaseUrl = pickEnvText(process.env.CPA_BASE_URL, process.env.CLIPROXYAPI_BASE_URL);
        const cpaApiKey = pickEnvText(process.env.CPA_API_KEY, process.env.CLIPROXYAPI_API_KEY);
        const sub2apiBaseUrl = pickEnvText(process.env.SUB2API_BASE_URL);
        const sub2apiApiKey = pickEnvText(process.env.SUB2API_API_KEY);
        const runtimePlatform = headers.get("x-uap-platform")?.trim().toLowerCase();
        let runtimeApiKey: string | undefined =
          runtimePlatform === "cliproxyapi"
            ? cpaApiKey
            : runtimePlatform === "sub2api"
              ? sub2apiApiKey
              : undefined;
        if (!runtimeApiKey && cpaBaseUrl) {
          try {
            if (new URL(cpaBaseUrl).origin === parsed.origin) {
              runtimeApiKey = cpaApiKey;
            }
          } catch {
            // Ignore invalid optional runtime config.
          }
        }
        if (!runtimeApiKey && sub2apiBaseUrl) {
          try {
            if (new URL(sub2apiBaseUrl).origin === parsed.origin) {
              runtimeApiKey = sub2apiApiKey;
            }
          } catch {
            // Ignore invalid optional runtime config.
          }
        }
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

        let requestBody: string | undefined;
        if (!["GET", "HEAD"].includes(method) && payload.data !== undefined) {
          requestBody = JSON.stringify(payload.data);
          if (!headers.has("content-type")) {
            headers.set("content-type", "application/json; charset=utf-8");
          }
        }

        let upstream: Response;
        try {
          upstream = await fetch(parsed.toString(), {
            method,
            headers,
            body: requestBody,
            redirect: "follow"
          });
        } catch (error) {
          sendJson(res, 502, {
            error:
              error instanceof Error ? error.message : "Upstream request failed."
          });
          return;
        }

        res.statusCode = upstream.status;
        res.setHeader(
          "Content-Type",
          upstream.headers.get("content-type") ?? "application/json; charset=utf-8"
        );
        const payloadBuffer = Buffer.from(await upstream.arrayBuffer());
        res.end(payloadBuffer);
      });
    }
  };
}

export default defineConfig({
  plugins: [vue(), createDevProxyPlugin()],
  server: {
    port: 5173
  }
});
