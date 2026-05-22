/**
 * Shared status-to-route resolver. Used by App.tsx (Protected/PublicOnly),
 * Login.tsx and AuthCallback.tsx so the destination is consistent across
 * every navigation that branches on user status.
 */

export function destinationForStatus(status: string | null | undefined): string {
  if (status === "approved") return "/dashboard";
  if (status === "pending") return "/pending";
  if (status === "rejected") return "/rejected";
  return "/login";
}
