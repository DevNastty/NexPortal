import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase";
import type { AuthUser } from "../types/navigation";

const msg = (e: any) => e?.message || e?.details || String(e);

type RequestRow = {
  id: string;
  tech_user_id: string;
  tech_number: string | null;
  tech_name: string | null;
  start_date: string;
  end_date: string;
  request_type: string;
  partial_day: boolean;
  partial_start_time: string | null;
  partial_end_time: string | null;
  employee_note: string | null;
  status: string;
  management_note: string | null;
  reviewed_at: string | null;
  created_at: string;
};

const REQUEST_TYPE_LABELS: Record<string, string> = {
  sick: "Sick",
  appointment: "Appointment",
  emergency: "Emergency",
  other: "Other",
};

export function TimeOffRequestPage({
  authUser,
}: {
  authUser: AuthUser;
}) {
  const today = new Date().toISOString().slice(0, 10);

  const [rows, setRows] = useState<RequestRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [form, setForm] = useState({
    start_date: today,
    end_date: today,
    request_type: "sick",
    partial_day: false,
    partial_start_time: "",
    partial_end_time: "",
    employee_note: "",
  });

  useEffect(() => {
    void load();
  }, [authUser.userId]);

  async function load() {
    if (!authUser.userId) return;

    const r = await supabase
      .from("tech_time_off_requests")
      .select("*")
      .eq("tech_user_id", authUser.userId)
      .order("created_at", { ascending: false });

    if (r.error) {
      setError(msg(r.error));
    } else {
      setRows((r.data || []) as RequestRow[]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!authUser.userId) return;

    setBusy(true);
    setError("");
    setNotice("");

    if (
      form.partial_day &&
      (!form.partial_start_time || !form.partial_end_time)
    ) {
      setError("Choose both a start time and end time for a partial day.");
      setBusy(false);
      return;
    }

    const payload = {
      tech_user_id: authUser.userId,
      tech_number: authUser.techNumber || null,
      tech_name: authUser.displayName || authUser.username,
      start_date: form.start_date,
      end_date: form.end_date,
      request_type: form.request_type,
      partial_day: form.partial_day,
      partial_start_time:
        form.partial_day && form.partial_start_time
          ? form.partial_start_time
          : null,
      partial_end_time:
        form.partial_day && form.partial_end_time
          ? form.partial_end_time
          : null,
      employee_note: form.employee_note.trim() || null,
    };

    const r = await supabase
      .from("tech_time_off_requests")
      .insert(payload)
      .select("id")
      .single();

    if (r.error) {
      setError(msg(r.error));
    } else {
      const emailResult = await supabase.functions.invoke("send-time-off-email", {
        body: { action: "submitted", requestId: r.data.id },
      });

      setNotice(
        emailResult.error
          ? "Time off request submitted. Leadership email could not be sent."
          : "Time off request submitted and leadership was notified.",
      );
      setForm({
        start_date: today,
        end_date: today,
        request_type: "sick",
        partial_day: false,
        partial_start_time: "",
        partial_end_time: "",
        employee_note: "",
      });
      await load();
    }

    setBusy(false);
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this pending request?")) return;

    setError("");

    const r = await supabase
      .from("tech_time_off_requests")
      .update({ status: "cancelled" })
      .eq("id", id)
      .eq("tech_user_id", authUser.userId)
      .eq("status", "pending");

    if (r.error) {
      setError(msg(r.error));
    } else {
      await load();
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold">Time Off Request</h1>

      <p className="mt-1 text-sm text-slate-400">
        Submit dates you will be unavailable for Supervisor or Director
        approval.
      </p>

      {error && (
        <div className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {notice && (
        <div className="mt-4 rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-[380px_1fr]">
        <form
          onSubmit={submit}
          className="space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5"
        >
          <label className="block text-xs text-slate-300">
            Start date
            <input
              type="date"
              min={today}
              required
              value={form.start_date}
              onChange={(e) =>
                setForm({
                  ...form,
                  start_date: e.target.value,
                  end_date:
                    e.target.value > form.end_date
                      ? e.target.value
                      : form.end_date,
                })
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
            />
          </label>

          <label className="block text-xs text-slate-300">
            End date
            <input
              type="date"
              min={form.start_date}
              required
              value={form.end_date}
              onChange={(e) =>
                setForm({
                  ...form,
                  end_date: e.target.value,
                })
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
            />
          </label>

          <label className="block text-xs text-slate-300">
            Request type
            <select
              value={form.request_type}
              onChange={(e) =>
                setForm({
                  ...form,
                  request_type: e.target.value,
                })
              }
              className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
            >
              <option value="sick">Sick</option>
              <option value="appointment">Appointment</option>
              <option value="emergency">Emergency</option>
              <option value="other">Other</option>
            </select>
          </label>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.partial_day}
              onChange={(e) =>
                setForm({
                  ...form,
                  partial_day: e.target.checked,
                  partial_start_time: e.target.checked
                    ? form.partial_start_time
                    : "",
                  partial_end_time: e.target.checked
                    ? form.partial_end_time
                    : "",
                })
              }
            />
            Partial day
          </label>

          {form.partial_day && (
            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-300">
                Start time
                <input
                  type="time"
                  required
                  value={form.partial_start_time}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      partial_start_time: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
                />
              </label>

              <label className="text-xs text-slate-300">
                End time
                <input
                  type="time"
                  required
                  value={form.partial_end_time}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      partial_end_time: e.target.value,
                    })
                  }
                  className="mt-1 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
                />
              </label>
            </div>
          )}

          <label className="block text-xs text-slate-300">
            Reason or notes
            <textarea
              value={form.employee_note}
              onChange={(e) =>
                setForm({
                  ...form,
                  employee_note: e.target.value,
                })
              }
              className="mt-1 min-h-24 w-full rounded-xl border border-white/10 bg-slate-950 p-3"
            />
          </label>

          <button
            disabled={busy}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold disabled:opacity-50"
          >
            {busy ? "Submitting…" : "Submit Request"}
          </button>
        </form>

        <section className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <h2 className="font-semibold">My Requests</h2>

          <div className="mt-4 space-y-3">
            {rows.length ? (
              rows.map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl border border-white/5 bg-white/[.03] p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">
                        {r.start_date}
                        {r.end_date !== r.start_date
                          ? ` – ${r.end_date}`
                          : ""}
                      </div>

                      <div className="mt-1 text-xs text-slate-400">
                        {REQUEST_TYPE_LABELS[r.request_type] ||
                          r.request_type}{" "}
                        · <span className="capitalize">{r.status}</span>
                      </div>

                      {r.partial_day && (
                        <div className="mt-1 text-xs text-slate-500">
                          Partial day
                          {r.partial_start_time && r.partial_end_time
                            ? ` · ${r.partial_start_time.slice(
                                0,
                                5,
                              )}–${r.partial_end_time.slice(0, 5)}`
                            : ""}
                        </div>
                      )}
                    </div>

                    {r.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => void cancel(r.id)}
                        className="rounded-lg border border-red-400/20 px-3 py-2 text-xs text-red-300"
                      >
                        Cancel
                      </button>
                    )}
                  </div>

                  {r.employee_note && (
                    <div className="mt-3 text-sm text-slate-300">
                      {r.employee_note}
                    </div>
                  )}

                  {r.management_note && (
                    <div className="mt-2 text-xs text-slate-400">
                      Management: {r.management_note}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="text-sm text-slate-500">
                No time off requests yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

export function TimeOffApprovalsPage() {
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [status, setStatus] = useState("pending");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    void load();
  }, [status]);

  async function load() {
    setError("");

    let q = supabase
      .from("tech_time_off_requests")
      .select("*")
      .order("start_date", { ascending: true });

    if (status !== "all") {
      q = q.eq("status", status);
    }

    const r = await q;

    if (r.error) {
      setError(msg(r.error));
    } else {
      setRows((r.data || []) as RequestRow[]);
    }
  }

  async function review(
    id: string,
    next: "approved" | "denied",
  ) {
    const note =
      prompt(
        `${next === "approved" ? "Approval" : "Denial"} note (optional):`,
      ) || null;

    setBusy(id);
    setError("");

    const user = (await supabase.auth.getUser()).data.user;

    const r = await supabase
      .from("tech_time_off_requests")
      .update({
        status: next,
        management_note: note,
        reviewed_by: user?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending");

    if (r.error) {
      setError(msg(r.error));
    } else {
      const emailResult = await supabase.functions.invoke("send-time-off-email", {
        body: { action: next, requestId: id },
      });

      if (emailResult.error) {
        setError(
          `${next === "approved" ? "Request approved" : "Request denied"}, but the technician email could not be sent: ${msg(emailResult.error)}`,
        );
      }

      await load();
    }

    setBusy("");
  }

  const counts = useMemo(
    () => ({
      total: rows.length,
    }),
    [rows],
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            Time Off Approvals
          </h1>

          <p className="mt-1 text-sm text-slate-400">
            Review pending time off requests and approve or deny them.
          </p>
        </div>

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-xl border border-white/10 bg-slate-900 px-3 py-2"
        >
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </select>
      </div>

      {error && (
        <div className="mt-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {rows.map((r) => (
          <article
            key={r.id}
            className="rounded-2xl border border-white/10 bg-slate-900/70 p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="text-lg font-semibold">
                  {r.tech_name || r.tech_number || "Technician"}
                </div>

                <div className="mt-1 text-sm text-slate-300">
                  {r.start_date}
                  {r.end_date !== r.start_date
                    ? ` – ${r.end_date}`
                    : ""}
                </div>

                <div className="mt-1 text-xs text-slate-500">
                  {REQUEST_TYPE_LABELS[r.request_type] ||
                    r.request_type}

                  {r.partial_day ? " · Partial day" : ""}

                  {" · "}

                  <span className="capitalize">{r.status}</span>
                </div>

                {r.partial_day &&
                  r.partial_start_time &&
                  r.partial_end_time && (
                    <div className="mt-1 text-xs text-slate-500">
                      {r.partial_start_time.slice(0, 5)}–
                      {r.partial_end_time.slice(0, 5)}
                    </div>
                  )}

                {r.employee_note && (
                  <div className="mt-3 text-sm text-slate-300">
                    {r.employee_note}
                  </div>
                )}
              </div>

              {r.status === "pending" && (
                <div className="flex gap-2">
                  <button
                    disabled={busy === r.id}
                    onClick={() => void review(r.id, "approved")}
                    className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Approve
                  </button>

                  <button
                    disabled={busy === r.id}
                    onClick={() => void review(r.id, "denied")}
                    className="rounded-xl bg-red-600 px-4 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    Deny
                  </button>
                </div>
              )}
            </div>

            {r.management_note && (
              <div className="mt-3 text-xs text-slate-400">
                Management note: {r.management_note}
              </div>
            )}
          </article>
        ))}

        {!counts.total && (
          <div className="rounded-2xl border border-dashed border-white/10 p-12 text-center text-slate-500">
            No requests in this view.
          </div>
        )}
      </div>
    </main>
  );
}
