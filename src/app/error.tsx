"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="panel empty">
      <span className="pixel">Something went wrong</span>
      <p>We couldn't load that. Try again, and if it keeps happening let the server staff know.</p>
      <div className="row" role="group" aria-label="Options">
        <button type="button" className="btn btn-sm" onClick={reset}>
          Try again
        </button>
        <Link className="btn btn-ghost btn-sm" href="/">
          Back to the board
        </Link>
      </div>
    </div>
  );
}
