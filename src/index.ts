import { AppServer, AppSession } from "@mentra/sdk";

const PORT = parseInt(process.env.PORT || "3000");
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.glasswriter.app";
const API_KEY = process.env.MENTRAOS_API_KEY || "";

if (!API_KEY) {
  console.error("❌ MENTRAOS_API_KEY is not set");
  process.exit(1);
}

const activeSessions = new Map<string, AppSession>();
let latestText = "";

// G1 display constants — measured from user testing
const CHARS_PER_LINE = 69;
const MAX_LINES = 5;

// Wrap text at exactly CHARS_PER_LINE characters, then show only the last
// MAX_LINES lines. This creates the "scrolling window" effect — as new lines
// are added the top ones disappear, and if text is deleted it scrolls back up.
function getDisplayText(text: string): string {
  if (!text || !text.trim()) return "GlassWriter\nReady to write.";

  // Word-wrap at CHARS_PER_LINE
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    // Handle words longer than the line width
    if (word.length > CHARS_PER_LINE) {
      if (current) { lines.push(current); current = ""; }
      // Hard-break the long word
      let remaining = word;
      while (remaining.length > CHARS_PER_LINE) {
        lines.push(remaining.slice(0, CHARS_PER_LINE));
        remaining = remaining.slice(CHARS_PER_LINE);
      }
      current = remaining;
      continue;
    }

    const candidate = current ? current + " " + word : word;
    if (candidate.length > CHARS_PER_LINE) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  // Show only the last MAX_LINES — this is the scrolling window
  return lines.slice(-MAX_LINES).join("\n");
}

async function pushToSession(session: AppSession, text: string) {
  try {
    await session.layouts.showTextWall(getDisplayText(text));
  } catch (_) {}
}

async function broadcastText(text: string) {
  latestText = text;
  await Promise.allSettled(
    Array.from(activeSessions.values()).map((s) => pushToSession(s, text))
  );
}

class GlassWriterServer extends AppServer {
  constructor(config: any) {
    super(config);

    const cors = (c: any) => {
      c.header("Access-Control-Allow-Origin", "*");
      c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type");
    };

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

    this.options("/text", (c) => { cors(c); return c.body(null, 204); });

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
║  CHARS_PER_LINE : ${CHARS_PER_LINE}                 ║
║  MAX_LINES      : ${MAX_LINES}                  ║
║  Port           : ${PORT}                 ║
╚══════════════════════════════════════╝
`);
