export type UserRole = "tech" | "bp_owner" | "dispatcher" | "supervisor" | "director";

export type AuthUser = {
  userId?: string;
  email?: string;
  techNumber?: string;
  username: string;
  role: UserRole;
  displayName?: string;
  companyId?: string;
  canApproveTimeOff?: boolean;
};

export type ViewKey =
  | "dashboard"
  | "metrics"
  | "tnps"
  | "ftrHits"
  | "onbForm"
  | "onbMgmt"
  | "assets"
  | "techProfiles"
  | "formsCenter"
  | "myForms"
  | "myProfile"
  | "payroll"
  | "adminCompanies"
  | "adminLocations"
  | "adminManagers"
  | "adminUsers"
  | "adminSettings"
  | "dataUploads"
  | "timeOff"
  | "timeOffApprovals";
