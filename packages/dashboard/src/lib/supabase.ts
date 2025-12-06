import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  console.log("[Supabase] URL:", url);
  console.log("[Supabase] Key exists:", !!key, key?.substring(0, 20) + "...");

  if (!url || !key) {
    console.error("Missing Supabase env vars:", { url: !!url, key: !!key });
    throw new Error("Missing Supabase configuration");
  }

  return createBrowserClient(url, key);
}
