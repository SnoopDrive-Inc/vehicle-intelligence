import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getStripe, STRIPE_PRICE_IDS } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const { organizationId, tierId, userId, userEmail } = await request.json();

    if (!organizationId || !tierId || !userId) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Verify the price ID exists
    const priceId = STRIPE_PRICE_IDS[tierId];
    if (!priceId) {
      return NextResponse.json(
        { error: "Invalid tier selected" },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Get or create Stripe customer
    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("stripe_customer_id, name, billing_email")
      .eq("id", organizationId)
      .single();

    if (orgError || !org) {
      return NextResponse.json(
        { error: "Organization not found" },
        { status: 404 }
      );
    }

    let customerId = org.stripe_customer_id;

    if (!customerId) {
      // Create a new Stripe customer
      const customer = await getStripe().customers.create({
        email: org.billing_email || userEmail,
        name: org.name,
        metadata: {
          organization_id: organizationId,
          user_id: userId,
        },
      });

      customerId = customer.id;

      // Save the customer ID to the organization
      await supabaseAdmin
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", organizationId);
    }

    // Create checkout session
    const session = await getStripe().checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?success=true&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing?canceled=true`,
      metadata: {
        organization_id: organizationId,
        tier_id: tierId,
      },
      subscription_data: {
        metadata: {
          organization_id: organizationId,
          tier_id: tierId,
        },
      },
    });

    return NextResponse.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
