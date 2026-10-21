import Link from "next/link";
import type { SiteDto, ViewerDto } from "@/shared/types";
import { loginUrl } from "@/server/current";
import { Icon } from "./icons";

export function NewSuggestionButton({ viewer, site }: { viewer: ViewerDto | null; site: SiteDto }) {
  if (!viewer) {
    return (
      <a className="btn" href={loginUrl("/new")}>
        <Icon name="plus" />
        Sign in to suggest
      </a>
    );
  }
  if (!viewer.isOwner && !site.submissionsOpen) {
    return (
      <button type="button" className="btn" disabled title="New suggestions are paused right now">
        Suggestions paused
      </button>
    );
  }
  if (viewer.participationMessage) {
    return (
      <button type="button" className="btn" disabled title={viewer.participationMessage}>
        <Icon name="plus" />
        Suggest something
      </button>
    );
  }
  return (
    <Link className="btn" href="/new">
      <Icon name="plus" />
      Suggest something
    </Link>
  );
}
