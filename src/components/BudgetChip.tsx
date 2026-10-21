import type { VoteBudgetDto } from "@/shared/types";

/** "3 of 5 votes left", as a row of filled and empty slots. */
export function BudgetChip({ budget }: { budget: VoteBudgetDto }) {
  if (budget.total === null) {
    return <span className="budget" title="There's no limit on votes here">Unlimited votes</span>;
  }
  const slots = Array.from({ length: Math.min(budget.total, 20) }, (_, i) => i < budget.used);
  const empty = budget.remaining === 0;
  return (
    <span className={`budget ${empty ? "empty-slots" : ""}`} title="Votes you have on suggestions that are still open. They come back when a suggestion you voted for moves on.">
      <span className="dots" aria-hidden="true">
        {slots.map((used, i) => (
          <span key={i} className={`dot ${used ? "used" : ""}`} />
        ))}
      </span>
      <span>
        {budget.remaining} of {budget.total} votes left
      </span>
    </span>
  );
}
