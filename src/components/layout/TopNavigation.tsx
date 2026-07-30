import { useEffect, useRef, useState } from "react";
import type { AuthUser, ViewKey } from "../../types/navigation";

type NavItem = {
  key: ViewKey;
  label: string;
  description?: string;
  icon: string;
};

type NavGroup = {
  id: string;
  label: string;
  icon: string;
  items: NavItem[];
};

type TopNavigationProps = {
  view: ViewKey;
  onNavigate: (view: ViewKey) => void;
  authUser: AuthUser | null;
  isManager: boolean;
  onLogout: () => void;
};

const ROLE_RANK: Record<string, number> = { tech: 0, bp_owner: 1, dispatcher: 2, supervisor: 3, director: 4 };

function hasRole(user: AuthUser | null, minimum: "tech" | "bp_owner" | "dispatcher" | "supervisor" | "director") {
  return (ROLE_RANK[user?.role ?? ""] ?? -1) >= ROLE_RANK[minimum];
}

function buildGroups(authUser: AuthUser | null): NavGroup[] {
  if (!authUser) return [];

  const groups: NavGroup[] = [
    {
      id: "metrics",
      label: "Metrics",
      icon: "▦",
      items: [
        { key: "metrics", label: "Metrics", description: "Monthly technician metrics", icon: "▦" },
        { key: "ftrHits", label: "FTR Hits", description: "Repeat-order exceptions", icon: "↻" },
        { key: "tnps", label: "tNPS", description: "Customer feedback and scores", icon: "★" },
      ],
    },
  ];

  if (authUser.role === "tech") {
    groups.unshift({ id: "tech", label: "My Portal", icon: "⌂", items: [
      { key: "dashboard", label: "Dashboard", description: "Your performance and activity", icon: "⌂" },
      { key: "myProfile", label: "My Profile", description: "Your contact details and assigned assets", icon: "◉" },
    ]});
    groups.push({ id: "forms", label: "Forms", icon: "✎", items: [
      { key: "myForms", label: "My Forms", description: "Review and sign assigned forms", icon: "✎" },
    ]});
  }

  // Every authenticated portal user can submit and track their own time off requests.
  groups.push({
    id: "timeOff",
    label: "Time Off",
    icon: "▦",
    items: [
      {
        key: "timeOff",
        label: "Time Off Request",
        description: "Submit and track your time off requests",
        icon: "▦",
      },
    ],
  });

  if (hasRole(authUser, "bp_owner")) {
    groups.push({
      id: "onboarding",
      label: "Onboarding",
      icon: "+",
      items: [
        { key: "onbForm", label: "Technician Application", description: "Submit a new candidate", icon: "+" },
      ],
    });

    const managementItems: NavItem[] = [
      { key: "onbMgmt", label: "Onboarding Management", description: "Review submitted candidates", icon: "◎" },
    ];

    if (authUser.role === "bp_owner" || authUser.role === "supervisor" || authUser.role === "director") {
      managementItems.push({ key: "techProfiles", label: "Technician Profiles", description: "Contacts, assets and forms", icon: "◉" });
    }

    if (authUser.role === "dispatcher" || authUser.role === "supervisor" || authUser.role === "director") {
      managementItems.push({ key: "dataUploads", label: "Data Uploads", description: "Import Metrics and tNPS files", icon: "⇧" });
    }

    if (authUser.role === "supervisor" || authUser.role === "director") {
      if (authUser.role === "director" || authUser.canApproveTimeOff) {
        managementItems.push({ key: "timeOffApprovals", label: "Time Off Approvals", description: "Approve or deny time off requests", icon: "▦" });
      }
      managementItems.push(
        { key: "assets", label: "Assets", description: "Truck and meter assignments", icon: "▣" },
        { key: "formsCenter", label: "Forms Center", description: "Upload, assign, and track forms", icon: "✎" },
      );
    }
    if (authUser.role === "director") {
      managementItems.push(
        { key: "payroll", label: "Payroll", description: "Invoices, rates and contractor pay", icon: "$" },
        { key: "adminCompanies", label: "Companies", description: "Company master data", icon: "🏢" },
        { key: "adminLocations", label: "Locations", description: "Locations and regions", icon: "📍" },
        { key: "adminManagers", label: "Supervisors", description: "Supervisor directory", icon: "👔" },
        { key: "adminUsers", label: "Users", description: "Portal access and roles", icon: "👥" },
        { key: "adminSettings", label: "Settings", description: "Portal configuration", icon: "⚙" },
      );
    }

    groups.push({ id: "management", label: "Management", icon: "⚙", items: managementItems });
  }

  return groups;
}

