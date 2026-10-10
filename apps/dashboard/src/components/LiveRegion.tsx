import { useCallback, useState } from "react";

/** Region aria-live educada: `announce` reemplaza el mensaje (alterna un espacio para repetir el mismo texto). */
export function useAnnouncer(): { announce: (message: string) => void; region: React.ReactNode } {
  const [msg, setMsg] = useState("");
  const announce = useCallback((m: string) => setMsg((prev) => (prev === m ? m + String.fromCharCode(160) : m)), []);
  const region = (
    <div className="db-sr-only" role="status" aria-live="polite" aria-atomic="true">
      {msg}
    </div>
  );
  return { announce, region };
}
