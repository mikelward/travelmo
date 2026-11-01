import { emailText, htmlToText, tidy } from "./text";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("emailText", () => {
  it("prefers the text/plain part of a multipart message", () => {
    const text = emailText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64("Flight BA117\r\nDeparts 09:00") } },
        { mimeType: "text/html", body: { data: b64("<p>Flight <b>BA117</b></p>") } },
      ],
    });
    expect(text).toBe("Flight BA117\nDeparts 09:00");
  });

  it("flattens HTML when no plain part exists, dropping links and images", () => {
    const text = emailText({
      mimeType: "text/html",
      body: { data: b64('<h1>Your stay</h1><img src="x.png"><p>Check-in <a href="https://x">3pm</a></p>') },
    });
    expect(text).toContain("Your stay");
    expect(text).toContain("Check-in 3pm");
    expect(text).not.toContain("https://x");
  });

  it("truncates very long bodies", () => {
    const text = emailText({ mimeType: "text/plain", body: { data: b64("x".repeat(50_000)) } });
    expect(text.length).toBe(24_000);
  });
});

describe("tidy", () => {
  it("collapses blank runs and trailing spaces", () => {
    expect(tidy("a  \n\n\n\nb \r\n")).toBe("a\n\nb");
  });
});

describe("htmlToText", () => {
  it("skips style blocks", () => {
    expect(htmlToText("<style>p{color:red}</style><p>hi</p>")).toBe("hi");
  });
});
