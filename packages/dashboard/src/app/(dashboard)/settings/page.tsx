"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "sonner";
import {
  Building2,
  CreditCard,
  Globe,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface Organization {
  id: string;
  name: string;
  slug: string;
  subscription_tier: string;
  subscription_status: string;
  created_at: string;
  owner_user_id: string;
}

interface Tier {
  id: string;
  name: string;
  monthly_price_cents: number;
  monthly_token_limit: number | null;
  rate_limit_per_minute: number;
}

interface Member {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  profile?: {
    full_name: string | null;
    email: string | null;
    avatar_url: string | null;
  };
}

interface Invite {
  id: string;
  email: string;
  role: string;
  expires_at: string;
  accepted_at: string | null;
}

interface EmailDomain {
  id: string;
  domain: string;
  is_verified: boolean;
  created_at: string;
}

export default function SettingsPage() {
  const { user, organizationId, currentOrganization } = useAuth();
  const [org, setOrg] = useState<Organization | null>(null);
  const [tier, setTier] = useState<Tier | null>(null);
  const [userRole, setUserRole] = useState<"owner" | "admin" | "member">("member");
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orgName, setOrgName] = useState("");

  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "member">("member");
  const [inviting, setInviting] = useState(false);

  const [emailDomains, setEmailDomains] = useState<EmailDomain[]>([]);
  const [domainDialogOpen, setDomainDialogOpen] = useState(false);
  const [newDomain, setNewDomain] = useState("");
  const [addingDomain, setAddingDomain] = useState(false);

  // Load organization details when organizationId changes
  useEffect(() => {
    if (organizationId) {
      loadOrgDetails(organizationId);
    } else {
      setLoading(false);
    }
  }, [organizationId]);

  async function loadOrgDetails(orgId: string) {
    setLoading(true);
    const supabase = createClient();

    // Fetch organization with tier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: orgData, error: orgError } = await (supabase.from("organizations") as any)
      .select("*, subscription_tiers(*)")
      .eq("id", orgId)
      .single();

    if (orgError || !orgData) {
      console.error("Error fetching organization:", orgError);
      setLoading(false);
      return;
    }

    const fetchedOrg = orgData as Organization & { subscription_tiers: Tier | null };
    setOrg(fetchedOrg);
    setOrgName(fetchedOrg.name);
    setTier(fetchedOrg.subscription_tiers);

    // Determine user's role
    const currentUserId = user?.id;
    if (fetchedOrg.owner_user_id === currentUserId) {
      setUserRole("owner");
    } else {
      // Check if user is a member
      const { data: membership } = await supabase
        .from("organization_members")
        .select("role")
        .eq("organization_id", orgId)
        .eq("user_id", currentUserId)
        .single();

      if (membership) {
        setUserRole(membership.role === "admin" ? "admin" : "member");
      } else {
        setUserRole("member");
      }
    }

    const currentUserRole = fetchedOrg.owner_user_id === currentUserId ? "owner" : userRole;

    // Fetch members
    const { data: membersData } = await supabase
      .from("organization_members")
      .select("id, user_id, role, created_at")
      .eq("organization_id", orgId);

    // Fetch user profiles for members
    if (membersData && membersData.length > 0) {
      const userIds = membersData.map((m) => m.user_id);
      const { data: profilesData } = await supabase
        .from("user_profiles")
        .select("id, full_name, email, avatar_url")
        .in("id", userIds);

      const profileMap = new Map(profilesData?.map((p) => [p.id, p]) || []);

      const membersWithProfiles = membersData.map((m) => ({
        ...m,
        profile: profileMap.get(m.user_id) || undefined,
      }));
      setMembers(membersWithProfiles);
    } else {
      setMembers([]);
    }

    // Fetch invites (only if user is owner or admin)
    const canFetchSensitive = currentUserRole === "owner" || currentUserRole === "admin";
    if (canFetchSensitive) {
      const { data: invitesData } = await supabase
        .from("user_invites")
        .select("id, email, role, expires_at, accepted_at")
        .eq("organization_id", orgId)
        .is("accepted_at", null)
        .gt("expires_at", new Date().toISOString());

      setInvites(invitesData || []);

      // Fetch email domains
      const { data: domainsData } = await supabase
        .from("organization_email_domains")
        .select("id, domain, is_verified, created_at")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true });

      setEmailDomains(domainsData || []);
    } else {
      setInvites([]);
      setEmailDomains([]);
    }

    setLoading(false);
  }

  // Get owner profile for the current org
  const [ownerProfile, setOwnerProfile] = useState<{ full_name: string | null; email: string | null } | null>(null);

  useEffect(() => {
    async function loadOwnerProfile() {
      if (!org) return;
      const supabase = createClient();
      const { data } = await supabase
        .from("user_profiles")
        .select("full_name, email")
        .eq("id", org.owner_user_id)
        .single();
      setOwnerProfile(data);
    }
    loadOwnerProfile();
  }, [org]);

  async function saveSettings() {
    if (!org || !orgName.trim()) return;

    setSaving(true);
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("organizations") as any)
      .update({ name: orgName })
      .eq("id", org.id);

    // Update local state
    setOrg((prev) => (prev ? { ...prev, name: orgName } : prev));

    setSaving(false);
    toast.success("Settings saved");
  }

  function reloadCurrentOrg() {
    if (organizationId) {
      loadOrgDetails(organizationId);
    }
  }

  function generateToken(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleInvite() {
    if (!org || !inviteEmail.trim() || !user) return;

    setInviting(true);
    try {
      const supabase = createClient();
      const token = generateToken();
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      const { error } = await supabase.from("user_invites").insert({
        email: inviteEmail.trim().toLowerCase(),
        organization_id: org.id,
        role: inviteRole,
        invited_by: user.id,
        token,
        expires_at: expiresAt.toISOString(),
      });

      if (error) {
        console.error("Error creating invite:", error);
        toast.error("Failed to create invite: " + error.message);
        return;
      }

      const inviteLink = `${window.location.origin}/invite/${token}`;
      await navigator.clipboard.writeText(inviteLink);
      toast.success("Invite link copied to clipboard!");

      setInviteDialogOpen(false);
      setInviteEmail("");
      setInviteRole("member");
      reloadCurrentOrg();
    } catch (err) {
      console.error("Error inviting:", err);
      toast.error("Failed to create invite");
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberId: string) {
    const supabase = createClient();
    await supabase.from("organization_members").delete().eq("id", memberId);
    reloadCurrentOrg();
    toast.success("Member removed");
  }

  async function handleRevokeInvite(inviteId: string) {
    const supabase = createClient();
    await supabase.from("user_invites").delete().eq("id", inviteId);
    reloadCurrentOrg();
    toast.success("Invite revoked");
  }

  async function handleChangeRole(memberId: string, newRole: string) {
    const supabase = createClient();
    await supabase
      .from("organization_members")
      .update({ role: newRole })
      .eq("id", memberId);
    reloadCurrentOrg();
    toast.success("Role updated");
  }

  async function handleAddDomain() {
    if (!org || !newDomain.trim() || !user) return;

    // Basic domain validation
    const domain = newDomain.trim().toLowerCase();
    if (!domain.includes(".") || domain.includes("@")) {
      toast.error("Please enter a valid domain (e.g., example.com)");
      return;
    }

    setAddingDomain(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.from("organization_email_domains").insert({
        organization_id: org.id,
        domain,
        created_by: user.id,
        is_verified: true, // Auto-verify for now, can add verification later
      });

      if (error) {
        if (error.code === "23505") {
          toast.error("This domain is already registered to an organization");
        } else {
          toast.error("Failed to add domain: " + error.message);
        }
        return;
      }

      toast.success("Domain added successfully");
      setDomainDialogOpen(false);
      setNewDomain("");
      reloadCurrentOrg();
    } catch (err) {
      console.error("Error adding domain:", err);
      toast.error("Failed to add domain");
    } finally {
      setAddingDomain(false);
    }
  }

  async function handleRemoveDomain(domainId: string) {
    const supabase = createClient();
    await supabase.from("organization_email_domains").delete().eq("id", domainId);
    reloadCurrentOrg();
    toast.success("Domain removed");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-muted-foreground">
            {user ? "You don't have access to any organizations" : "Sign in to view your organization settings"}
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-10">
            <Settings2 className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              {user ? "Contact an administrator to get access to an organization" : "Sign in to access your settings"}
            </p>
            {!user && (
              <Button asChild>
                <a href="/login">Sign In</a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const canEdit = userRole === "owner" || userRole === "admin";

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your organization settings and team members
        </p>
      </div>

      <Tabs defaultValue="organization" className="space-y-4">
        <TabsList>
          <TabsTrigger value="organization">
            <Building2 className="mr-2 h-4 w-4" />
            Organization
          </TabsTrigger>
          <TabsTrigger value="team">
            <Users className="mr-2 h-4 w-4" />
            Team
          </TabsTrigger>
        </TabsList>

        {/* Organization Tab */}
        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization Details</CardTitle>
              <CardDescription>
                {canEdit ? "Update your organization information" : "View organization information"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Organization Name</Label>
                <Input
                  id="name"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  disabled={!canEdit}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="slug">Slug</Label>
                <Input id="slug" value={org.slug} disabled />
                <p className="text-xs text-muted-foreground">
                  The slug cannot be changed
                </p>
              </div>
              <div className="space-y-2">
                <Label>Your Role</Label>
                <div className="text-sm">
                  <Badge variant={userRole === "owner" ? "default" : userRole === "admin" ? "default" : "secondary"}>
                    {userRole}
                  </Badge>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Created</Label>
                <p className="text-sm text-muted-foreground">
                  {new Date(org.created_at).toLocaleDateString()}
                </p>
              </div>
              {canEdit && (
                <Button onClick={saveSettings} disabled={saving}>
                  {saving ? "Saving..." : "Save Changes"}
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Email Domains - in Organization tab */}
          {canEdit && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Globe className="h-5 w-5" />
                      Email Domains
                    </CardTitle>
                    <CardDescription>
                      Users signing up with these email domains will automatically join your organization
                    </CardDescription>
                  </div>
                  <Dialog open={domainDialogOpen} onOpenChange={setDomainDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <Plus className="mr-2 h-4 w-4" />
                        Add Domain
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Add Email Domain</DialogTitle>
                        <DialogDescription>
                          Add a domain to automatically add users to your organization when they sign up
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="space-y-2">
                          <Label htmlFor="domain">Domain</Label>
                          <Input
                            id="domain"
                            placeholder="example.com"
                            value={newDomain}
                            onChange={(e) => setNewDomain(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Enter the domain without @ or https://
                          </p>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDomainDialogOpen(false)}>
                          Cancel
                        </Button>
                        <Button onClick={handleAddDomain} disabled={addingDomain || !newDomain.trim()}>
                          {addingDomain ? "Adding..." : "Add Domain"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent>
                {emailDomains.length > 0 ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Domain</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Added</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {emailDomains.map((domain) => (
                        <TableRow key={domain.id}>
                          <TableCell className="font-medium">{domain.domain}</TableCell>
                          <TableCell>
                            <Badge variant={domain.is_verified ? "default" : "secondary"}>
                              {domain.is_verified ? "Verified" : "Pending"}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {new Date(domain.created_at).toLocaleDateString()}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive"
                              onClick={() => handleRemoveDomain(domain.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Globe className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No domains configured. Add a domain to enable automatic team membership.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Subscription Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Subscription
              </CardTitle>
              <CardDescription>
                Manage your subscription and billing
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Current Plan</span>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{tier?.name || "Free"}</span>
                  <Badge variant={org.subscription_status === "active" ? "default" : "secondary"}>
                    {org.subscription_status}
                  </Badge>
                </div>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Monthly Limit</span>
                <span>{tier?.monthly_token_limit?.toLocaleString() || "1,000"} requests</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Rate Limit</span>
                <span>{tier?.rate_limit_per_minute || 10} req/min</span>
              </div>
              <Separator />
              <div className="flex items-center justify-between py-2">
                <span className="text-muted-foreground">Price</span>
                <span>
                  {tier?.monthly_price_cents
                    ? `$${(tier.monthly_price_cents / 100).toFixed(0)}/month`
                    : "Free"}
                </span>
              </div>
              <div className="pt-4">
                <Button asChild className="w-full">
                  <Link href="/billing">Manage Billing</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Team Members</CardTitle>
                  <CardDescription>
                    {canEdit ? "Manage who has access to your organization" : "View team members"}
                  </CardDescription>
                </div>
                {canEdit && (
                  <Dialog open={inviteDialogOpen} onOpenChange={setInviteDialogOpen}>
                    <DialogTrigger asChild>
                      <Button>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Invite Member
                      </Button>
                    </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite Team Member</DialogTitle>
                      <DialogDescription>
                        Send an invitation link to add a new team member
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="email">Email Address</Label>
                        <Input
                          id="email"
                          type="email"
                          placeholder="colleague@example.com"
                          value={inviteEmail}
                          onChange={(e) => setInviteEmail(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="role">Role</Label>
                        <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as "admin" | "member")}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="member">Member - Can view and use API keys</SelectItem>
                            <SelectItem value="admin">Admin - Can manage keys and members</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setInviteDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleInvite} disabled={inviting || !inviteEmail.trim()}>
                        {inviting ? "Sending..." : "Send Invite"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Owner */}
                  <TableRow>
                    <TableCell className="font-medium">
                      {ownerProfile?.full_name || ownerProfile?.email || org.owner_user_id.slice(0, 8) + "..."}
                      {org.owner_user_id === user?.id && (
                        <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge>Owner</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">Active</Badge>
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground text-sm">
                      -
                    </TableCell>
                  </TableRow>

                  {/* Members */}
                  {members.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {member.profile?.full_name || member.profile?.email || member.user_id.slice(0, 8) + "..."}
                        {member.user_id === user?.id && (
                          <span className="ml-2 text-xs text-muted-foreground">(you)</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.role === "admin" ? "default" : "secondary"}>
                          {member.role}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">Active</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {canEdit ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Actions</DropdownMenuLabel>
                              <DropdownMenuItem onClick={() => handleChangeRole(member.id, member.role === "admin" ? "member" : "admin")}>
                                Change to {member.role === "admin" ? "Member" : "Admin"}
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-destructive"
                                onClick={() => handleRemoveMember(member.id)}
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Remove
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}

                  {/* Pending Invites */}
                  {invites.map((invite) => (
                    <TableRow key={invite.id}>
                      <TableCell className="font-medium">{invite.email}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{invite.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">Pending</Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => handleRevokeInvite(invite.id)}
                        >
                          Revoke
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {members.length === 0 && invites.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <Users className="h-8 w-8 text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No team members yet. Invite someone to collaborate!
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>
    </div>
  );
}
