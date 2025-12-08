"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[Auth Callback] Page loaded, URL:", window.location.href);

    // Create a fresh Supabase client for the callback to ensure detectSessionInUrl works
    // Don't use the singleton - we need a fresh client that will detect the URL params
    const supabase = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: true,
          flowType: "pkce",
        },
      }
    );

    async function handleCallback() {
      const code = searchParams.get("code");
      const errorParam = searchParams.get("error");
      const errorDescription = searchParams.get("error_description");

      console.log("[Auth Callback] Params - code:", !!code, "error:", errorParam);

      if (errorParam) {
        setError(errorDescription || errorParam);
        return;
      }

      if (code) {
        // Explicitly exchange the code for a session
        console.log("[Auth Callback] Exchanging code for session...");
        const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

        if (exchangeError) {
          console.error("[Auth Callback] Code exchange error:", exchangeError);
          setError(exchangeError.message);
          return;
        }

        if (data.session) {
          console.log("[Auth Callback] Session obtained, redirecting...");
          // Give a moment for the session to be stored
          await new Promise(resolve => setTimeout(resolve, 100));
          router.push("/");
          return;
        }
      }

      // Check if already signed in
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      console.log("[Auth Callback] Session check:", !!session, sessionError?.message);

      if (session) {
        router.push("/");
      } else if (!code) {
        setError("No authorization code received. Please try logging in again.");
      }
    }

    handleCallback();

    // Set a timeout to show error if nothing happens
    const timeout = setTimeout(() => {
      setError("Authentication timed out. Please try again.");
    }, 15000);

    return () => {
      clearTimeout(timeout);
    };
  }, [router, searchParams]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="text-center">
          <h1 className="text-xl font-bold text-red-500 mb-2">Authentication Error</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={() => router.push("/login")}
            className="px-4 py-2 bg-gray-800 rounded-lg hover:bg-gray-700"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
        <p className="text-gray-400">Completing sign in...</p>
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-[#0a0a0a]">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-gray-400">Loading...</p>
          </div>
        </div>
      }
    >
      <AuthCallbackContent />
    </Suspense>
  );
}
