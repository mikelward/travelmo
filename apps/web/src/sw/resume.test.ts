import { describe, expect, it } from "vitest";
import { resumeRequest } from "./resume";

const shell =
  `<html><head><script src="/_next/static/chunks/a.js" noModule=""></script>` +
  `<script>__NEXT_CLIENT_RESUME=fetch(location.pathname+'?_rsc=xhdorIanPcIpYSsE',` +
  `{credentials:'same-origin',headers:{'rsc': '1','next-router-prefetch': '1','next-router-segment-prefetch': '/_full'}})</script>` +
  `</head><body><p>Loading…</p></body></html>`;

describe("resumeRequest", () => {
  it("reads the runtime data request out of a static shell", () => {
    const request = resumeRequest(shell, new URL("https://travelmo.example/trips/abc"));
    expect(request?.url).toBe("https://travelmo.example/trips/abc?_rsc=xhdorIanPcIpYSsE");
    expect(request?.headers.get("rsc")).toBe("1");
    expect(request?.headers.get("next-router-prefetch")).toBe("1");
    expect(request?.headers.get("next-router-segment-prefetch")).toBe("/_full");
  });

  it("yields nothing for a page without runtime data", () => {
    expect(resumeRequest("<html><body>static</body></html>", new URL("https://travelmo.example/offline"))).toBeUndefined();
  });
});
