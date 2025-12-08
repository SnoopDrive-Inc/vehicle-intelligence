"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase";

function AuthCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    console.log("[Auth Callback] Page loaded, URL:", window.location.href);

    const errorParam = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (errorParam) {
      setError(errorDescription || errorParam);
      return;
    }

    // Use the singleton client - it has the PKCE code verifier stored
    // The detectSessionInUrl option will automatically exchange the code
    const supabase = createClient();

    // Listen for auth state changes - this fires when the code is exchanged
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log("[Auth Callback] Auth state change:", event, !!session);

      if (event === "SIGNED_IN" && session) {
        console.log("[Auth Callback] User signed in, redirecting to home...");
        // Use window.location for a full page reload to ensure clean state
        window.location.href = "/";
      }
    });

    // Also check if session already exists (in case event already fired)
    supabase.auth.getSession().then(({ data: { session } }) => {
      console.log("[Auth Callback] Session check:", !!session);
      if (session) {
        console.log("[Auth Callback] Already have session, redirecting...");
        window.location.href = "/";
      }
    });

    // Set a timeout to show error if nothing happens
    const timeout = setTimeout(() => {
      // Check one more time before showing error
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          window.location.href = "/";
        } else {
          setError("Authentication timed out. Please try again.");
        }
      });
    }, 10000);

    return () => {
      subscription.unsubscribe();
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
