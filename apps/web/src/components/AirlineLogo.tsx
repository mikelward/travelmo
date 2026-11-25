import { airlineDarkLogos, airlineLogos } from "@/lib/airlineLogos";

// The airline's logo beside its name, as a flight is headed (bookingHeading),
// its version for a dark background in dark mode; nothing for an airline
// without one. Decorative: the name beside it says which airline.
export function AirlineLogo({ code, size = 18 }: { code: string | undefined; size?: number }) {
  if (!code || !airlineLogos.has(code)) return null;
  return (
    <picture className="shrink-0" data-testid="airline-logo">
      {airlineDarkLogos.has(code) && <source srcSet={`/airlines/${code}-dark.svg`} media="(prefers-color-scheme: dark)" />}
      {/* eslint-disable-next-line @next/next/no-img-element -- a bundled SVG, nothing for next/image to optimize */}
      <img src={`/airlines/${code}.svg`} alt="" width={size} height={size} className="object-contain" style={{ width: size, height: size }} />
    </picture>
  );
}
