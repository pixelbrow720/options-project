import { Copy, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AccessRequests,
  ApiKeys,
  type AccessRequestUser,
  type ApiKeySummary,
  type UserStatus,
} from "@/lib/api";
import { cn, formatRelative } from "@/lib/utils";

type FilterTab = "all" | UserStatus;

const TABS: { value: FilterTab; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "banned", label: "Banned" },
  { value: "all", label: "All" },
];

const DEFAULT_SYMBOLS = "SPXW, NDXP";

interface ApproveFormState {
  mode: "create" | "existing";
  label: string;
  allowedSymbols: string;
  apiKeyId: string;
}

function pickError(err: unknown): string {
  const detail = (err as { response?: { data?: { detail?: string } } }).response?.data?.detail;
  return detail || (err as Error).message || "Unknown error";
}

function statusBadge(status: UserStatus) {
  const map: Record<UserStatus, { className: string; label: string }> = {
    pending: { className: "bg-amber-500 text-black border-transparent", label: "pending" },
    approved: { className: "bg-emerald-600 text-white border-transparent", label: "approved" },
    rejected: { className: "bg-rose-600 text-white border-transparent", label: "rejected" },
    banned: { className: "bg-zinc-700 text-zinc-100 border-transparent", label: "banned" },
  };
  const entry = map[status];
  return <Badge className={entry.className}>{entry.label}</Badge>;
}

function avatarUrl(user: AccessRequestUser): string | null {
  if (!user.discord_avatar) return null;
  // Discord CDN convention: cdn.discordapp.com/avatars/{user_id}/{hash}.png
  // If the backend already returns a full URL, use it as-is.
  if (user.discord_avatar.startsWith("http")) return user.discord_avatar;
  return `https://cdn.discordapp.com/avatars/${user.discord_id}/${user.discord_avatar}.png`;
}

