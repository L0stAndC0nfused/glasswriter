import { AppServer, AppSession } from "@mentra/sdk";
import { createServer } from "http";
import { IncomingMessage, ServerResponse } from "http";

const PORT = parseInt(process.env.PORT || "3000");
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.glasswriter.app";
const API_KEY = process.env.MENTRAOS_API_KEY || "";

if (!API_KEY) {
  console.error("❌ MENTRAOS_API_KEY is not set");
  process.exit(1);
}

// ── Active glasses sessions ──────────────────────────────────────────────────
const activeSessions = new Map<string, AppSession>();
let latestText = "";

// ── Format text for G1 display (28 chars per line, 5 lines max) ──────────────
function formatForGlasses(text: string): string {
  if (!text || !text.trim()) return "GlassWriter\nReady to write.";
  const recent = text.length > 280 ? "\u2026" + text.slice(-277) : text;
  const words = recent.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (candidate.length > 28) {
      if (current) lines.push(current);
      current = word.length > 28 ? word.slice(0, 28) : word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(-5).join("\n");
}

async function pushToSession(session: AppSession, text: string) {
  try {
    await session.layouts.showTextWall(formatForGlasses(text));
  } catch (_) {}
}

async function broadcastText(text: string) {
  latestText = text;
  await Promise.allSettled(
    Array.from(activeSessions.values()).map((s) => pushToSession(s, text))
  );
}

// ── MentraOS App ─────────────────────────────────────────────────────────────
class GlassWriterServer extends AppServer {
  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string
  ): Promise<void> {
    console.log(`[GlassWriter] Connected: ${userId}`);
    activeSessions.set(sessionId, session);
    await pushToSession(session, latestText);

    session.events.onDisconnected(() => {
      console.log(`[GlassWriter] Disconnected: ${sessionId}`);
      activeSessions.delete(sessionId);
    });
  }
}

// ── HTTP bridge server (phone app talks to this) ─────────────────────────────
const BRIDGE_PORT = PORT + 1;

const bridge = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/ping") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      app: "GlassWriter",
      sessions: activeSessions.size,
      status: activeSessions.size > 0 ? `Glasses connected (${activeSessions.size})` : "Waiting for glasses",
    }));
    return;
  }

  if (req.method === "POST" && req.url === "/text") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", async () => {
      try {
        const { text } = JSON.parse(body);
        if (typeof text !== "string") throw new Error("text must be string");
        await broadcastText(text);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: activeSessions.size }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(e) }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end("Not found");
});

// ── Start both servers ───────────────────────────────────────────────────────
const mentraServer = new GlassWriterServer({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
});

mentraServer.start().then(() => {
  bridge.listen(BRIDGE_PORT, () => {
    console.log(`
╔═════════════════════════════════════╗
║      GlassWriter is LIVE 🟢         ║
╠═════════════════════════════════════╣
║  MentraOS webhook: port ${PORT}         ║
║  Phone bridge:     port ${BRIDGE_PORT}         ║
╚═════════════════════════════════════╝
    `);
  });
}).catch((err) => {
  console.error("[GlassWriter] Failed to start:", err);
  process.exit(1);
});
