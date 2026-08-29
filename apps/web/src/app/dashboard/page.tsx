import type { ReactElement } from 'react';
import { Dashboard } from '../../components/Dashboard.js';

/**
 * Route entry point. A Next route file may only export a fixed set of names, so the
 * component itself lives in components/Dashboard.tsx and is imported here. Data is fetched
 * server-side; this file renders it.
 */
export default function DashboardPage(): ReactElement {
  return <Dashboard abilities={[]} recentScores={[]} focusDimension={null} dueForReview={[]} />;
}
