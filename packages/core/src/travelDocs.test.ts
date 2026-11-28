import { describe, expect, it } from "vitest";
import { travelDocuments } from "./documents";
import { extractBcbpStrings, extractUkShareCode, extractedDocumentEntry, mergeBoardingPasses } from "./travelDocs";
import { parseDocumentEntry } from "./wallet";

describe("extractUkShareCode", () => {
  it("extracts holder, share code, and expiry from a GOV.UK immigration status email", () => {
    const entry = extractUkShareCode({
      from: "Status service <status.service@notifications.service.gov.uk>",
      subject: "SAM EXAMPLE – immigration status details",
      text: [
        "GOV.UK",
        "View immigration status details for SAM EXAMPLE",
        "They have used the 'View and prove your immigration status' service on GOV.UK to email you a share code.",
        "To view their status, go to the 'Check someone's immigration status' service on GOV.UK and enter their:",
        "date of birth",
        "share code ABC 12D 3EF",
        "This share code will expire on 3 December 2026",
      ].join("\n"),
    });

    expect(entry).toBeDefined();
    expect(entry!.title).toBe("UK share code — Sam Example");
    const parsed = parseDocumentEntry(entry!);
    expect(parsed.type).toBe("share_code");
    expect(parsed.country).toBe("United Kingdom");
    expect(parsed.number).toBe("ABC 12D 3EF");
    expect(parsed.expires).toBe("2026-12-03");
    expect(travelDocuments([entry!])[0]?.expires).toBe("2026-12-03");
  });

  it("extracts from a forwarded GOV.UK share code email", () => {
    const entry = extractUkShareCode({
      from: "Sam Example <sam@example.com>",
      subject: "Fwd: PAT EXAMPLE - immigration status details",
      text: [
        "---------- Forwarded message ---------",
        "From: Status service <status.service@notifications.service.gov.uk>",
        "Subject: PAT EXAMPLE – immigration status details",
        "",
        "share code XYZ98W7VU",
        "This share code will expire on 15 January 2027",
      ].join("\n"),
    });
    expect(entry).toBeDefined();
    expect(parseDocumentEntry(entry!).number).toBe("XYZ 98W 7VU");
    expect(parseDocumentEntry(entry!).expires).toBe("2027-01-15");
  });

  it("ignores unrelated emails", () => {
    expect(
      extractUkShareCode({
        from: "noreply@example.com",
        subject: "Your flight confirmation",
        text: "Confirmation code ABC123",
      }),
    ).toBeUndefined();
  });
});

describe("extractedDocumentEntry", () => {
  it("converts an ETA/ESTA approval into a Wallet visa document with expiry", () => {
    const entry = extractedDocumentEntry(
      {
        type: "esta",
        title: "US ESTA",
        country: "United States",
        number: "ESTA-99887766",
        expires: "2028-09-10",
        holder: "SAM EXAMPLE",
      },
      "ESTA Status Change",
    );
    expect(parseDocumentEntry(entry)).toMatchObject({
      type: "visa",
      title: "US ESTA",
      country: "United States",
      number: "ESTA-99887766",
      expires: "2028-09-10",
    });
    expect(travelDocuments([entry])[0]).toMatchObject({
      kind: "visa",
      country: "US",
      expires: "2028-09-10",
    });
  });
});

describe("mergeBoardingPasses", () => {
  it("merges passes by passenger and preserves distinct passengers", () => {
    const merged = mergeBoardingPasses(
      [{ passenger: "Sam Example", seat: "14A", boardingGroup: "2" }],
      [
        { passenger: "SAM EXAMPLE", gate: "B14", barcode: "M1EXAMPLE/SAM        E4K8M2P MANDOHQR 0022 332Y014A0042 100", barcodeFormat: "aztec" },
        { passenger: "Pat Example", seat: "14B", gate: "B14" },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged![0]).toMatchObject({
      seat: "14A",
      boardingGroup: "2",
      gate: "B14",
      barcodeFormat: "aztec",
    });
    expect(merged![1]).toMatchObject({ passenger: "Pat Example", seat: "14B", gate: "B14" });
  });

  it("preserves newer populated fields when merging an older email (preferIncoming = false)", () => {
    const merged = mergeBoardingPasses(
      [{ passenger: "Sam Example", seat: "16C", gate: "C10", barcode: "NEW-BCBP" }],
      [
        { passenger: "SAM EXAMPLE", seat: "14A", gate: "B14", boardingGroup: "2", barcode: "OLD-BCBP" },
        { passenger: "Pat Example", seat: "14B" },
      ],
      false,
    );
    expect(merged).toEqual([
      { passenger: "Sam Example", seat: "16C", gate: "C10", boardingGroup: "2", barcode: "NEW-BCBP" },
      { passenger: "Pat Example", seat: "14B" },
    ]);
  });

  it("keeps distinct non-Latin passenger names separate while merging identical ones", () => {
    const merged = mergeBoardingPasses(
      [{ passenger: "张伟", seat: "12A" }],
      [
        { passenger: "张伟", gate: "A1" },
        { passenger: "李娜", seat: "12B", gate: "A1" },
      ],
    );
    expect(merged).toEqual([
      { passenger: "张伟", seat: "12A", gate: "A1" },
      { passenger: "李娜", seat: "12B", gate: "A1" },
    ]);
  });

  it("updates fields when re-reading the same messageId even when preferIncoming is false", () => {
    const merged = mergeBoardingPasses(
      [{ passenger: "Sam Example", seat: "14A", gate: "B14", barcode: "OLD-BCBP", messageId: "bp-1" }],
      [{ passenger: "Sam Example", seat: "16C", gate: "C10", barcode: "FIXED-BCBP", messageId: "bp-1" }],
      false,
    );
    expect(merged).toEqual([
      { passenger: "Sam Example", seat: "16C", gate: "C10", barcode: "FIXED-BCBP", messageId: "bp-1" },
    ]);
  });

  it("matches airline surname-first and titled passenger names when replacing a pass", () => {
    const merged = mergeBoardingPasses(
      [{ passenger: "SMITH/JOHN MR", seat: "14A", barcode: "OLD-BCBP" }],
      [{ passenger: "John Smith", seat: "16C", gate: "C10", barcode: "NEW-BCBP" }],
    );
    expect(merged).toEqual([
      { passenger: "John Smith", seat: "16C", gate: "C10", barcode: "NEW-BCBP" },
    ]);
  });
});

describe("extractBcbpStrings", () => {
  it("stops at the exact BCBP payload boundary when followed by uppercase email text and newlines", () => {
    const bcbp = "M1EXAMPLE/SAM         E4K8M2P MANDOHQR 0022 332Y014A0042 100";
    expect(bcbp).toHaveLength(60);
    const emailText = `BOARDING PASS\n${bcbp}\nSEAT 14A\nGATE B14\nHave a good flight`;
    expect(extractBcbpStrings(emailText)).toEqual([bcbp]);
  });

  it("includes exact variable-length conditional data and stops before trailing text", () => {
    const varData = ">5180OO1234567890";
    const hexLen = varData.length.toString(16).toUpperCase().padStart(2, "0");
    const bcbp = `M1EXAMPLE/SAM         E4K8M2P MANDOHQR 0022 332Y014A0042 1${hexLen}${varData}`;
    const emailText = `Ref:\n${bcbp} GATE B14\nBOARDING GROUP 2`;
    expect(extractBcbpStrings(emailText)).toEqual([bcbp]);
  });
});
