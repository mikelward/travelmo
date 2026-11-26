import {
  accessBadge,
  accessDecision,
  accessInvite,
  accessLists,
  accessStatus,
  canRevoke,
  grandfatheredAccess,
  isApproved,
  letsIn,
  needsGrandfathering,
  normalizeEmail,
  AccessRecord,
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
    expect(accessStatus({ ...base, record: { email: "new@example.com", uid: "u1" } })).toBe("none");
    // A status this version does not know lets nobody in.
    expect(AccessRecord.parse({ email: "new@example.com", status: "maybe" }).status).toBeUndefined();
  });

  it("lets in an address an admin approved or someone shared with", () => {
    const requested: AccessRecord = { email: "new@example.com", uid: "u1" };
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

  it("counts an admin's listing, an approval or an invite of a linked address", () => {
    const linked = ["work@company.example"];
    expect(accessStatus({ ...base, linked: ["admin@example.com"] })).toBe("approved");
    expect(accessStatus({ ...base, linked, linkedRecords: [{ email: "work@company.example", status: "approved" }] })).toBe("approved");
    expect(accessStatus({ ...base, linked, linkedRecords: [{ email: "work@company.example", invitedBy: "u1" }] })).toBe("approved");
    // Not a declined one, a request, or the record of an address not linked.
    expect(accessStatus({ ...base, linked, linkedRecords: [{ email: "work@company.example", status: "declined", invitedBy: "u1" }] })).toBe("none");
    expect(accessStatus({ ...base, linked, linkedRecords: [{ email: "work@company.example" }] })).toBe("none");
    expect(accessStatus({ ...base, linked, linkedRecords: [{ email: "other@example.com", status: "approved" }] })).toBe("none");
    // The sign-in's decline still wins over a linked address's approval.
    expect(
      accessStatus({
        ...base,
        record: { email: "new@example.com", status: "declined" },
        linked,
        linkedRecords: [{ email: "work@company.example", status: "approved" }],
      }),
    ).toBe("declined");
  });
});

describe("letsIn", () => {
  const invited: AccessRecord = { email: "work@example.com", invitedBy: "u1", invitedAt: now };
  it("is an admin's address, or one an admin approved or someone invited", () => {
    expect(letsIn("admin@example.com", undefined, config)).toBe(true);
    expect(letsIn("work@example.com", invited, config)).toBe(true);
    expect(letsIn("work@example.com", { email: "work@example.com", status: "approved" }, undefined)).toBe(true);
  });
  it("is not one that only asked, was declined, or has no record", () => {
    expect(letsIn("work@example.com", undefined, config)).toBe(false);
    expect(letsIn("work@example.com", { email: "work@example.com" }, config)).toBe(false);
    expect(letsIn("work@example.com", { ...invited, status: "declined" }, config)).toBe(false);
  });
  it("reads a record only for its own address", () => {
    expect(letsIn("other@example.com", invited, config)).toBe(false);
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
  it("lists approved addresses by name, and no declined ones", () => {
    const records: AccessRecord[] = [
      { email: "late@example.com", uid: "u2" },
      { email: "zed@example.com", ...accessDecision("approved", "admin", now) },
      accessInvite("amy@example.com", "friend", now),
      { uid: "u3", ...accessInvite("both@example.com", "friend", now) },
      { email: "gone@example.com", ...accessDecision("declined", "admin", now), invitedBy: "friend" },
    ];
    const { approved } = accessLists(records);
    expect(approved.map((r) => r.email)).toEqual(["amy@example.com", "both@example.com", "zed@example.com"]);
  });
});


describe("accessBadge", () => {
  const email = "amy@example.com";
  it("is admin for an admin's account, invited for one someone shared with, nothing for the rest", () => {
    expect(accessBadge(true, email, undefined)).toBe("admin");
    expect(accessBadge(false, email, { email, invitedBy: "u2", invitedAt: "2026-01-01T00:00:00Z" })).toBe("invited");
    expect(accessBadge(false, email, { email, status: "approved", approvedBy: "u2", approvedAt: "2026-01-01T00:00:00Z" })).toBeUndefined();
    // Another address's invitation, or one an admin declined, says nothing of this account.
    expect(accessBadge(false, email, { email: "zed@example.com", invitedBy: "u2", invitedAt: "2026-01-01T00:00:00Z" })).toBeUndefined();
    expect(accessBadge(false, email, { email, invitedBy: "u2", invitedAt: "2026-01-01T00:00:00Z", status: "declined", declinedBy: "u3" })).toBeUndefined();
  });
});
