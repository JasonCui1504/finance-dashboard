import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard",
  robots: { index: false, follow: false },
  manifest: "/dashboard.webmanifest",
  icons: { icon: "/dashboard-icon.svg", apple: "/dashboard-icon.svg" },
  appleWebApp: { capable: true, title: "Finance" },
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pt-8 pb-16">{children}</div>
  );
}