export function AccessRequestsPage() {
  const [users, setUsers] = useState<AccessRequestUser[]>([]);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [tab, setTab] = useState<FilterTab>("pending");

  const [approveTarget, setApproveTarget] = useState<AccessRequestUser | null>(null);
  const [approveForm, setApproveForm] = useState<ApproveFormState>({
    mode: "create",
    label: "",
    allowedSymbols: DEFAULT_SYMBOLS,
    apiKeyId: "",
  });
  const [approving, setApproving] = useState(false);

  const [rejectTarget, setRejectTarget] = useState<AccessRequestUser | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [banTarget, setBanTarget] = useState<AccessRequestUser | null>(null);
  const [banReason, setBanReason] = useState("");
  const [banning, setBanning] = useState(false);

  const [plaintextKey, setPlaintextKey] = useState<string | null>(null);

  const refresh = useMemo(
    () => async () => {
      setLoading(true);
      try {
        const [list, keys] = await Promise.all([
          AccessRequests.list(),
          ApiKeys.list().catch(() => [] as ApiKeySummary[]),
        ]);
        setUsers(list);
        setApiKeys(keys);
        setError(null);
      } catch (err) {
        setError(pickError(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    const c: Record<FilterTab, number> = {
      all: users.length,
      pending: 0,
      approved: 0,
      rejected: 0,
      banned: 0,
    };
    for (const u of users) c[u.status] += 1;
    return c;
  }, [users]);

  const filteredUsers = useMemo(() => {
    if (tab === "all") return users;
    return users.filter((u) => u.status === tab);
  }, [users, tab]);

  // Existing keys not yet assigned to any user (best-effort by label match).
  const unassignedKeys = useMemo(() => {
    const usedLabels = new Set(
      users
        .filter((u) => u.has_api_key && u.api_key_label)
        .map((u) => u.api_key_label as string),
    );
    return apiKeys.filter((k) => k.is_active && !usedLabels.has(k.label));
  }, [apiKeys, users]);

  function openApprove(user: AccessRequestUser) {
    setApproveForm({
      mode: "create",
      label: `Public-${user.discord_username}`,
      allowedSymbols: DEFAULT_SYMBOLS,
      apiKeyId: "",
    });
    setApproveTarget(user);
  }

  async function submitApprove(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!approveTarget) return;
    setApproving(true);
    setError(null);
    try {
      let resp;
      if (approveForm.mode === "existing") {
        if (!approveForm.apiKeyId) {
          setError("Pick an existing API key.");
          setApproving(false);
          return;
        }
        resp = await AccessRequests.approve(approveTarget.id, {
          api_key_id: approveForm.apiKeyId,
        });
      } else {
        const symbols = approveForm.allowedSymbols
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (symbols.length === 0) {
          setError("Provide at least one allowed symbol.");
          setApproving(false);
          return;
        }
        resp = await AccessRequests.approve(approveTarget.id, {
          allowed_symbols: symbols,
        });
      }
      setApproveTarget(null);
      if (resp.plaintext_key) {
        setPlaintextKey(resp.plaintext_key);
      } else {
        setInfo(`Approved ${approveTarget.discord_username}.`);
      }
      await refresh();
    } catch (err) {
      setError(pickError(err));
    } finally {
      setApproving(false);
    }
  }

  async function submitReject(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!rejectTarget) return;
    if (rejectReason.trim().length < 10) {
      setError("Rejection reason must be at least 10 characters.");
      return;
    }
    setRejecting(true);
    setError(null);
    try {
      await AccessRequests.reject(rejectTarget.id, rejectReason.trim());
      setRejectTarget(null);
      setRejectReason("");
      setInfo("Request rejected.");
      await refresh();
    } catch (err) {
      setError(pickError(err));
    } finally {
      setRejecting(false);
    }
  }

  async function submitBan(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!banTarget) return;
    if (banReason.trim().length < 10) {
      setError("Ban reason must be at least 10 characters.");
      return;
    }
    setBanning(true);
    setError(null);
    try {
      await AccessRequests.ban(banTarget.id, banReason.trim());
      setBanTarget(null);
      setBanReason("");
      setInfo("User banned. Active sessions revoked.");
      await refresh();
    } catch (err) {
      setError(pickError(err));
    } finally {
      setBanning(false);
    }
  }

  async function revokeSessions(user: AccessRequestUser) {
    if (!confirm(`Revoke all active sessions for ${user.discord_username}?`)) return;
    setError(null);
    try {
      const resp = await AccessRequests.revokeSessions(user.id);
      setInfo(`Revoked ${resp.revoked_count} session${resp.revoked_count === 1 ? "" : "s"}.`);
      await refresh();
    } catch (err) {
      setError(pickError(err));
    }
  }

  async function unban(user: AccessRequestUser) {
    if (!confirm(`Unban ${user.discord_username}? They will need a new API key assigned.`)) return;
    setError(null);
    try {
      const resp = await AccessRequests.approve(user.id, {});
      if (resp.plaintext_key) setPlaintextKey(resp.plaintext_key);
      setInfo(`Unbanned ${user.discord_username}.`);
      await refresh();
    } catch (err) {
      setError(pickError(err));
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text).catch(() => {
      /* no-op */
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Access Requests</h1>
          <p className="text-sm text-muted-foreground">
            Approve or reject Discord-verified users requesting access to the public site.
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {info && !error && (
        <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-300">
          {info}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {TABS.map((t) => {
          const active = tab === t.value;
          return (
            <Button
              key={t.value}
              size="sm"
              variant={active ? "default" : "outline"}
              onClick={() => setTab(t.value)}
            >
              {t.label}
              <span
                className={cn(
                  "ml-1 rounded-full px-1.5 py-0 text-[10px] font-semibold",
                  active ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground",
                )}
              >
                {counts[t.value]}
              </span>
            </Button>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {TABS.find((t) => t.value === tab)?.label ?? "All"} ({filteredUsers.length})
          </CardTitle>
          <CardDescription>
            Total users tracked: {users.length}. Click Discord usernames to open profiles.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Discord</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Guild verified</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead>API key</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredUsers.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No requests in this view yet.
                  </TableCell>
                </TableRow>
              )}
              {filteredUsers.map((user) => {
                const avatar = avatarUrl(user);
                const requestedAt = user.access_request?.requested_at ?? user.created_at;
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <a
                        href={`https://discord.com/users/${user.discord_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-2 hover:underline"
                      >
                        {avatar ? (
                          <img
                            src={avatar}
                            alt={user.discord_username}
                            className="h-7 w-7 rounded-full border border-border"
                          />
                        ) : (
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium uppercase">
                            {user.discord_username.charAt(0)}
                          </div>
                        )}
                        <div className="flex flex-col">
                          <span className="font-medium">{user.discord_username}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {user.discord_id}
                          </span>
                        </div>
                      </a>
                    </TableCell>
                    <TableCell>{statusBadge(user.status)}</TableCell>
                    <TableCell>
                      {user.guild_verified ? (
                        <span className="text-emerald-500">✓</span>
                      ) : (
                        <span className="text-rose-500">✗</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span title={requestedAt}>{formatRelative(requestedAt)}</span>
                    </TableCell>
                    <TableCell>
                      {user.has_api_key ? (
                        <div className="flex flex-col">
                          <span className="text-sm">{user.api_key_label ?? "—"}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {user.api_key_prefix ?? ""}…
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {user.status === "pending" && (
                          <>
                            <Button size="sm" onClick={() => openApprove(user)}>
                              Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setRejectReason("");
                                setRejectTarget(user);
                              }}
                            >
                              Reject
                            </Button>
                          </>
                        )}
                        {user.status === "approved" && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => revokeSessions(user)}
                            >
                              Revoke sessions
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              onClick={() => {
                                setBanReason("");
                                setBanTarget(user);
                              }}
                            >
                              Ban
                            </Button>
                          </>
                        )}
                        {user.status === "rejected" && (
                          <Button size="sm" variant="outline" onClick={() => openApprove(user)}>
                            Re-approve
                          </Button>
                        )}
                        {user.status === "banned" && (
                          <Button size="sm" variant="outline" onClick={() => unban(user)}>
                            Unban
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Approve dialog */}
      <Dialog
        open={approveTarget !== null}
        onOpenChange={(open) => !open && setApproveTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Approve {approveTarget?.discord_username ?? ""}
            </DialogTitle>
            <DialogDescription>
              Choose how this user gets an API key. Auto-create generates a fresh key (shown once).
              Use existing assigns one of your unassigned keys.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitApprove} className="space-y-4">
            <div className="flex gap-3">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  className="h-4 w-4"
                  checked={approveForm.mode === "create"}
                  onChange={() => setApproveForm((p) => ({ ...p, mode: "create" }))}
                />
                Auto-create API key
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  className="h-4 w-4"
                  checked={approveForm.mode === "existing"}
                  onChange={() => setApproveForm((p) => ({ ...p, mode: "existing" }))}
                />
                Use existing API key
              </label>
            </div>

            {approveForm.mode === "create" ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="approve-label">Label</Label>
                  <Input
                    id="approve-label"
                    value={approveForm.label}
                    onChange={(e) => setApproveForm((p) => ({ ...p, label: e.target.value }))}
                    placeholder="Public-username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="approve-symbols">Allowed symbols (comma-separated)</Label>
                  <Input
                    id="approve-symbols"
                    value={approveForm.allowedSymbols}
                    onChange={(e) =>
                      setApproveForm((p) => ({ ...p, allowedSymbols: e.target.value }))
                    }
                    placeholder="SPXW, NDXP"
                    required
                  />
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="approve-key">Existing API key</Label>
                <select
                  id="approve-key"
                  className="flex h-9 w-full rounded-md border border-border bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  value={approveForm.apiKeyId}
                  onChange={(e) =>
                    setApproveForm((p) => ({ ...p, apiKeyId: e.target.value }))
                  }
                  required
                >
                  <option value="">Select a key…</option>
                  {unassignedKeys.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label} ({k.key_prefix}…)
                    </option>
                  ))}
                </select>
                {unassignedKeys.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    No unassigned active keys available. Create one on the API Keys page first.
                  </p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setApproveTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={approving}>
                {approving ? "Approving…" : "Approve"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog
        open={rejectTarget !== null}
        onOpenChange={(open) => !open && setRejectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Reject {rejectTarget?.discord_username ?? ""}
            </DialogTitle>
            <DialogDescription>
              The reason is stored on the request. Minimum 10 characters.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitReject} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="reject-reason">Reason</Label>
              <textarea
                id="reject-reason"
                className="flex min-h-[100px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                required
                minLength={10}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={rejecting}>
                {rejecting ? "Rejecting…" : "Reject"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Ban dialog */}
      <Dialog open={banTarget !== null} onOpenChange={(open) => !open && setBanTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ban {banTarget?.discord_username ?? ""}</DialogTitle>
            <DialogDescription>
              Banning will revoke all active sessions and prevent re-registration. Minimum 10
              characters.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitBan} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="ban-reason">Reason</Label>
              <textarea
                id="ban-reason"
                className="flex min-h-[100px] w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                required
                minLength={10}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setBanTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={banning}>
                {banning ? "Banning…" : "Ban user"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Plaintext key one-time display */}
      <Dialog
        open={plaintextKey !== null}
        onOpenChange={(open) => !open && setPlaintextKey(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save this API key now</DialogTitle>
            <DialogDescription>
              This is the only time the key will be shown. Send it to the user and confirm
              they have stored it. It cannot be recovered later.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200">
            One-time display. Closing this dialog discards the key from memory.
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3 font-mono text-sm break-all">
            {plaintextKey}
          </div>
          <DialogFooter>
            <Button onClick={() => plaintextKey && copy(plaintextKey)}>
              <Copy className="h-4 w-4" /> Copy
            </Button>
            <Button variant="outline" onClick={() => setPlaintextKey(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
