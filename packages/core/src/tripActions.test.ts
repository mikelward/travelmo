import { describe, expect, it } from "vitest";
import { describeDeletedTrips, describeRefresh, describeRegroup, refreshButton, failedEmailIds, failedEmailLine, failedEmailsReport, failedEmailsShown, moreFailedEmails } from "./tripActions";

describe("describeRegroup", () => {
  it("says what changed", () => {
    expect(describeRegroup({ changed: 3, deleted: 0 })).toBe("Done: 3 trips rebuilt.");
    expect(describeRegroup({ changed: 1, deleted: 1 })).toBe("Done: 1 trip rebuilt, 1 trip merged away.");
  });

  it("says when nothing needed changing", () => {
    expect(describeRegroup({ changed: 0, deleted: 0 })).toBe("Your trips were already grouped this way.");
    expect(describeRegroup({ changed: 0, deleted: 0, placed: 0 })).toBe("Your trips were already grouped this way.");
  });

  it("counts the bookings it gave a place", () => {
    expect(describeRegroup({ changed: 0, deleted: 0, placed: 2 })).toBe("Done: 2 bookings placed.");
    expect(describeRegroup({ changed: 1, deleted: 0, placed: 1 })).toBe("Done: 1 trip rebuilt, 1 booking placed.");
  });
});

describe("describeDeletedTrips", () => {
  it("says how many went and what to do next", () => {
    expect(describeDeletedTrips(12)).toBe("Deleted 12 trips. Import past bookings to start again.");
    expect(describeDeletedTrips(1)).toBe("Deleted 1 trip. Import past bookings to start again.");
    expect(describeDeletedTrips(0)).toBe("You had no trips to delete.");
  });
});

describe("describeRefresh", () => {
  const base = { scanned: 120, done: false, total: 340 };

  it("says how far it has got", () => {
    expect(describeRefresh(base, true)).toBe("Refreshing your bookings… 120 of 340 emails read so far. You can close this page.");
    expect(describeRefresh(base, false)).toBe("Stopped part way: 120 of 340 emails read. Continue to refresh the rest.");
    expect(describeRefresh({ scanned: 1, done: false }, false)).toBe("Stopped part way: 1 email read. Continue to refresh the rest.");
  });

  it("says what changed once done", () => {
    expect(describeRefresh({ scanned: 340, total: 340, done: true, updated: 12, added: 2, merged: 3, removed: 1, kept: 4, missing: 2, failed: 1 }, false)).toBe(
      "Refreshed 340 emails: 12 bookings updated, 2 added, 3 duplicates merged, 1 removed. 4 bookings you edited were left as you left them. " +
        "2 emails are no longer in a connected mailbox. 1 email couldn't be read, even on a second try. Refresh again to see which.",
    );
    expect(describeRefresh({ scanned: 340, done: true, failed: 1, failedIds: ["m1"] }, false)).toBe(
      "Refreshed 340 emails: your bookings were already up to date. 1 email couldn't be read, even on a second try:",
    );
    expect(describeRefresh({ scanned: 1, done: true, updated: 1, merged: 1, kept: 1, missing: 1 }, false)).toBe(
      "Refreshed 1 email: 1 booking updated, 1 duplicate merged. 1 booking you edited was left as you left it. 1 email is no longer in a connected mailbox.",
    );
  });

  it("says when nothing needed changing", () => {
    expect(describeRefresh({ scanned: 2_400, done: true }, false)).toBe("Refreshed 2,400 emails: your bookings were already up to date.");
  });
});

describe("refreshButton", () => {
  it("starts a refresh, or continues one that stopped", () => {
    expect(refreshButton(undefined)).toBe("Refresh from email");
    expect(refreshButton({ scanned: 3, done: true })).toBe("Refresh from email");
    expect(refreshButton({ scanned: 3, done: false })).toBe("Continue refreshing");
  });
});

describe("a refresh's second try", () => {
  it("says it is trying the failed emails again", () => {
    expect(describeRefresh({ scanned: 340, done: false, total: 340, retrying: ["a", "b"] }, true)).toBe(
      "Refreshing your bookings… trying 2 emails that couldn't be read again. You can close this page.",
    );
    expect(describeRefresh({ scanned: 340, done: false, total: 340, retrying: ["a"] }, false)).toBe(
      "Stopped part way: 1 email that couldn't be read still to try again. Continue to try it.",
    );
  });
});

describe("the emails a refresh couldn't read", () => {
  const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);

  it("lists the first few once done, and counts the rest", () => {
    const done = { scanned: 340, done: true, failed: 14, failedIds: ids };
    expect(failedEmailIds(done)).toEqual(ids.slice(0, failedEmailsShown));
    expect(moreFailedEmails(done)).toBe("and 4 more");
    expect(failedEmailIds({ ...done, done: false })).toEqual([]);
    expect(moreFailedEmails({ scanned: 1, done: true, failed: 1, failedIds: ["m0"] })).toBeUndefined();
  });

  it("names each by subject and sender", () => {
    expect(failedEmailLine({ subject: "Your booking", from: "Example Air <hi@example.com>" })).toBe("Your booking · Example Air <hi@example.com>");
    expect(failedEmailLine({ subject: "  " })).toBe("(no subject)");
    expect(failedEmailLine(undefined)).toBe("(no subject)");
  });

  it("starts a report with their ids", () => {
    expect(failedEmailsReport({ scanned: 3, done: true, failed: 2, failedIds: ["m1", "m2"] })).toBe('"Refresh from email" couldn\'t read 2 emails: m1, m2');
  });
});
