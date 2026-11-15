import type { Metadata } from "next";
import { DiscordBoardForm } from "@/components/DiscordBoardForm";
import { boardOverview } from "@/server/board";
import { requireOwner } from "@/server/current";

export const metadata: Metadata = { title: "Discord board" };

export default async function DiscordBoardPage() {
  const owner = await requireOwner("/admin/settings/discord");
  const board = await boardOverview(owner);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Discord board</h1>
          <p>Post suggestions in a channel so players can vote without leaving Discord.</p>
        </div>
      </div>
      <DiscordBoardForm initial={board} />
    </>
  );
}
