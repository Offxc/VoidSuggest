import type { ColorKey } from "@/shared/constants";
import type { StatusDto, TagDto, TypeDto } from "@/shared/types";
import { Icon } from "./icons";

export function Pill({ tone, children, href }: { tone: ColorKey; children: React.ReactNode; href?: string }) {
  const className = `pill tone-${tone}`;
  return href ? (
    <a className={className} href={href}>
      {children}
    </a>
  ) : (
    <span className={className}>{children}</span>
  );
}

export const StatusPill = ({ status }: { status: StatusDto }) => <Pill tone={status.color}>{status.name}</Pill>;

export const TypePill = ({ type }: { type: TypeDto }) => (
  <Pill tone={type.color}>
    <Icon name={type.icon} />
    {type.name}
  </Pill>
);

export const TagPill = ({ tag, href }: { tag: TagDto; href?: string }) => (
  <Pill tone={tag.color} href={href}>
    {tag.name}
  </Pill>
);

export function OwnerBadge() {
  return <span className="pill pill-owner">Owner</span>;
}
