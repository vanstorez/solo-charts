"use client";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="empty-state" style={{ minHeight: 420 }}>
      <div className="empty-mark">!</div>
      <strong>Terminal error</strong>
      <p>{error.message || "An unexpected render error occurred. Provider data was not replaced or invented."}</p>
      <button className="button primary" onClick={reset} type="button">Try again</button>
    </div>
  );
}
