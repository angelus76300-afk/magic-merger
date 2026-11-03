// Which programs a browser fetches again when it opens (3.3, src/worldhost.ts
// syncPrograms): the Worker says which version each element has now.
export function programToFetch(now: { id: number; trial?: boolean } | undefined, heldId: number | undefined): boolean {
  if (!now) return false;
  // A different version is live now (a rewrite, a rollback, the refresh).
  if (now.id !== heldId) return true;
  // The very trial this browser holds: its test run never reached the Worker
  // (a lost request), so it is fetched and tested again, or it would stay a
  // trial for good, cast and voted on without ever passing its test.
  return now.trial === true;
}
