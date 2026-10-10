/** true si algo responde HTTP (cualquier status) antes del timeout. */
export async function probeHttp(url: string, timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    await res.body?.cancel();
    return true;
  } catch {
    return false;
  }
}

export async function waitForHttp(url: string, timeoutMs: number, signal?: AbortSignal): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (signal?.aborted) return false;
    if (await probeHttp(url, 1000)) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}
