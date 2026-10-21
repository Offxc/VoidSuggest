import type { Metadata } from "next";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Terms" };

export default async function TermsPage() {
  const settings = await getSettings();
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">Terms</h1>
      </div>
      <div className="prose panel panel-pad">
        <p>
          These are the ground rules for {settings.siteName}. They are a plain-language summary, not legal advice.
        </p>
        <ul>
          <li>Taking part requires the Member role in the Discord server, and you must follow that server's rules here too.</li>
          <li>You are responsible for what you post. Keep it civil, on topic, and free of anything illegal, hateful or private to someone else.</li>
          <li>
            Suggestions are reviewed by the site owner before they appear. They may be declined, edited, moved or removed at any time, without
            notice.
          </li>
          <li>Posting a suggestion does not promise it will be built, or that credit or reward will follow.</li>
          <li>You give the server permission to display what you post here. Ideas you share may be used by the server without payment.</li>
          <li>Voting and commenting are limited to keep things fair. Trying to get around those limits, or using extra accounts, can get you blocked.</li>
          <li>The service is provided as is, and may change or stop at any time.</li>
        </ul>
      </div>
    </div>
  );
}
