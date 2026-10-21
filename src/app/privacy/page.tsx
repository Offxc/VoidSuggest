import type { Metadata } from "next";
import { getEnv } from "@/server/env";
import { getSettings } from "@/server/settings";

export const metadata: Metadata = { title: "Privacy" };

export default async function PrivacyPage() {
  const [settings, env] = [await getSettings(), getEnv()];
  const contact = env.CONTACT_EMAIL;
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1 className="page-title">Privacy</h1>
      </div>
      <div className="prose panel panel-pad">
        <p>
          {settings.siteName} lets members of a Discord community suggest ideas and vote on them. This page explains what it keeps. It is a
          plain-language summary, not legal advice.
        </p>
        <h3>What is stored</h3>
        <ul>
          <li>
            When you sign in with Discord: your Discord user ID, your username and display name, your server nickname, your avatar, whether you
            hold the Member role, and when you joined the server.
          </li>
          <li>What you post: suggestions, comments and votes, with the time you made them.</li>
          <li>
            A security log of sign-ins, sign-outs and moderation actions, including the IP address and browser name of the request. It is
            visible only to the site owner.
          </li>
        </ul>
        <h3>What is not stored</h3>
        <ul>
          <li>Your Discord access token. It is used once during sign-in and then discarded.</li>
          <li>Your email address, messages, or anything else from your Discord account.</li>
          <li>Analytics or advertising data. This site does not use trackers or third-party scripts.</li>
        </ul>
        <h3>Cookies</h3>
        <p>One cookie keeps you signed in. A short-lived one is used during the sign-in step. There are no tracking cookies.</p>
        <h3>Who can see what</h3>
        <p>
          Anyone can see the approved suggestions, comments, vote counts, and the display names and avatars of the people who wrote them.
          Only the site owner can see who voted for what.
        </p>
        <h3>Your choices</h3>
        <p>
          {contact ? (
            <>
              To see, correct or remove your information, email <a href={`mailto:${contact}`}>{contact}</a>.
            </>
          ) : (
            <>To see, correct or remove your information, ask the server staff.</>
          )}{" "}
          Removing your Member role in Discord stops you from taking part, and your votes on open suggestions are withdrawn.
        </p>
      </div>
    </div>
  );
}
