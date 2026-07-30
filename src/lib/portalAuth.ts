import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import type { AuthUser, UserRole } from "../types/navigation";

export type PortalProfile = {
  user_id: string;
  email: string;
  display_name: string | null;
  role: UserRole;
  tech_number: string | null;
  company_id: string | null;
  can_approve_time_off: boolean;
  active: boolean;
  invited_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
};

export type InvitePortalUserInput = {
  email: string;
  displayName: string;
  role: UserRole;
  techNumber?: string | null;
  companyId?: string | null;
};

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try { return JSON.stringify(error); } catch { return "Unexpected authentication error."; }
}

export async function loadCurrentPortalUser(session?: Session | null): Promise<AuthUser | null> {
  const activeSession = session ?? (await supabase.auth.getSession()).data.session;
  const authUser = activeSession?.user;
  if (!authUser) return null;

  const authEmail = (authUser.email || "").trim().toLowerCase();
  const isDemoAccount = authEmail === "demo@nexportal.xyz";

  // Keep the initial profile lookup intentionally small. Older/new demo databases
  // may not yet contain every optional profile column used elsewhere in the portal.
  const { data: baseProfile, error: baseError } = await supabase
    .from("portal_profiles")
    .select("user_id,email,role")
    .eq("user_id", authUser.id)
    .maybeSingle();

  // The public NexPortal demo must remain usable once Supabase Auth accepts the
  // credentials. This fallback only applies to the exact demo account.
  if (baseError || !baseProfile) {
    if (isDemoAccount) {
      return {
        userId: authUser.id,
        email: authEmail,
        username: authEmail,
        role: "director",
        displayName: "NexPortal Demo",
        canApproveTimeOff: true,
      };
    }

    if (baseError) throw new Error(messageOf(baseError));
    await supabase.auth.signOut();
    throw new Error("Portal profile was not found for this account.");
  }

  // Optional profile details are loaded separately so a missing optional column
  // cannot prevent a valid user from signing in.
  const { data: details } = await supabase
    .from("portal_profiles")
    .select("display_name,tech_number,company_id,can_approve_time_off,active")
    .eq("user_id", authUser.id)
    .maybeSingle();

  if (details?.active === false) {
    await supabase.auth.signOut();
    throw new Error("This portal account is inactive. Contact a Director.");
  }

  const role = (baseProfile.role || (isDemoAccount ? "director" : "tech")) as UserRole;
  const email = baseProfile.email || authUser.email || "";
  const techNumber = details?.tech_number || undefined;

  return {
    userId: baseProfile.user_id,
    email,
    username: techNumber || email || authUser.id,
    techNumber,
    role,
    displayName: details?.display_name || techNumber || email || "Portal User",
    companyId: details?.company_id || undefined,
    canApproveTimeOff: role === "director" || Boolean(details?.can_approve_time_off),
  };
}

export async function signInPortalUser(email: string, password: string): Promise<AuthUser> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error) throw error;
  const profile = await loadCurrentPortalUser(data.session);
  if (!profile) throw new Error("Portal profile was not found for this account.");
  return profile;
}

export async function signOutPortalUser(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function listPortalProfiles(): Promise<PortalProfile[]> {
  const { data, error } = await supabase
    .from("portal_profiles")
    .select("user_id,email,display_name,role,tech_number,company_id,can_approve_time_off,active,invited_at,last_sign_in_at,created_at")
    .order("display_name", { ascending: true });
  if (error) throw error;
  return (data || []) as PortalProfile[];
}

async function invokeAdminUsers(body: Record<string, unknown>): Promise<any> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw new Error(messageOf(sessionError));

  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    throw new Error("Your login session expired. Sign out and sign back in.");
  }

  const { data, error } = await supabase.functions.invoke("admin-users", {
    body,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (error) {
    let message = messageOf(error);
    const context = (error as { context?: unknown }).context;

    if (context instanceof Response) {
      try {
        const payload = await context.clone().json();
        if (payload && typeof payload === "object") {
          const record = payload as Record<string, unknown>;
          message = String(record.error || record.message || message);
        }
      } catch {
        try {
          const text = await context.clone().text();
          if (text.trim()) message = text.trim();
        } catch {
          // Keep the original Supabase client message.
        }
      }
    }

    throw new Error(message);
  }

  if (data?.error) throw new Error(String(data.error));
  return data;
}

export async function invitePortalUser(input: InvitePortalUserInput): Promise<void> {
  await invokeAdminUsers({
    action: "invite",
    email: input.email.trim().toLowerCase(),
    display_name: input.displayName.trim(),
    role: input.role,
    tech_number: input.role === "tech" ? input.techNumber || null : null,
    company_id: input.role === "bp_owner" ? input.companyId || null : null,
    redirect_to: `${window.location.origin}/?setup=1`,
  });
}


export type UpdatePortalUserInput = {
  userId: string;
  displayName: string;
  role: UserRole;
  techNumber?: string | null;
  companyId?: string | null;
  active: boolean;
};

export async function updatePortalUser(input: UpdatePortalUserInput): Promise<void> {
  const result = await invokeAdminUsers({
    action: "update-user",
    user_id: input.userId,
    display_name: input.displayName.trim(),
    role: input.role,
    tech_number: input.role === "tech" ? input.techNumber || null : null,
    company_id: input.role === "bp_owner" ? input.companyId || null : null,
    active: input.active,
  });

  if (!result?.profile || result.profile.role !== input.role) {
    throw new Error(`The role change was not saved. Expected ${input.role}, received ${result?.profile?.role || "no profile"}.`);
  }
}

export async function setPortalUserActive(userId: string, active: boolean): Promise<void> {
  await invokeAdminUsers({ action: "set_active", user_id: userId, active });
}

export async function deletePortalUser(userId: string): Promise<void> {
  await invokeAdminUsers({ action: "delete", user_id: userId });
}


export async function setTimeOffApprover(userId: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_time_off_approver", {
    target_user_id: userId,
    enabled,
  });
  if (error) throw error;
}

export async function sendPasswordResetCode(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/?reset=1`,
  });
  if (error) throw error;
}

export async function verifyPasswordResetCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: "recovery",
  });
  if (error) throw error;
}

export async function updateOwnPassword(password: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export function onPortalAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): () => void {
  const { data } = supabase.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}
