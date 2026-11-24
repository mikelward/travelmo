import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Fira_Sans, Geist } from "next/font/google";
import { Nav } from "@/components/Nav";
import { OfflineBanner } from "@/components/OfflineBanner";
import { BugReportProvider, ReportBug } from "@/components/ReportBug";
import { ServiceWorker } from "@/components/ServiceWorker";
import { AuthProvider } from "@/lib/auth";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
// The "Travelmo" wordmark only, as on the Play listing and in the Android
// app; everything else stays Geist.
const wordmark = Fira_Sans({ variable: "--font-fira-sans", weight: "500", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Travelmo", template: "%s · Travelmo" },
  description: "Your trips in one place, imported from your inbox.",
  manifest: "/manifest.webmanifest",
  // Added to the iPhone Home Screen, it opens without Safari's bars, under
  // this name; the icon is app/apple-icon.png.
  appleWebApp: { capable: true, title: "Travelmo", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${wordmark.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <AuthProvider>
          <BugReportProvider>
            <OfflineBanner />
            <Nav />
            <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
            <footer className="mx-auto flex w-full max-w-3xl gap-4 px-4 pb-6 text-sm text-muted">
              <Link href="/privacy" className="hover:underline">
                Privacy
              </Link>
              <ReportBug />
            </footer>
          </BugReportProvider>
        </AuthProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
