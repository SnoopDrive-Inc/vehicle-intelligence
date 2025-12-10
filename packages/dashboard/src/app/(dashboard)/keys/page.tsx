"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import { toast } from "sonner";
import {
  Copy,
  Key,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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

interface ApiKey {
  id: string;
  name: string;
  key_prefix: string;
  environment: "live" | "test";
  is_active: boolean;
  created_at: string;
  last_used_at: string | null;
}

export default function KeysPage() {
  const { organizationId } = useAuth();
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newKeyEnv, setNewKeyEnv] = useState<"live" | "test">("test");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [keyDialogOpen, setKeyDialogOpen] = useState(false);

  useEffect(() => {
    if (organizationId) {
      loadKeys();
    }
  }, [organizationId]);

  async function loadKeys() {
    if (!organizationId) {
      setLoading(false);
      return;
    }

    const supabase = createClient();
    const { data } = await supabase
      .from("api_keys")
      .select("id, name, key_prefix, environment, is_active, created_at, last_used_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    setKeys((data as ApiKey[]) || []);
    setLoading(false);
  }

  async function createKey() {
    if (!newKeyName.trim() || !organizationId) return;

    setCreating(true);
    const supabase = createClient();

    const prefix = `ci_${newKeyEnv}_`;
    const randomPart = Array.from(crypto.getRandomValues(new Uint8Array(24)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const fullKey = prefix + randomPart;

    const encoder = new TextEncoder();
    const data = encoder.encode(fullKey);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const keyHash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from("api_keys") as any).insert({
      organization_id: organizationId,
      name: newKeyName,
      key_hash: keyHash,
      key_prefix: fullKey.slice(0, 12) + "...",
      environment: newKeyEnv,
    });

    if (error) {
      console.error("Error creating key:", error);
      toast.error("Failed to create API key");
      setCreating(false);
      return;
    }

    setNewKey(fullKey);
    setNewKeyName("");
    setCreating(false);
    setCreateDialogOpen(false);
    setKeyDialogOpen(true);
    loadKeys();
    toast.success("API key created successfully");
  }

  async function revokeKey(keyId: string) {
    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from("api_keys") as any).update({ is_active: false }).eq("id", keyId);
    loadKeys();
    toast.success("API key revoked");
  }

  function copyKey() {
    if (newKey) {
      navigator.clipboard.writeText(newKey);
      toast.success("Copied to clipboard");
    }
  }

  function copyKeyPrefix(prefix: string) {
    navigator.clipboard.writeText(prefix);
    toast.success("Copied to clipboard");
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <Card>
          <CardContent className="p-0">
            <div className="space-y-4 p-6">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* New Key Created Dialog */}
      <Dialog open={keyDialogOpen} onOpenChange={setKeyDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>API Key Created</DialogTitle>
            <DialogDescription>
              Copy your API key now. You won't be able to see it again!
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg bg-muted p-4 font-mono text-sm break-all">
            {newKey}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setKeyDialogOpen(false)}>
              Done
            </Button>
            <Button onClick={copyKey}>
              <Copy className="mr-2 h-4 w-4" />
              Copy to Clipboard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground">
            Manage your API keys for accessing the Car Intel API
          </p>
        </div>

        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 h-4 w-4" />
              Create API Key
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New API Key</DialogTitle>
              <DialogDescription>
                Enter a name for your new API key. You'll be able to copy the key after creation.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Key Name</Label>
                <Input
                  id="name"
                  placeholder="e.g., Production, Development"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="environment">Environment</Label>
                <Select value={newKeyEnv} onValueChange={(v) => setNewKeyEnv(v as "live" | "test")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="test">Test</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={createKey} disabled={creating || !newKeyName.trim()}>
                {creating ? "Creating..." : "Create API Key"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Keys Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Your API Keys
          </CardTitle>
          <CardDescription>
            {keys.length === 0
              ? "No API keys yet. Create one to get started."
              : `${keys.filter((k) => k.is_active).length} active key${keys.filter((k) => k.is_active).length !== 1 ? "s" : ""}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {keys.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Key className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-1">No API keys</h3>
              <p className="text-muted-foreground mb-4">
                Get started by creating your first API key
              </p>
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create API Key
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Environment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keys.map((key) => (
                  <TableRow key={key.id} className={!key.is_active ? "opacity-50" : ""}>
                    <TableCell className="font-medium">{key.name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <code className="text-sm">{key.key_prefix}</code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0"
                          onClick={() => copyKeyPrefix(key.key_prefix)}
                        >
                          <Copy className="h-3 w-3" />
                        </Button>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.environment === "live" ? "default" : "secondary"}>
                        {key.environment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={key.is_active ? "default" : "destructive"}>
                        {key.is_active ? "Active" : "Revoked"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(key.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {key.last_used_at
                        ? new Date(key.last_used_at).toLocaleDateString()
                        : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => copyKeyPrefix(key.key_prefix)}>
                            <Copy className="mr-2 h-4 w-4" />
                            Copy Prefix
                          </DropdownMenuItem>
                          {key.is_active && (
                            <DropdownMenuItem
                              className="text-destructive"
                              onClick={() => revokeKey(key.id)}
                            >
                              <Trash2 className="mr-2 h-4 w-4" />
                              Revoke Key
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
