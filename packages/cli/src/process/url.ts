// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

export const stripAnsi = (s: string): string => s.replace(ANSI, "");

const HOST_PORT = /(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?[^\s]*)/i;
const VITE_LOCAL = /Local:\s+(https?:\/\/[^\s]+)/i;
// Angular antiguo: "Angular Live Development Server is listening on localhost:4200, open your browser on ..."
const LISTENING_ON = /listening on\s+(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]):(\d{2,5})\b/i;

/** Extrae la URL anunciada ("Local: http://localhost:5173/"); cae a cualquier URL loopback. */
export function detectAnnouncedUrl(text: string): string | null {
  const clean = stripAnsi(text);
  const listening = LISTENING_ON.exec(clean);
  const m = VITE_LOCAL.exec(clean) ?? HOST_PORT.exec(clean);
  const raw = m?.[1] ?? (listening ? `http://${listening[1]}:${listening[2]}/` : undefined);
  if (!raw) return null;
  try {
    const u = new URL(raw.replace("0.0.0.0", "localhost"));
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function portOf(url: string): number | null {
  try {
    const u = new URL(url);
    if (u.port) return Number(u.port);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}
