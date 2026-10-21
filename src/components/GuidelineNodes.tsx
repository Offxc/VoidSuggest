import type { GuidelineDto } from "@/shared/types";
import type { GuidelineItem } from "./SuggestionForm";
import { Markdown } from "./Markdown";

/** Renders guidelines on the server so the form (a client component) can show and hide them without shipping the markdown renderer. */
export function toGuidelineItems(guidelines: GuidelineDto[]): GuidelineItem[] {
  return guidelines.map((g) => ({
    id: g.id,
    appliesToAll: g.appliesToAll,
    typeIds: g.typeIds,
    node: (
      <>
        <h3>{g.title}</h3>
        <Markdown>{g.body}</Markdown>
      </>
    ),
  }));
}
