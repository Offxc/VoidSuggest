import type { Metadata } from "next";
import { NotificationsForm } from "@/components/NotificationsForm";
import { requireOwner } from "@/server/current";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requireOwner("/admin/settings/notifications");
  const s = await getSettings();
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Notifications</h1>
          <p>Get a message in Discord when something needs your attention.</p>
        </div>
      </div>
      <NotificationsForm configured={Boolean(s.webhookUrlEnc)} notifyPending={s.notifyPending} notifyStatusChange={s.notifyStatusChange} />
    </>
  );
}
