import type { Metadata } from "next";
import { AdminNav } from "@/components/AdminNav";
import { requireOwner } from "@/server/current";
import { countPending } from "@/server/queries";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireOwner("/admin");
  const pending = await countPending();
  return (
    <div className="admin-shell">
      <AdminNav pending={pending} />
      <div className="stack-lg">{children}</div>
    </div>
  );
}
