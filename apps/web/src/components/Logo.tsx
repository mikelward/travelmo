// The app icon (app/icon.svg) inline, so it is crisp at any size and needs no
// request: a white paper plane with three dots of trail on an orange tile.
// Keep the geometry in step with app/icon.svg. Decorative beside the
// "Travelmo" wordmark, so screen readers skip it.
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="96" fill="#F26B1D" />
      <g transform="translate(-34.281 -2.425) scale(0.96096)">
        <path d="M186.8 247.6 430 126 357 344.9 308.4 259.8Z" fill="none" stroke="#fff" strokeWidth="24.3" strokeLinejoin="round" />
        <path d="M308.4 259.8 430 126" stroke="#fff" strokeWidth="24.3" strokeLinecap="round" />
        <circle cx="178" cy="408" r="16" fill="#fff" />
        <circle cx="219.5" cy="370.4" r="16" fill="#fff" />
        <circle cx="259.3" cy="331" r="16" fill="#fff" />
      </g>
    </svg>
  );
}
