import net from "node:net";

export interface LocalMongo {
  host: string;
  port: number;
  database: string;
}

/**
 * Inspect a MongoDB connection string and, when it points at a local host,
 * return the details needed to start the built-in development database.
 * Remote/cluster URIs return `null` and are never auto-started.
 */
export function parseLocalMongo(uri: string | undefined): LocalMongo | null {
  if (!uri) return null;

  try {
    const url = new URL(uri);

    if (url.protocol !== "mongodb:") return null;

    const host = url.hostname.replace(/^\[|\]$/g, "");
    const isLocal = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);

    if (!isLocal) return null;

    return {
      host: host === "localhost" || host === "0.0.0.0" ? "127.0.0.1" : host,
      port: Number(url.port || 27017),
      database: url.pathname.replace(/^\//, "") || "sales_crm",
    };
  } catch {
    return null;
  }
}

export function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (open: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

export async function waitForPort(
  host: string,
  port: number,
  attempts = 60,
  delayMs = 500,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await isPortOpen(host, port)) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  return false;
}
