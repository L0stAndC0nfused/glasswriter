// GlassWriter — MentraOS App Server
// Deploy this on Railway (or any Node host). No local PC needed.
//
// HOW TO DEPLOY:
//   1. Fork/use the MentraOS Extended Example App template on GitHub
//   2. Replace src/index.ts with this file
//   3. Connect the repo to Railway — it auto-deploys
//   4. Paste your Railway URL into console.mentra.glass as your app's Public URL
//   5. Add MENTRAOS_API_KEY environment variable in Railway settings

import { AppServer, AppSession, TpaSession } from "@mentra/sdk";
import express from "express";
import cors from "cors";

const PORT = parseInt(process.env.PORT || "3000");
const PACKAGE_NAME = process.env.PACKAGE_NAME || "com.glasswriter.app";
const API_KEY = process.env.MENTRAOS_API_KEY || "";

// ─── Active sessions (glasses connections) ──────────────────────────────────
const activeSessions = new Map<string, AppSession | TpaSession>();
let latestText = ""; // buffer so glasses get text immediately on connect

// ─── Text formatting for G1 display ─────────────────────────────────────────
// G1 display fits ~28 chars per line, ~5 lines. We show the trailing text.
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
      // Long single word — hard wrap it
      if (word.length > 28) {
        lines.push(word.slice(0, 28));
        current = word.slice(28);
      } else {
        current = word;
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  return lines.slice(-5).join("\n");
}

async function pushToSession(session: AppSession | TpaSession, text: string) {
  try {
    const formatted = formatForGlasses(text);
    // @ts-ignore — layouts API is on AppSession
    await session.layouts.showTextWall(formatted);
  } catch (err) {
    // Session may have ended — ignore
  }
}

async function broadcastText(text: string) {
  latestText = text;
  const promises = Array.from(activeSessions.values()).map(s =>
    pushToSession(s, text)
  );
  await Promise.allSettled(promises);
}

// ─── MentraOS App Server ─────────────────────────────────────────────────────
class GlassWriterServer extends AppServer {
  protected async onSession(
    session: AppSession,
    sessionId: string,
    userId: string
  ): Promise<void> {
    console.log(`[GlassWriter] Glasses connected: ${userId}`);
    activeSessions.set(sessionId, session);

    // Show current text immediately (or welcome message)
    await pushToSession(session, latestText);

    session.events.onDisconnected(() => {
      console.log(`[GlassWriter] Glasses disconnected: ${sessionId}`);
      activeSessions.delete(sessionId);
    });

    // Button press to clear
    // @ts-ignore
    session.events.onButtonPress(async () => {
      latestText = "";
      await pushToSession(session, "");
    });
  }
}

// ─── Express HTTP server (phone app → server) ────────────────────────────────
const httpApp = express();
httpApp.use(cors());
httpApp.use(express.json({ limit: "50kb" }));

// Health check — phone app polls this
httpApp.get("/ping", (_req, res) => {
  res.json({
    ok: true,
    app: "GlassWriter",
    sessions: activeSessions.size,
    status: activeSessions.size > 0
      ? `Glasses connected (${activeSessions.size})`
      : "Waiting for glasses",
  });
});

// Phone app posts text here on every keystroke
httpApp.post("/text", async (req, res) => {
  const { text } = req.body ?? {};
  if (typeof text !== "string") {
    return res.status(400).json({ error: "text must be a string" });
  }
  await broadcastText(text);
  res.json({ ok: true, sessions: activeSessions.size });
});

// ─── Start ───────────────────────────────────────────────────────────────────
// MentraOS SDK creates an internal express server for webhooks.
// We attach our own HTTP endpoints to a separate port (or same — see below).
//
// Railway only exposes ONE port. The SDK uses the same PORT env var.
// We piggyback our routes onto the SDK's built-in express instance.

const server = new GlassWriterServer({
  packageName: PACKAGE_NAME,
  apiKey: API_KEY,
  port: PORT,
});

// Inject our routes into SDK's app before it starts
// @ts-ignore — accessing internal express app
if (server.expressApp) {
  server.expressApp.use(cors());
  server.expressApp.use(express.json({ limit: "50kb" }));
  // @ts-ignore
  server.expressApp.get("/ping", httpApp._router.stack.find(l => l.route?.path === "/ping")?.route.stack[0].handle);
  // @ts-ignore
  server.expressApp.post("/text", httpApp._router.stack.find(l => l.route?.path === "/text")?.route.stack[0].handle);
} else {
  // Fallback: run express on PORT+1 (shouldn't be needed on Railway)
  httpApp.listen(PORT + 1, () => {
    console.log(`[GlassWriter] HTTP bridge running on port ${PORT + 1}`);
  });
}

server.start().then(() => {
  console.log(`
╔═════════════════════════════════════╗
║      GlassWriter is LIVE 🟢         ║
╠═════════════════════════════════════╣
║  Port:    ${PORT}                      ║
║  Package: ${PACKAGE_NAME}
╚═════════════════════════════════════╝
`);
}).catch(err => {
  console.error("[GlassWriter] Failed to start:", err);
  process.exit(1);
});
