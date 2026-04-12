import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

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
