import { Logo } from "./Logo";

/** The branded "opening your session" screen, shown while the stored session is being checked. */
export function FullPageLoader() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4">
      <Logo size={44} className="animate-pulse" />
      <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-sunken">
        <div className="h-full w-1/3 animate-shimmer rounded-full brand-gradient" />
      </div>
    </div>
  );
}
