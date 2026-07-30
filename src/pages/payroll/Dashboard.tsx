type DashboardProps = {
  companies: number;
  technicians: number;
  rateSheets: number;
};

export default function Dashboard({
  companies,
  technicians,
  rateSheets,
}: DashboardProps) {
  const setupComplete = companies > 0 && technicians > 0 && rateSheets > 0;

  const cards = [
    {
      label: "Companies",
      value: companies,
      hint: "Contractor businesses and BPS",
      icon: "▦",
    },
    {
      label: "Technicians",
      value: technicians,
      hint: "Active payroll technicians",
      icon: "◎",
    },
    {
      label: "Pay sheets",
      value: rateSheets,
      hint: "Regional and tiered rate cards",
      icon: "$",
    },
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-3 md:grid-cols-3">
        {cards.map(card => (
          <div
            key={card.label}
            className="rounded-2xl border border-white/10 bg-slate-900/70 p-5 shadow-lg shadow-black/10"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {card.label}
                </div>
                <div className="mt-2 text-3xl font-bold text-white">{card.value}</div>
                <div className="mt-1 text-xs text-slate-400">{card.hint}</div>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-400/15 bg-blue-500/10 text-lg font-bold text-blue-300">
                {card.icon}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-white">Payroll workflow</h2>
              <p className="mt-1 text-xs text-slate-400">
                Complete setup once, then upload the weekly invoice and export the breakdowns.
              </p>
            </div>
            <span
              className={
                "rounded-full px-3 py-1 text-xs font-semibold " +
                (setupComplete
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-amber-500/15 text-amber-300")
              }
            >
              {setupComplete ? "Ready" : "Setup needed"}
            </span>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            {[
              ["1", "Companies", companies > 0],
              ["2", "Technicians", technicians > 0],
              ["3", "Pay sheets", rateSheets > 0],
              ["4", "Upload invoice", setupComplete],
            ].map(([step, label, done]) => (
              <div
                key={String(step)}
                className="rounded-xl border border-white/10 bg-slate-950/60 p-3"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold " +
                      (done
                        ? "bg-emerald-500/20 text-emerald-300"
                        : "bg-white/5 text-slate-500")
                    }
                  >
                    {done ? "✓" : step}
                  </span>
                  <span className="text-xs font-medium text-slate-300">{label}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <h2 className="text-base font-semibold text-white">Current deductions</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2.5">
              <span className="text-slate-400">Truck lease</span>
              <span className="font-semibold text-slate-200">$0 / $125 / $175</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2.5">
              <span className="text-slate-400">Meter lease</span>
              <span className="font-semibold text-slate-200">$0 / $15</span>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-950/60 px-3 py-2.5">
              <span className="text-slate-400">Missed QC</span>
              <span className="font-semibold text-slate-200">$30 each</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
