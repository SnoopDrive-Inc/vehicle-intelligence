"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase";
import { usePathname, useRouter } from "next/navigation";

interface AuthContextType {
  user: User | null;
  organizationId: string | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  organizationId: null,
  loading: true,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

const publicPaths = ["/login", "/auth/callback"];

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  async function ensureOrganization(currentUser: User): Promise<string | null> {
    try {
      const supabase = createClient();

      // Check if user already has an organization
      const { data: existingOrg, error: fetchError } = await supabase
        .from("organizations")
        .select("id")
        .eq("owner_user_id", currentUser.id)
        .maybeSingle();

      if (fetchError) {
        console.error("Error fetching organization:", fetchError);
        return null;
      }

      if (existingOrg) {
        return existingOrg.id;
      }

      // Create a new organization for the user
      const userName = currentUser.user_metadata?.full_name
        || currentUser.user_metadata?.name
        || currentUser.email?.split("@")[0]
        || "My Organization";

      const slug = `${userName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${Date.now()}`;

      const { data: newOrg, error: insertError } = await supabase
        .from("organizations")
        .insert({
          name: `${userName}'s Organization`,
          slug,
          owner_user_id: currentUser.id,
          subscription_tier: "free",
          subscription_status: "active",
        })
        .select("id")
        .single();

      if (insertError) {
        console.error("Error creating organization:", insertError);
        return null;
      }

      return newOrg.id;
    } catch (err) {
      console.error("Unexpected error in ensureOrganization:", err);
      return null;
    }
  }

  useEffect(() => {
    console.log("[AuthProvider] useEffect starting");
    let supabase;
    try {
      supabase = createClient();
      console.log("[AuthProvider] Supabase client created");
    } catch (err) {
      console.error("[AuthProvider] Failed to create Supabase client:", err);
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      console.log("[AuthProvider] Got session:", !!session?.user);
      setUser(session?.user ?? null);

      if (session?.user) {
        const orgId = await ensureOrganization(session.user);
        console.log("[AuthProvider] Got org ID:", orgId);
        setOrganizationId(orgId);
      }

      setLoading(false);
      console.log("[AuthProvider] Loading set to false");

      // Redirect if not authenticated and not on public path
      if (!session?.user && !publicPaths.includes(pathname)) {
        router.push("/login");
      }
    }).catch((err) => {
      console.error("[AuthProvider] Error getting session:", err);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setUser(session?.user ?? null);

      if (session?.user) {
        const orgId = await ensureOrganization(session.user);
        setOrganizationId(orgId);
      } else {
        setOrganizationId(null);
      }

      if (!session?.user && !publicPaths.includes(pathname)) {
        router.push("/login");
      }
    });

    return () => subscription.unsubscribe();
  }, [pathname, router]);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setOrganizationId(null);
    router.push("/login");
  }

  return (
    <AuthContext.Provider value={{ user, organizationId, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
