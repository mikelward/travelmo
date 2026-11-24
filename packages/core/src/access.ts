import { z } from "zod";

// Who may use Travelmo (SPEC "Access"). Only approved accounts may: those
// that existed before approvals (they have a user document), admins, and
// those whose verified email an admin approved or someone already approved
// shared a trip or a travel profile with. `firestore.rules` and the
// parser's `requireUser` make the same decision as `accessStatus` here.

export const accessStatuses = ["approved", "declined"] as const;
export const AccessStatus = z.enum(accessStatuses);
export type AccessStatus = z.infer<typeof AccessStatus>;

// `access/{email}`, the id the lowercased address. `status` is the admins'
// decision; `invitedBy` is the last approved user who shared something with
// the address, which approves it unless an admin declined it.
// `grandfathered` marks an account the parser approved because it used the
// app before approvals did (`grandfatheredAccess`).
export const AccessRecord = z.object({
  email: z.string(),
  // Anything else (a status this version does not know) counts as none.
  status: AccessStatus.optional().catch(undefined),
  uid: z.string().optional(),
  invitedBy: z.string().optional(),
  invitedAt: z.string().optional(),
  approvedBy: z.string().optional(),
  approvedAt: z.string().optional(),
  declinedBy: z.string().optional(),
  declinedAt: z.string().optional(),
  grandfathered: z.boolean().optional(),
});
export type AccessRecord = z.infer<typeof AccessRecord>;

// `config/access`, written by hand in the Firebase console: admins'
// addresses in lowercase, as the rules compare them exactly.
export const AccessConfig = z.object({ admins: z.array(z.string()).default([]) });
export type AccessConfig = z.infer<typeof AccessConfig>;

// Where an account stands: "none" is not let in yet (Travelmo is
// invite-only: an invite or a share lets it in).
export type AccountAccess = "approved" | "declined" | "none";

// An address as sharing and the rules compare it: trimmed and lowercased.
// Undefined for anything that is not one address, or that could not be a
// document id (a slash).
export function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email)) return undefined;
  return email;
}

export function isAdminEmail(email: string | undefined, config: AccessConfig | undefined): boolean {
  return !!email && !!config && config.admins.includes(email);
}

export type AccessInputs = {
  // The account's verified email, normalized; undefined when unverified.
  email: string | undefined;
  // Whether `users/{uid}` exists: every account made before approvals has one.
  hasProfile: boolean;
  record: AccessRecord | undefined;
  config: AccessConfig | undefined;
  // The addresses the account confirmed besides its sign-in (emails.ts),
  // and their records: an admin's listing, an approval or an invite of any
  // of them lets the account in as one of the sign-in's would. Only the
  // sign-in's decline locks it out: that is the address an admin revokes.
  linked?: readonly string[] | undefined;
  linkedRecords?: readonly AccessRecord[] | undefined;
};

const lets = (record: AccessRecord | undefined): boolean =>
  !!record && record.status !== "declined" && (record.status === "approved" || !!record.invitedBy);

// Whether an address, once confirmed as the account's, would let it in: an
// admin's, or one whose record an admin approved or someone invited (and no
// admin declined). What an account not approved yet may link (SPEC "Linked
// email addresses"). A record speaks only for its own address.
export function letsIn(email: string, record: AccessRecord | undefined, config: AccessConfig | undefined): boolean {
  return isAdminEmail(email, config) || (record?.email === email && lets(record));
}

export function accessStatus({ email, hasProfile, record, config, linked = [], linkedRecords = [] }: AccessInputs): AccountAccess {
  if (isAdminEmail(email, config) || linked.some((address) => isAdminEmail(address, config))) return "approved";
  // A record speaks only for a verified address.
  const own = email && record?.email === email ? record : undefined;
  if (own?.status === "declined") return "declined";
  if (own?.status === "approved" || own?.invitedBy || hasProfile) return "approved";
  if (linkedRecords.some((r) => linked.includes(r.email) && lets(r))) return "approved";
  return "none";
}

export const isApproved = (inputs: AccessInputs): boolean => accessStatus(inputs) === "approved";

// What an approved user sharing with the address merges into its record.
export function accessInvite(email: string, inviterUid: string, now: string): Pick<AccessRecord, "email" | "invitedBy" | "invitedAt"> {
  return { email, invitedBy: inviterUid, invitedAt: now };
}

// Who approved a grandfathered record: no one, the change itself.
export const grandfatherApprover = "migration";

// What the parser records for an account that used Travelmo before
// approvals (it owns a trip or a travel profile, or one was shared with
// its address) and that nothing else lets in, so the rules never lock it
// out. `uid` is known for owners only.
export function grandfatheredAccess(email: string, now: string, uid?: string): AccessRecord {
  return { email, status: "approved", ...(uid ? { uid } : {}), approvedBy: grandfatherApprover, approvedAt: now, grandfathered: true };
}

// Whether that record is still needed: not for an account already let in,
// and never over a decline, which an admin's revoking wrote.
export const needsGrandfathering = (status: AccountAccess): boolean => status === "none";

// The fields an admin's decision changes: approving (also inviting an
// address that never asked) or declining (also revoking).
export function accessDecision(
  decision: "approved" | "declined",
  adminUid: string,
  now: string,
): Pick<AccessRecord, "status" | "approvedBy" | "approvedAt"> | Pick<AccessRecord, "status" | "declinedBy" | "declinedAt"> {
  return decision === "approved"
    ? { status: "approved", approvedBy: adminUid, approvedAt: now }
    : { status: "declined", declinedBy: adminUid, declinedAt: now };
}

// Admins and the admin acting are never revoked, so no one locks
// themselves or another admin out; the rules refuse it too.
export function canRevoke(email: string, adminEmail: string | undefined, config: AccessConfig | undefined): boolean {
  return email !== adminEmail && !isAdminEmail(email, config);
}

// Who the Access page lists: everyone approved by a record, by address.
// Declined records are listed nowhere; inviting the address again approves
// it.
export function accessLists(records: readonly AccessRecord[]): { approved: AccessRecord[] } {
  const approved = records
    .filter((r) => r.status === "approved" || (r.status !== "declined" && r.invitedBy))
    .sort((a, b) => a.email.localeCompare(b.email));
  return { approved };
}
