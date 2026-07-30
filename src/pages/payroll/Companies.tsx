import { FormEvent, useState } from "react";
import { supabase } from "../../supabase";
import type { PayrollCompany } from "../../types/payroll";

type CompaniesProps = {
  companies: PayrollCompany[];
  onChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
};

export default function Companies({
  companies,
  onChanged,
  onNotice,
  onError,
}: CompaniesProps) {
  const [companyName, setCompanyName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [paymentType, setPaymentType] = useState<"individual" | "company">("individual");
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function deleteCompany(company: PayrollCompany) {
    const confirmed = window.confirm(
      `Permanently delete ${company.company_name}?\n\nTechnicians assigned to this company will remain in the system, but their company assignment will be cleared. This cannot be undone.`
    );

    if (!confirmed) return;

    setDeletingId(company.id);
    onError("");

    const { error: detachError } = await supabase
      .from("payroll_technicians")
      .update({ company_id: null, operating_company: null })
      .eq("company_id", company.id);

    if (detachError) {
      onError(`Could not clear technician assignments: ${detachError.message}`);
      setDeletingId(null);
      return;
    }

    const { error } = await supabase
      .from("payroll_companies")
      .delete()
      .eq("id", company.id);

    if (error) {
      onError(`Could not delete company: ${error.message}`);
      setDeletingId(null);
      return;
    }

    onNotice(`${company.company_name} was permanently deleted.`);
    await onChanged();
    setDeletingId(null);
  }

  async function createCompany(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    onError("");

    const displayName = legalName.trim() || companyName.trim();

    const { data: payee, error: payeeError } = await supabase
      .from("payroll_payees")
      .insert({
        display_name: displayName,
        legal_name: legalName.trim() || null,
        payee_type: paymentType,
      })
      .select("id")
      .single();

    if (payeeError) {
      onError(payeeError.message);
      setBusy(false);
      return;
    }

    const { error } = await supabase.from("payroll_companies").insert({
      company_name: companyName.trim(),
      legal_name: legalName.trim() || null,
      payee_id: payee.id,
    });

    if (error) {
      onError(error.message);
      setBusy(false);
      return;
    }

    setCompanyName("");
    setLegalName("");
    setPaymentType("individual");
    onNotice("Company created.");
    await onChanged();
    setBusy(false);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form
        onSubmit={createCompany}
        className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5"
      >
        <h2 className="text-lg font-semibold text-white">Add company</h2>

        <input
          required
          placeholder="Company name"
          value={companyName}
          onChange={event => setCompanyName(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
        />

        <input
          placeholder="Legal name (optional)"
          value={legalName}
          onChange={event => setLegalName(event.target.value)}
          className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
        />

        <select
          value={paymentType}
          onChange={event =>
            setPaymentType(event.target.value as "individual" | "company")
          }
          className="w-full rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm"
        >
          <option value="individual">Individual contractors</option>
          <option value="company">One company payment</option>
        </select>

        <button
          disabled={busy}
          className="w-full rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save company"}
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/70">
        <div className="border-b border-white/10 px-5 py-4 text-lg font-semibold">
          Companies
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-white/5 text-slate-400">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Company</th>
                <th className="px-4 py-3 text-left font-medium">Legal name</th>
                <th className="px-4 py-3 text-left font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {companies.map(company => (
                <tr key={company.id} className="border-t border-white/5">
                  <td className="px-4 py-3 font-medium text-white">
                    {company.company_name}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {company.legal_name || "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-300">
                    {company.active ? "Active" : "Inactive"}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      disabled={deletingId === company.id}
                      onClick={() => deleteCompany(company)}
                      className="rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {deletingId === company.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
              {!companies.length && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                    No companies yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
