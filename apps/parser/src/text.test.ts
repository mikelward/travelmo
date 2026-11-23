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

  it("reads the HTML when the plain part is only a footer", () => {
    const footer = "This is a service email.\r\nRegistered office: Example Air Ltd.";
    const itinerary = `<h1>Your booking confirmation</h1>${"<p>XX 11 Boston to London Heathrow, 23 Jul, departs 06:00, arrives 14:30</p>".repeat(5)}`;
    const text = emailText({
      mimeType: "multipart/alternative",
      parts: [
        { mimeType: "text/plain", body: { data: b64(footer) } },
        { mimeType: "text/html", body: { data: b64(`${itinerary}<p>${footer}</p>`) } },
      ],
    });
    expect(text).toContain("XX 11 Boston to London Heathrow");
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
