import http from "node:http";
import type { Client } from "discord.js";
import { config } from "../config";
import { handleGitHubWebhook } from "./github";

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Start a minimal HTTP server for health checks and GitHub webhooks.
 */
export function startWebhookServer(client: Client): http.Server {
  const server = http.createServer(async (req, res) => {
    const url = req.url?.split("?")[0] ?? "";

    try {
      if (req.method === "GET" && (url === "/health" || url === "/")) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("ok");
        return;
      }

      if (req.method === "POST" && url === "/webhooks/github") {
        const rawBody = await readBody(req);
        const signature = req.headers["x-hub-signature-256"];
        const event = req.headers["x-github-event"];

        const result = await handleGitHubWebhook({
          client,
          rawBody,
          signature: Array.isArray(signature) ? signature[0] : signature,
          event: Array.isArray(event) ? event[0] : event,
        });

        res.writeHead(result.status, { "Content-Type": "text/plain" });
        res.end(result.body);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("not found");
    } catch (error) {
      console.error("[webhooks] Unhandled server error:", error);
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end("error");
    }
  });

  server.listen(config.webhookPort, () => {
    console.log(
      `[webhooks] Listening on :${config.webhookPort} (POST /webhooks/github, GET /health)`,
    );
  });

  return server;
}
