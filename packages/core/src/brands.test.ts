import { describe, expect, it } from "vitest";
import { bookingBrand, brandLogoIds, brands } from "./brands";

const stay = (title: string, provider?: string) => ({ type: "lodging" as const, title, ...(provider ? { provider } : {}) });

describe("bookingBrand", () => {
  it("names the brand the traveler knows, falling back to its parent for a logo", () => {
    expect(brandLogoIds(stay("Holiday Inn Express Boston North-Woburn by IHG"))).toEqual(["holidayinnexpress", "ihg"]);
    expect(brandLogoIds(stay("Hampton by Hilton London Gatwick"))).toEqual(["hampton", "hilton"]);
    expect(brandLogoIds(stay("London Hilton on Park Lane"))).toEqual(["hilton"]);
    expect(brandLogoIds(stay("The Ritz-Carlton, Berlin"))).toEqual(["ritzcarlton", "marriott"]);
  });
  it("prefers a hotel's brand over the booking site it was booked through", () => {
    expect(bookingBrand(stay("Novotel Paris Centre", "Booking.com"))?.id).toBe("novotel");
    expect(bookingBrand(stay("Hôtel du Marais", "Booking.com"))?.id).toBe("booking");
    expect(bookingBrand(stay("Cottage by the sea", "Airbnb"))?.id).toBe("airbnb");
  });
  it("names a brand only for its kind of booking, as whole words", () => {
    expect(bookingBrand({ type: "car_rental", title: "SIXT Göteborg Central Train Station" })?.id).toBe("sixt");
    expect(bookingBrand({ type: "train", title: "Eurostar 9014" })?.id).toBe("eurostar");
    expect(bookingBrand({ type: "flight", title: "Hilton Head to Atlanta" })).toBeUndefined();
    expect(bookingBrand(stay("Cove Liverpool"))).toBeUndefined();
    expect(bookingBrand(stay("Hiltonia guest house"))).toBeUndefined();
  });
  it("lists each brand once, every parent a brand", () => {
    const ids = brands.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const b of brands) if (b.parent) expect(ids).toContain(b.parent);
  });
});
