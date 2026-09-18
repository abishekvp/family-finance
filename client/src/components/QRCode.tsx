import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Skeleton } from "./ui";

/**
 * Renders a QR code entirely client-side (no third-party image service, no network request —
 * the value never leaves the browser). Colours are read from the CSS custom properties so the
 * code stays legible in both themes.
 */
export function QRCodeCard({ value, size = 176 }: { value: string; size?: number }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Phone cameras require dark finder patterns on a light background to reliably
    // detect and decode QR codes. We render crisp dark ink (#0d1122) on pure white (#ffffff),
    // contained within a high-contrast white card that stays clear and legible in both themes.
    QRCode.toString(value, {
      type: "svg",
      margin: 1,
      color: { dark: "#0d1122", light: "#ffffff" },
      width: size,
    })
      .then((markup: string) => {
        if (!cancelled) setSvg(markup);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error("QR code generation failed", err);
          setSvg(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (!svg) return <Skeleton style={{ width: size, height: size }} className="rounded-2xl" />;

  return (
    <div
      className="flex items-center justify-center rounded-2xl bg-white p-3 shadow-soft [&>svg]:block"
      style={{ width: size + 24, height: size + 24 }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
