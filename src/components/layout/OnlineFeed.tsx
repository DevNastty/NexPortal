import { useEffect, useState } from "react"; import type { AuthUser } from "../../types/navigation";
const ROLE_RANK:Record<string,number>={tech:0,manager:1,director:2}; const PRESENCE_API_URL=(import.meta as any)?.env?.VITE_PRESENCE_API_URL||"https://script.google.com/macros/s/AKfycbz-n0wyT-JC8kXWM2QiwsdPOAlYWnv_jmmGWZ32AlsRMWPJHzjD6UCMrXFmOkA6EMV3/exec"; type OnlineUser={username:string;displayName:string;role:string;lastSeen:string};
function usePresence(authUser: AuthUser | null) {
  const [online, setOnline] = useState<OnlineUser[]>([]);

  useEffect(() => {
    if (!authUser || !PRESENCE_API_URL) return;
    let cancelled = false;

    const ping = async () => {
      try {
        const res = await fetch(PRESENCE_API_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            action: "presence_ping",
            username: authUser.username,
            displayName: authUser.displayName || authUser.username,
            role: authUser.role,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!cancelled && data?.ok && Array.isArray(data.online)) {
          setOnline(data.online);
        }
      } catch {
        /* swallow — offline is fine */
      }
    };

    ping();
    const t = setInterval(ping, 30_000);
    const onVis = () => { if (document.visibilityState === "visible") ping(); };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [authUser?.username]);

  return online;
}
function presenceInitials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(p => p[0]?.toUpperCase() || "")
    .join("") || "?";
}
function presenceColor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 60% 45%)`;
}
function OnlineFeed({ authUser }: { authUser: AuthUser | null }) {
  const online = usePresence(authUser);
  const [open, setOpen] = useState(false);

  if (!authUser) return null;

  const sorted = [...online].sort((a, b) => {
    const ar = ROLE_RANK[a.role] ?? 0;
    const br = ROLE_RANK[b.role] ?? 0;
    if (ar !== br) return br - ar; // higher rank first (director > manager > tech)
    return a.displayName.localeCompare(b.displayName);
  });

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-slate-900/95 backdrop-blur supports-[backdrop-filter]:bg-slate-900/80">
      <style>{`
        @keyframes director-rainbow {
          0%   { background-position: 0% 50%; }
          100% { background-position: 200% 50%; }
        }
        .director-name {
          background: linear-gradient(90deg, #22d3ee, #a855f7, #ec4899, #f59e0b, #22d3ee);
          background-size: 200% auto;
          -webkit-background-clip: text;
          background-clip: text;
          -webkit-text-fill-color: transparent;
          color: transparent;
          animation: director-rainbow 4s linear infinite;
          font-weight: 600;
        }
      `}</style>
      <div className="mx-auto max-w-7xl px-4 py-2 flex items-center gap-3">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-2 text-xs text-slate-300 hover:text-white"
          aria-label="Toggle online users"
        >
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          <span className="font-medium">{sorted.length} online</span>
          <svg className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <div className="flex -space-x-2 overflow-hidden">
          {sorted.slice(0, 8).map(u => (
            <div
              key={u.username}
              title={`${u.displayName}${u.role === "director" ? " (director)" : u.role === "manager" ? " (manager)" : ""}`}
              className="h-6 w-6 rounded-full ring-2 ring-slate-900 flex items-center justify-center text-[10px] font-semibold text-white"
              style={{ background: presenceColor(u.displayName) }}
            >
              {presenceInitials(u.displayName)}
            </div>
          ))}
          {sorted.length > 8 && (
            <div className="h-6 w-6 rounded-full ring-2 ring-slate-900 bg-slate-700 flex items-center justify-center text-[10px] text-slate-200">
              +{sorted.length - 8}
            </div>
          )}
        </div>

        <div className="ml-auto text-[10px] text-slate-500 hidden sm:block">live</div>
      </div>

      {open && (
        <div className="border-t border-white/5 bg-slate-950/80 max-h-60 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-4 py-3">
            {sorted.length === 0 ? (
              <div className="text-xs text-slate-400">No one else is here right now.</div>
            ) : (
              <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {sorted.map(u => (
                  <li key={u.username} className="flex items-center gap-2 text-xs text-slate-200">
                    <div
                      className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0"
                      style={{ background: presenceColor(u.displayName) }}
                    >
                      {presenceInitials(u.displayName)}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate flex items-center gap-1">
                        {u.role === "director" && (
                          <img
                            src="https://patched.to/images/sparkles.gif"
                            alt=""
                            className="w-3 h-3 shrink-0"
                          />
                        )}
                        <span className={u.role === "director" ? "director-name" : ""}>
                          {u.displayName}
                        </span>
                        {u.role === "director" && (
                          <img
                            src="https://patched.to/images/sparkles.gif"
                            alt=""
                            className="w-3 h-3 shrink-0"
                          />
                        )}
                      </div>
                      {u.role === "director" && (
                        <div
                          className="text-[9px] font-mono uppercase tracking-[0.25em] text-cyan-300 mt-0.5"
                          style={{ textShadow: "0 0 6px rgba(34, 211, 238, 0.7), 0 0 12px rgba(34, 211, 238, 0.3)" }}
                        >
                          ▸ Director
                        </div>
                      )}
                      {u.role === "manager" && (
                        <div className="text-[10px] text-blue-300">manager</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default OnlineFeed;
