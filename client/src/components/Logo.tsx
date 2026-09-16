/**
 * The Family Finance mark: an aurora-gradient tile carrying three ascending bars — shared
 * balances, growing. Kept as a single inline SVG so it stays crisp at any size and needs no
 * network round-trip. The same geometry drives the favicon, the PWA icons and the Android
 * launcher icon; edit assets-src/*.svg and run `npm run icons` to regenerate those.
 */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      role="img"
      aria-label="Family Finance"
    >
      <defs>
        <linearGradient id="ff-logo-tile" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop stopColor="#5B46E5" />
          <stop offset="0.55" stopColor="#8B5CF6" />
          <stop offset="1" stopColor="#22D3EE" />
        </linearGradient>
        <linearGradient id="ff-logo-sheen" x1="24" y1="0" x2="24" y2="32" gradientUnits="userSpaceOnUse">
          <stop stopColor="#FFFFFF" stopOpacity="0.32" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="14" fill="url(#ff-logo-tile)" />
      <rect width="48" height="48" rx="14" fill="url(#ff-logo-sheen)" />

      <rect x="10.5" y="25" width="7.5" height="12.5" rx="3.75" fill="white" opacity="0.55" />
      <rect x="20.25" y="18.5" width="7.5" height="19" rx="3.75" fill="white" opacity="0.78" />
      <rect x="30" y="10.5" width="7.5" height="27" rx="3.75" fill="white" />
    </svg>
  );
}

/** Wordmark + tile, used on the auth screens and the install page hero. */
export function LogoLockup({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <Logo size={size} />
      <div className="leading-tight">
        <p className="text-[1.0625rem] font-extrabold tracking-tight text-ink">Family Finance</p>
        <p className="text-2xs font-medium uppercase tracking-[0.14em] text-ink-subtle">Money, together</p>
      </div>
    </div>
  );
}
