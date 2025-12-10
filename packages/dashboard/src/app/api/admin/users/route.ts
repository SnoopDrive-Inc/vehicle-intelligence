import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// This endpoint requires the service role key to fetch user data
export async function GET() {
  try {
    // First verify the requesting user is an admin
    const serverSupabase = await createServerClient();
    const { data: { user } } = await serverSupabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin
    const { data: adminData } = await serverSupabase
      .from("admin_users")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!adminData) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Use service role client to fetch all users
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      // Fallback: return empty user metadata if no service role key
      return NextResponse.json({ users: {} });
    }

    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      { auth: { persistSession: false } }
    );

    // Fetch all users using admin API
    const { data: { users }, error } = await adminSupabase.auth.admin.listUsers();

    if (error) {
      console.error("Error fetching users:", error);
      return NextResponse.json({ users: {} });
    }

    // Create a map of user_id to user metadata
    const userMap: Record<string, {
      email: string;
      name: string;
      avatar_url: string | null;
    }> = {};

    users.forEach((u) => {
      userMap[u.id] = {
        email: u.email || "",
        name: u.user_metadata?.full_name || u.user_metadata?.name || u.email?.split("@")[0] || "Unknown",
        avatar_url: u.user_metadata?.avatar_url || null,
      };
    });

    return NextResponse.json({ users: userMap });
  } catch (error) {
    console.error("Error in admin users API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
