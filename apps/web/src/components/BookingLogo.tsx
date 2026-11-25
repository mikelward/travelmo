import { brandLogoIds, type BookingHeading, type Segment } from "@travelmo/core";
import { airlineDarkLogos, airlineLogos } from "@/lib/airlineLogos";
import { brandDarkLogos, brandLogos } from "@/lib/brandLogos";

// A booking's logo: a flight's airline's (bookingHeading), else the brand it
// names or its parent's (brandLogoIds), its version for a dark background in
// dark mode; nothing when there is none. Decorative: the row names it.
export function BookingLogo({ segment, heading, size = 18 }: { segment: Segment; heading: BookingHeading; size?: number }) {
  const airline = heading.airline && airlineLogos.has(heading.airline) ? heading.airline : undefined;
  const brand = airline ? undefined : brandLogoIds(segment).find((id) => brandLogos.has(id));
  if (!airline && !brand) return null;
  const [dir, id, dark] = airline ? ["airlines", airline, airlineDarkLogos.has(airline)] : ["brands", brand!, brandDarkLogos.has(brand!)];
  return (
    <picture className="shrink-0" data-testid={airline ? "airline-logo" : "brand-logo"}>
      {dark && <source srcSet={`/${dir}/${id}-dark.svg`} media="(prefers-color-scheme: dark)" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- a bundled SVG, nothing for next/image to optimize */}
      <img src={`/${dir}/${id}.svg`} alt="" width={size} height={size} className="object-contain" style={{ width: size, height: size }} />
    </picture>
  );
}
