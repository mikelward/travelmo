import { describe, expect, it } from "vitest";
import { installHint } from "./install";

const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const android = "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";

describe("installHint", () => {
  it("offers nothing once installed, the browser's prompt where there is one, and instructions on iPhone and iPad", () => {
    expect(installHint(iphone, 5, true, false)).toBe("installed");
    expect(installHint(android, 5, false, true)).toBe("prompt");
    expect(installHint(iphone, 5, false, false)).toBe("ios");
    // An iPad reads as a Mac, with a touch screen.
    expect(installHint(mac, 5, false, false)).toBe("ios");
    expect(installHint(mac, 0, false, false)).toBe("none");
    expect(installHint(android, 5, false, false)).toBe("none");
  });
});
