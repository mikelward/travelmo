import { describe, expect, it } from "vitest";
import { oneLine, smtpConfig, smtpMailer, type Transport } from "./mail";

// Invented hosts and addresses.
describe("smtpConfig", () => {
  it("is off without a host, and reads the rest with the usual defaults", () => {
    expect(smtpConfig({})).toBeUndefined();
    expect(smtpConfig({ SMTP_HOST: "smtp.example", SMTP_FROM: "Travelmo <no-reply@example>" })).toEqual({
      host: "smtp.example",
      port: 465,
      secure: true,
      from: "Travelmo <no-reply@example>",
    });
    expect(smtpConfig({ SMTP_HOST: "smtp.example", SMTP_PORT: "587", SMTP_USERNAME: "u", SMTP_PASSWORD: "p", SMTP_FROM: "a@example" })).toEqual({
      host: "smtp.example",
      port: 587,
      secure: false,
      user: "u",
      pass: "p",
      from: "a@example",
    });
    expect(smtpConfig({ SMTP_HOST: "smtp.example", SMTP_PORT: "2525", SMTP_TLS: "true", SMTP_FROM: "a@example" })?.secure).toBe(true);
  });

  it("refuses a bad port or a missing sender", () => {
    expect(() => smtpConfig({ SMTP_HOST: "smtp.example", SMTP_PORT: "lots", SMTP_FROM: "a@example" })).toThrow("SMTP_PORT");
    expect(() => smtpConfig({ SMTP_HOST: "smtp.example" })).toThrow("SMTP_FROM");
  });
});

describe("smtpMailer", () => {
  it("sends from the configured address with one-line headers", async () => {
    const sent: unknown[] = [];
    const transport: Transport = { sendMail: async (m) => void sent.push(m) };
    const mail = smtpMailer({ host: "smtp.example", port: 465, secure: true, from: "Travelmo <no-reply@example>" }, transport);
    await mail({ to: "traveler@example", subject: "Before your trip to Liverpool\r\nBcc: x@example", text: "Hi\nthere" });
    expect(sent).toEqual([{ from: "Travelmo <no-reply@example>", to: "traveler@example", subject: "Before your trip to Liverpool Bcc: x@example", text: "Hi\nthere" }]);
    expect(oneLine(" a \u0000b\n\nc ")).toBe("a b c");
  });
});
