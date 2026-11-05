import { Suspense } from "react";

import ChartPageClient from "./ChartPageClient";

export default function ChartsPage() {
  return (
    <Suspense fallback={<div className="loading-block"><div className="loading-label">Loading chart workspace...</div></div>}>
      <ChartPageClient />
    </Suspense>
  );
}
