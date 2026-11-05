import Link from "next/link";

export default function NotFound() {
  return (
    <div className="empty-state" style={{ minHeight: 420 }}>
      <div className="empty-mark">404</div>
      <strong>Workspace not found</strong>
      <p>The requested Solo Trading Charts route does not exist.</p>
      <Link className="button primary" href="/">Return to overview</Link>
    </div>
  );
}