export default function TopNavigation({
  view,
  onNavigate,
  authUser,
  isManager,
  onLogout,
}: TopNavigationProps) {
  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const groups = buildGroups(authUser);
  const homeView: ViewKey = authUser?.role === "tech" || authUser?.role === "director" ? "dashboard" : "metrics";

  const allItems = groups.flatMap(group => group.items);
  const activeItem = allItems.find(item => item.key === view);
  const activeGroup = groups.find(group => group.items.some(item => item.key === view));

  useEffect(() => {
    function closeOnOutsideClick(event: MouseEvent) {
      if (!headerRef.current?.contains(event.target as Node)) setOpenGroup(null);
    }
    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, []);

  function navigate(nextView: ViewKey) {
    onNavigate(nextView);
    setOpenGroup(null);
    setMobileOpen(false);
  }

  return (
    <header ref={headerRef} className="sticky top-0 z-50 border-b border-white/10 bg-[#07111f]/85 shadow-[0_12px_40px_rgba(2,6,23,.28)] backdrop-blur-2xl">
      <div className="mx-auto w-full max-w-[1800px] px-4 sm:px-6">
        <div className="flex h-16 items-center gap-3">
          <button
            type="button"
            onClick={() => authUser && navigate(homeView)}
            className="flex min-w-0 shrink-0 items-center gap-3 text-left"
          >
            <div className="brand-mark flex h-10 w-10 items-center justify-center rounded-[14px] text-sm font-black text-white">N</div>
            <div className="hidden min-w-0 sm:block">
              <div className="truncate text-sm font-bold tracking-tight text-white">NexPortal</div>
              <div className="truncate text-[11px] text-slate-400">{activeItem?.label || "BPS operations suite"}</div>
            </div>
          </button>

          {authUser && (
            <nav className="ml-2 hidden flex-1 items-center gap-1 lg:flex">
              {(authUser.role === "director" || authUser.role === "tech") && (
                <button
                  type="button"
                  onClick={() => navigate("dashboard")}
                  className={`rounded-xl px-3 py-2 text-xs font-medium transition ${
                    view === "dashboard" ? "bg-blue-600 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  Dashboard
                </button>
              )}

              {groups.map(group => {
                const isActive = activeGroup?.id === group.id;
                const isOpen = openGroup === group.id;
                return (
                  <div key={group.id} className="relative">
                    <button
                      type="button"
                      onClick={() => setOpenGroup(isOpen ? null : group.id)}
                      className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition ${
                        isActive || isOpen ? "bg-white/10 text-white" : "text-slate-300 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <span>{group.icon}</span>
                      <span>{group.label}</span>
                      <span className={`text-[9px] text-slate-500 transition ${isOpen ? "rotate-180" : ""}`}>▼</span>
                    </button>

                    {isOpen && (
                      <div className="absolute left-0 top-full mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-2xl shadow-black/50">
                        <div className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</div>
                        {group.items.map(item => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => navigate(item.key)}
                            className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
                              view === item.key ? "bg-blue-600 text-white" : "text-slate-200 hover:bg-white/10"
                            }`}
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/15 text-sm">{item.icon}</span>
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{item.label}</span>
                              {item.description && <span className={`mt-0.5 block text-[11px] ${view === item.key ? "text-blue-100" : "text-slate-500"}`}>{item.description}</span>}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          )}

          <div className="ml-auto hidden items-center gap-3 lg:flex">
            {authUser ? (
              <>
                <div className="max-w-48 text-right leading-tight">
                  <div className="truncate text-xs font-medium text-slate-100">{authUser.displayName || authUser.username}</div>
                  <div className="text-[10px] capitalize text-slate-500">{authUser.role}</div>
                </div>
                <button type="button" onClick={onLogout} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white">Sign out</button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Not signed in</span>
            )}
          </div>

          <button
            type="button"
            onClick={() => setMobileOpen(value => !value)}
            className="ml-auto inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-slate-200 lg:hidden"
            aria-label="Toggle navigation"
          >
            {mobileOpen ? "✕" : "☰"}
          </button>
        </div>

        {mobileOpen && (
          <div className="pb-4 lg:hidden">
            <div className="max-h-[calc(100vh-5rem)] overflow-y-auto rounded-2xl border border-white/10 bg-slate-900 p-2 shadow-2xl">
              {(authUser?.role === "director" || authUser?.role === "tech") && (
                <button type="button" onClick={() => navigate("dashboard")} className={`mb-2 w-full rounded-xl px-3 py-3 text-left text-sm font-medium ${view === "dashboard" ? "bg-blue-600 text-white" : "bg-white/5 text-slate-200"}`}>Dashboard</button>
              )}

              {groups.map(group => (
                <div key={group.id} className="mb-3 last:mb-0">
                  <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{group.label}</div>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {group.items.map(item => (
                      <button key={item.key} type="button" onClick={() => navigate(item.key)} className={`rounded-xl px-3 py-3 text-left ${view === item.key ? "bg-blue-600 text-white" : "bg-white/[0.035] text-slate-200"}`}>
                        <div className="text-sm font-medium">{item.icon} {item.label}</div>
                        {item.description && <div className={`mt-1 text-[11px] ${view === item.key ? "text-blue-100" : "text-slate-500"}`}>{item.description}</div>}
                      </button>
                    ))}
                  </div>
                </div>
              ))}

              <div className="mt-3 flex items-center justify-between rounded-xl border border-white/5 bg-slate-950/60 p-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-white">{authUser?.displayName || authUser?.username || "Not signed in"}</div>
                  {authUser && <div className="text-[10px] capitalize text-slate-500">{authUser.role}</div>}
                </div>
                {authUser && <button type="button" onClick={onLogout} className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300">Sign out</button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
