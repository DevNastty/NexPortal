import { useState } from "react"; import React from "react";
function getMgmtPin(){return (import.meta as any)?.env?.VITE_MGMT_PIN||"2468"}
function ManagerGate({ onCancel, onUnlock }: { onCancel: () => void; onUnlock: () => void }) {
  const [pin, setPin] = useState(""); const [err, setErr] = useState("");
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === getMgmtPin()) { setErr(""); onUnlock(); } else setErr("Incorrect PIN.");
  };
  return (
    <div className="mx-auto max-w-md px-6 py-12">
      <h2 className="text-2xl font-semibold">Manager Access</h2>
      <p className="mt-1 text-sm text-slate-400">Enter the management PIN to continue.</p>
      <form onSubmit={submit} className="mt-6 grid gap-3">
        <label className="text-xs text-slate-300 flex flex-col gap-1"><span className="opacity-80">PIN</span><input className="i" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="••••" /></label>
        {err && <div className="text-xs text-red-300">{err}</div>}
        <div className="flex items-center gap-2">
          <button type="submit" className="rounded-xl px-4 py-2 bg-blue-600 hover:bg-blue-500 text-sm">Unlock</button>
          <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2 bg-white/5 border border-white/10 text-sm">Cancel</button>
        </div>
      </form>
      <style>{`.i{background:#0b1220;border:1px solid rgba(255,255,255,.1);border-radius:.75rem;padding:.5rem .75rem;width:100%;}`}</style>
    </div>
  );
}
export default ManagerGate;
