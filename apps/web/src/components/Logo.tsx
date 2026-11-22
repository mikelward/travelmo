// Written by scripts/icon-sources.mjs; edit that instead. The app icon
// (app/icon.svg) inline, so it is crisp at any size and needs no request.
// Decorative beside the "Travelmo" wordmark, so screen readers skip it.
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <rect width="512" height="512" rx="96" fill="#F26B1D" />
      <g transform="translate(29.577 17.331) scale(0.82463)" stroke="#fff" strokeLinecap="round">
        <path d="M186.8 247.6 430 126 357 344.9 308.4 259.8Z" fill="none" strokeWidth="24.3" strokeLinejoin="round" />
        <path d="M308.4 259.8 430 126" strokeWidth="24.3" />
        <path d="M120 452 C129.7 437.4 139.4 427 149 419.1" fill="none" strokeWidth="26" />
        <path d="M177.7 401 C190.8 394.5 203.9 389.5 217.1 381.4" fill="none" strokeWidth="26" />
        <path d="M243.4 360 C249.6 353.5 255.8 345.6 262 336" fill="none" strokeWidth="26" />
      </g>
    </svg>
  );
}
