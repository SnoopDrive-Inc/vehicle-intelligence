import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const { organizationId } = await request.json();

    if (!organizationId) {
      return NextResponse.json(
        { error: "Missing organization ID" },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Get the organization's Stripe customer ID
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", organizationId)
      .single();

    if (orgError || !org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    if (!org.stripe_customer_id) {
      return NextResponse.json(
        { error: "No Stripe customer found for this organization" },
        { status: 400 }
      );
    }

    // Create a billing portal session
    const session = await getStripe().billingPortal.sessions.create({
      customer: org.stripe_customer_id,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    console.error("Error creating portal session:", error);
    return NextResponse.json(
      { error: "Failed to create portal session" },
      { status: 500 }
    );
  }
}
