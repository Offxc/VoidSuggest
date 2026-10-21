import type { PersonDto } from "@/shared/types";
import { OwnerBadge } from "./Pills";

/** A name with their avatar. Names are the Discord server nickname; the owner gets a badge so a nickname can't pass for them. */
export function Person({ person, small = false, hideAvatar = false }: { person: PersonDto; small?: boolean; hideAvatar?: boolean }) {
  return (
    <span className="who">
      {!hideAvatar && (
        <img className={`avatar ${small ? "avatar-sm" : ""}`} src={person.avatarUrl} alt="" width={small ? 22 : 28} height={small ? 22 : 28} loading="lazy" referrerPolicy="no-referrer" />
      )}
      <strong>{person.name}</strong>
      {person.isOwner && <OwnerBadge />}
    </span>
  );
}
