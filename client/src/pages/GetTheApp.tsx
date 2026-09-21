import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  Laptop,
  MonitorSmartphone,
  Share,
  ShieldCheck,
  SquarePlus,
  Wifi,
} from "lucide-react";
import { api } from "../api/client";
import { Badge, Button, Card, CardHeader, cn } from "../components/ui";
import { QRCodeCard } from "../components/QRCode";
import { useInstall } from "../lib/install";
import { Logo } from "../components/Logo";

const FALLBACK_APK_PATH = "/downloads/family-finance.apk";
const FALLBACK_APK_VERSION = "1.0.0";

function formatBytes(bytes: number) {
  if (bytes <= 0) return "";
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function GetTheApp() {
  const { canPrompt, isInstalled, platform, promptInstall } = useInstall();
  const [apkPath, setApkPath] = useState(FALLBACK_APK_PATH);
  const [apkVersion, setApkVersion] = useState(FALLBACK_APK_VERSION);
  const [apkSize, setApkSize] = useState<string | null>(null);
  const [apkAvailable, setApkAvailable] = useState<boolean | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const pageUrl = typeof window !== "undefined" ? window.location.origin + "/get-the-app" : "";

  useEffect(() => {
    api
      .get<{ latestVersion: string; apkUrl: string }>("/app/version")
      .then((res) => {
        setApkVersion(res.data.latestVersion);
        setApkPath(res.data.apkUrl);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch(apkPath, { method: "HEAD" })
      .then((res) => {
        setApkAvailable(res.ok);
        const length = res.headers.get("content-length");
        if (length) setApkSize(formatBytes(Number(length)));
      })
      .catch(() => setApkAvailable(false));
  }, [apkPath]);

  async function handleInstallClick() {
    setInstalling(true);
    const accepted = await promptInstall();
    setInstalling(false);
    if (accepted) setInstalled(true);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="text-center">
        <Logo size={44} className="mx-auto mb-3" />
        <h2 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">
          Take Family Finance with you
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink-muted">
          Install the installable web app on any device, or grab the native Android build below.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* -------------------------------------------------------- PWA install */}
        <Card className="flex flex-col">
          <CardHeader
            title="Install the web app"
            subtitle="Works on any phone, tablet or laptop"
            icon={<MonitorSmartphone size={17} />}
          />

          {isInstalled || installed ? (
            <div className="mt-auto flex items-center gap-2.5 rounded-xl bg-income-soft px-3.5 py-3 text-sm font-medium text-income">
              <CheckCircle2 size={18} />
              Already installed on this device
            </div>
          ) : canPrompt ? (
            <div className="mt-auto space-y-3">
              <p className="text-sm text-ink-muted">
                Adds Family Finance to your home screen or app list, with its own window and an
                offline-ready shell.
              </p>
              <Button className="w-full" icon={<Download size={16} />} loading={installing} onClick={handleInstallClick}>
                Install app
              </Button>
            </div>
          ) : platform === "ios" ? (
            <ol className="mt-auto space-y-2.5 text-sm text-ink-muted">
              <li className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-soft text-2xs font-bold text-brand-600">1</span>
                Open this page in <span className="font-semibold text-ink">Safari</span>.
              </li>
              <li className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-soft text-2xs font-bold text-brand-600">2</span>
                Tap the Share icon <Share size={13} className="mx-0.5 inline" /> in the toolbar.
              </li>
              <li className="flex items-start gap-2.5">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-soft text-2xs font-bold text-brand-600">3</span>
                Choose <span className="font-semibold text-ink">Add to Home Screen</span>{" "}
                <SquarePlus size={13} className="mx-0.5 inline" />.
              </li>
            </ol>
          ) : (
            <p className="mt-auto text-sm text-ink-muted">
              Open this page from your phone's browser (or scan the QR code) to install it — most
              browsers offer an "Install app" option in their menu.
            </p>
          )}
        </Card>

        {/* -------------------------------------------------------- APK download */}
        <Card className="flex flex-col">
          <CardHeader
            title="Android app (APK)"
            subtitle={apkSize ? `Version ${apkVersion} · ${apkSize}` : `Version ${apkVersion}`}
            icon={<Laptop size={17} />}
            actions={<Badge tone="brand">Android</Badge>}
          />

          {apkAvailable === false ? (
            <p className="mt-auto text-sm text-ink-subtle">
              The APK isn't published on this deployment yet. Ask whoever runs this workspace to
              build and upload one.
            </p>
          ) : (
            <div className="mt-auto space-y-3">
              <p className="text-sm text-ink-muted">
                A direct install — no Play Store needed. Your phone will warn about "unknown
                sources"; that's expected for a side-loaded app.
              </p>
              <a href={apkPath} download>
                <Button className="w-full" icon={<Download size={16} />} disabled={apkAvailable === null}>
                  Download APK
                </Button>
              </a>
            </div>
          )}
        </Card>
      </div>

      <Card className="flex flex-col items-center gap-5 text-center sm:flex-row sm:text-left">
        <QRCodeCard value={pageUrl} size={140} />
        <div>
          <h3 className="text-base font-bold text-ink">Scan with your phone</h3>
          <p className="mt-1 text-sm text-ink-muted">
            Opens this page on your phone, where you can install the web app or download the APK
            directly — no typing a URL.
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Installing the APK" icon={<ShieldCheck size={17} />} />
        <ol className="space-y-3 text-sm text-ink-muted">
          {[
            "Download the APK using the button above (from your phone's browser).",
            "Open the downloaded file. Android will ask to allow installs from this source the first time — allow it just for your browser.",
            "Tap Install, then open Family Finance from your app list.",
            "Sign in with the same account you use on the web.",
          ].map((step, i) => (
            <li key={i} className={cn("flex items-start gap-3")}>
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand-600">
                {i + 1}
              </span>
              <span className="pt-0.5">{step}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-surface-sunken/60 px-3.5 py-3 text-xs text-ink-subtle">
          <Wifi size={14} className="mt-0.5 shrink-0" />
          The app talks to the same server as the website — your data stays in sync across both.
        </div>
      </Card>
    </div>
  );
}
