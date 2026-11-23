import {
  accessDecision,
  accessInvite,
  accessLists,
  accessRequest,
  accessRequestMessage,
  accessStatus,
  canRevoke,
  grandfatheredAccess,
  isApproved,
  needsGrandfathering,
  normalizeEmail,
  type AccessRecord,
} from "./access";

const now = "2026-11-23T10:00:00Z";
const config = { admins: ["admin@example.com"] };
const base = { email: "new@example.com", hasProfile: false, record: undefined, config };

describe("normalizeEmail", () => {
  it("trims and lowercases one address", () => {
    expect(normalizeEmail("  New@Example.COM ")).toBe("new@example.com");
  });
  it("refuses what is not one address or could not be a document id", () => {
    for (const bad of ["", "   ", "new", "new@", "@example.com", "a b@example.com", "a/b@example.com", "a@b@example.com", null, undefined]) {
      expect(normalizeEmail(bad)).toBeUndefined();
    }
  });
});

describe("accessStatus", () => {
  it("lets in an account made before approvals, which has a user document", () => {
    expect(accessStatus({ ...base, hasProfile: true })).toBe("approved");
    expect(accessStatus({ ...base, email: undefined, hasProfile: true })).toBe("approved");
  });

  it("keeps out a new account until it is approved", () => {
    expect(accessStatus(base)).toBe("none");
    expect(isApproved(base)).toBe(false);
    expect(accessStatus({ ...base, record: accessRequest("new@example.com", "u1", now) })).toBe("requested");
  });

  it("lets in an address an admin approved or someone shared with", () => {
    const requested = accessRequest("new@example.com", "u1", now);
    expect(accessStatus({ ...base, record: { ...requested, ...accessDecision("approved", "admin", now) } })).toBe("approved");
    expect(accessStatus({ ...base, record: accessInvite("new@example.com", "friend", now) })).toBe("approved");
    expect(accessStatus({ ...base, record: { ...requested, ...accessInvite("new@example.com", "friend", now) } })).toBe("approved");
  });

  it("lets a decline or revocation win over a user document and an invite", () => {
    const declined: AccessRecord = {
      ...accessDecision("declined", "admin", now),
      ...accessInvite("new@example.com", "friend", now),
    };
    expect(accessStatus({ ...base, hasProfile: true, record: declined })).toBe("declined");
  });

  it("always lets in an admin", () => {
    expect(accessStatus({ ...base, email: "admin@example.com" })).toBe("approved");
    expect(accessStatus({ ...base, email: "admin@example.com", record: { email: "admin@example.com", status: "declined" } })).toBe("approved");
  });

  it("reads a record only for the verified address it belongs to", () => {
    expect(accessStatus({ ...base, email: undefined, record: { email: "new@example.com", status: "approved" } })).toBe("none");
    expect(accessStatus({ ...base, record: { email: "other@example.com", status: "approved" } })).toBe("none");
  });
});

describe("grandfatheredAccess", () => {
  it("approves an account from before approvals, marked as the change's doing", () => {
    const record = grandfatheredAccess("new@example.com", now, "u1");
    expect(record).toEqual({ email: "new@example.com", status: "approved", uid: "u1", approvedBy: "migration", approvedAt: now, grandfathered: true });
    expect(accessStatus({ ...base, record })).toBe("approved");
    expect(grandfatheredAccess("new@example.com", now)).not.toHaveProperty("uid");
  });

  it("is needed only by an account nothing else lets in, and never over a decline", () => {
    expect(needsGrandfathering("none")).toBe(true);
    expect(needsGrandfathering("requested")).toBe(true);
    expect(needsGrandfathering("approved")).toBe(false);
    expect(needsGrandfathering("declined")).toBe(false);
  });

  it("lets a later revocation win", () => {
    const record = { ...grandfatheredAccess("new@example.com", now), ...accessDecision("declined", "admin", now) };
    expect(accessStatus({ ...base, record })).toBe("declined");
  });
});

describe("canRevoke", () => {
  it("never revokes an admin or the admin acting", () => {
    expect(canRevoke("new@example.com", "admin@example.com", config)).toBe(true);
    expect(canRevoke("admin@example.com", "other-admin@example.com", config)).toBe(false);
    expect(canRevoke("me@example.com", "me@example.com", config)).toBe(false);
  });
});

describe("accessLists", () => {
  it("lists requests oldest first and approved addresses by name, and no declined ones", () => {
    const records: AccessRecord[] = [
      accessRequest("late@example.com", "u2", "2026-11-23T12:00:00Z"),
      accessRequest("early@example.com", "u1", "2026-11-22T12:00:00Z"),
      { email: "zed@example.com", ...accessDecision("approved", "admin", now) },
      accessInvite("amy@example.com", "friend", now),
      { ...accessRequest("both@example.com", "u3", now), ...accessInvite("both@example.com", "friend", now) },
      { email: "gone@example.com", ...accessDecision("declined", "admin", now), invitedBy: "friend" },
    ];
    const { pending, approved } = accessLists(records);
    expect(pending.map((r) => r.email)).toEqual(["early@example.com", "late@example.com"]);
    expect(approved.map((r) => r.email)).toEqual(["amy@example.com", "both@example.com", "zed@example.com"]);
  });
});

describe("accessRequestMessage", () => {
  it("names the address and links to the Access page", () => {
    const message = accessRequestMessage("new@example.com", "https://travelmo.example");
    expect(message.subject).toBe("Travelmo access request");
    expect(message.text).toBe("new@example.com asked to use Travelmo.\n\nApprove or decline: https://travelmo.example/access\n");
    expect(message.url).toBe("https://travelmo.example/access");
  });
});
