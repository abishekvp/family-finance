/**
 * The fixed, non-interactive colour field every surface is frosted over.
 *
 * Four blurred radial blobs drift on long, offset cycles; a fine grain overlay keeps the
 * large gradients from banding on 8-bit displays. Purely decorative, so it is hidden from
 * assistive tech and its motion is disabled by the reduced-motion rule in index.css.
 */
export function Aurora() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-canvas" />

      <div
        className="absolute -left-[18%] -top-[22%] h-[62vmax] w-[62vmax] rounded-full blur-[110px] animate-aurora-drift"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgb(var(--aurora-1) / var(--aurora-opacity)), transparent 68%)",
        }}
      />
      <div
        className="absolute -right-[16%] -top-[10%] h-[54vmax] w-[54vmax] rounded-full blur-[120px] animate-aurora-drift"
        style={{
          animationDelay: "-9s",
          background:
            "radial-gradient(circle at 50% 50%, rgb(var(--aurora-2) / var(--aurora-opacity)), transparent 68%)",
        }}
      />
      <div
        className="absolute -bottom-[26%] left-[6%] h-[58vmax] w-[58vmax] rounded-full blur-[130px] animate-aurora-drift"
        style={{
          animationDelay: "-17s",
          background:
            "radial-gradient(circle at 50% 50%, rgb(var(--aurora-3) / calc(var(--aurora-opacity) * 0.8)), transparent 68%)",
        }}
      />
      <div
        className="absolute -bottom-[18%] -right-[12%] h-[46vmax] w-[46vmax] rounded-full blur-[110px] animate-aurora-drift"
        style={{
          animationDelay: "-23s",
          background:
            "radial-gradient(circle at 50% 50%, rgb(var(--aurora-4) / calc(var(--aurora-opacity) * 0.7)), transparent 68%)",
        }}
      />

      <div
        className="absolute inset-0 opacity-[0.035] mix-blend-overlay dark:opacity-[0.05]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
        }}
      />
    </div>
  );
}
