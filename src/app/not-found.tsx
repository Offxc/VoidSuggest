import Link from "next/link";

export default function NotFound() {
  return (
    <div className="panel empty">
      <span className="pixel">Not found</span>
      <p>That page doesn't exist, or you don't have access to it.</p>
      <p>
        <Link className="btn btn-ghost btn-sm" href="/">
          Back to the board
        </Link>
      </p>
    </div>
  );
}
