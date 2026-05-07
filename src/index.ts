import { AppServer, AppSession } from "@mentra/sdk";

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

// ── App Server — AppServer extends Hono, so we add routes directly ───────────
class GlassWriterServer extends AppServer {
  constructor(config: any) {
    super(config);

    // CORS helper
    const cors = (c: any) => {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
    };

    // Health check — phone app polls this
    this.get("/ping", (c) => {
      cors(c);
      return c.json({
        ok: true,
        app: "GlassWriter",
        sessions: activeSessions.size,
        status: activeSessions.size > 0
          ? `Glasses connected (${activeSessions.size})`
          : "Waiting for glasses",
      });
    });

    // OPTIONS preflight
    this.options("/text", (c) => {
      cors(c);
      return c.body(null, 204);
    });

    // Receive text from phone app
    this.post("/text", async (c) => {
      cors(c);
      const body = await c.req.json().catch(() => ({}));
      const { text } = body;
      if (typeof text !== "string") {
        return c.json({ error: "text must be a string" }, 400);
      }
      await broadcastText(text);
      return c.json({ ok: true, sessions: activeSessions.size });
    });
  }

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

// ── Start with Bun.serve (required by SDK) ───────────────────────────────────
const server = new GlassWriterServer({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
});

await server.start();

Bun.serve({
  port: PORT,
  fetch: server.fetch,
});

console.log(`
╔══════════════════════════════════════╗
║      GlassWriter is LIVE 🟢          ║
╠══════════════════════════════════════╣
║  Port: ${PORT}                           ║
║  /webhook → MentraOS glasses         ║
║  /ping    → health check             ║
║  /text    → receive typed text       ║
╚══════════════════════════════════════╝
`);
