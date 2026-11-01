import Link from "next/link";

export const metadata = { title: "Offline" };

// Served by the service worker in place of a page that was never opened
// while online (see src/sw.ts).
export default function OfflinePage() {
  return (
    <div className="mt-16 text-center text-zinc-600 dark:text-zinc-400">
      <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">You&apos;re offline</h1>
      <p className="mt-2">This page hasn&apos;t been saved on this device.</p>
      <p className="mt-2">
        <Link href="/" className="underline">
          Your trips
        </Link>{" "}
        and any trip you opened before are still available.
      </p>
    </div>
  );
}
