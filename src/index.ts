#]import { AppServer, AppSession } from "@mentra/sdk";

const PORT = parseInt(process.env.PORT || "3000");
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.glasswriter.app";
const API_KEY = process.env.MENTRAOS_API_KEY || "";

if (!API_KEY) {
  console.error("MENTRAOS_API_KEY not set");
  process.exit(1);
}

const activeSessions = new Map<string, AppSession>();
let latestText = "";

const CHARS = 69;
const LINES = 5;

function wrap(text: string): string {
  if (!text.trim()) return "GlassWriter\nReady to write.";
  const result: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (!word) continue;
    const next = line ? line + " " + word : word;
    if (next.length <= CHARS) {
      line = next;
    } else {
      if (line) result.push(line);
      line = word;
    }
  }
  if (line) result.push(line);
  return result.slice(-LINES).join("\n");
}

async function push(session: AppSession, text: string) {
  try { await session.layouts.showTextWall(wrap(text)); } catch (_) {}
}

async function broadcast(text: string) {
  latestText = text;
  await Promise.allSettled([...activeSessions.values()].map(s => push(s, text)));
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
      return c.json({ ok: true, sessions: activeSessions.size });
    });

    // Test endpoint — open in browser to verify wrapping
    this.get("/test", (c) => {
      cors(c);
      const t = c.req.query("t") || "helo guys i am again testing the capabilites of this app to see if it can handle larger aspects";
      return c.text(wrap(t));
    });

    this.options("/text", (c) => { cors(c); return c.body(null, 204); });

    this.post("/text", async (c) => {
      cors(c);
      const body = await c.req.json().catch(() => ({}));
      const { text } = body;
      if (typeof text !== "string") return c.json({ error: "bad request" }, 400);
      await broadcast(text);
      return c.json({ ok: true, sessions: activeSessions.size });
    });
  }

  protected async onSession(session: AppSession, sessionId: string, userId: string) {
    console.log("Connected:", userId);
    activeSessions.set(sessionId, session);
    await push(session, latestText);
    session.events.onDisconnected(() => {
      console.log("Disconnected:", sessionId);
      activeSessions.delete(sessionId);
    });
  }
}

const server = new GlassWriterServer({ packageName: PACKAGE_NAME, apiKey: API_KEY, port: PORT });
await server.start();
Bun.serve({ port: PORT, fetch: server.fetch });
console.log("GlassWriter live on port", PORT, "| CHARS:", CHARS, "| LINES:", LINES);
