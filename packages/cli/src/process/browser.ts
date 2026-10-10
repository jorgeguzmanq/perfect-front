import { spawn } from "node:child_process";
import { PerfectFrontError } from "@perfect-front/shared";

/** Abre la URL en el navegador predeterminado sin shell (rundll32 / open / xdg-open). */
export function openBrowser(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PerfectFrontError("invalid_request", "URL invalida");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PerfectFrontError("invalid_request", "Solo se abren URLs http(s)");
  }
  const href = parsed.toString();
  const [file, args] =
    process.platform === "win32"
      ? (["rundll32.exe", ["url.dll,FileProtocolHandler", href]] as const)
      : process.platform === "darwin"
        ? (["open", [href]] as const)
        : (["xdg-open", [href]] as const);
  const child = spawn(file, [...args], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.on("error", () => undefined);
  child.unref();
}
