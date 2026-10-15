export const dynamic = "force-dynamic";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FINANCE_COOKIE, verifySessionToken } from "../../../lib/finance/auth";
import ManageClient from "./ManageClient";

export const metadata = { title: "Dashboard — Manage" };

export default async function ManagePage() {
  const cookieStore = await cookies();
  if (!verifySessionToken(cookieStore.get(FINANCE_COOKIE)?.value)) {
    redirect("/dashboard/login");
  }

  const seedEnabled =
    process.env.NODE_ENV !== "production" ||
    process.env.FINANCE_ALLOW_SEED === "true";

  return <ManageClient seedEnabled={seedEnabled} />;
}
