import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import { getStripe, getTierIdFromPriceId } from "@/lib/stripe";
import Stripe from "stripe";

const relevantEvents = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
]);

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const sig = headersList.get("stripe-signature");

  if (!sig) {
    return NextResponse.json(
      { error: "No signature provided" },
      { status: 400 }
    );
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 400 }
    );
  }

  if (!relevantEvents.has(event.type)) {
    return NextResponse.json({ received: true });
  }

  const supabaseAdmin = getSupabaseAdmin();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const organizationId = session.metadata?.organization_id;
        const tierId = session.metadata?.tier_id;

        if (organizationId && tierId) {
          const { error } = await supabaseAdmin
            .from("organizations")
            .update({
              subscription_tier_id: tierId,
              subscription_status: "active",
            })
            .eq("id", organizationId);

          if (error) {
            console.error(`Failed to update org ${organizationId}:`, error);
          } else {
            console.log(`Checkout completed for org ${organizationId}, tier: ${tierId}`);
          }
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const organizationId = subscription.metadata?.organization_id;
        const customerId = subscription.customer as string;

        // Map Stripe subscription status to our status
        let status: "active" | "past_due" | "canceled" | "trialing" = "active";
        if (subscription.status === "past_due") status = "past_due";
        else if (subscription.status === "canceled" || subscription.status === "unpaid") status = "canceled";
        else if (subscription.status === "trialing") status = "trialing";

        const priceId = subscription.items.data[0]?.price?.id;
        const tierId = priceId ? getTierIdFromPriceId(priceId) : null;

        const updateData: Record<string, unknown> = {
          subscription_status: status,
        };

        if (tierId) {
          updateData.subscription_tier_id = tierId;
        }

        if (organizationId) {
          const { error } = await supabaseAdmin
            .from("organizations")
            .update(updateData)
            .eq("id", organizationId);

          if (error) {
            console.error(`Failed to update org ${organizationId}:`, error);
          } else {
            console.log(`Subscription ${event.type} for org ${organizationId}, status: ${status}, tier: ${tierId}`);
          }
        } else {
          // Try to find org by customer ID
          const { data: org, error: findError } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (findError) {
            console.error(`Failed to find org by customer ${customerId}:`, findError);
          } else if (org) {
            const { error } = await supabaseAdmin
              .from("organizations")
              .update(updateData)
              .eq("id", org.id);

            if (error) {
              console.error(`Failed to update org ${org.id}:`, error);
            } else {
              console.log(`Subscription ${event.type} for org ${org.id} (via customer), status: ${status}, tier: ${tierId}`);
            }
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const organizationId = subscription.metadata?.organization_id;
        const customerId = subscription.customer as string;

        if (organizationId) {
          // Downgrade to free tier when subscription is canceled
          const { error } = await supabaseAdmin
            .from("organizations")
            .update({
              subscription_tier_id: "free",
              subscription_status: "canceled",
            })
            .eq("id", organizationId);

          if (error) {
            console.error(`Failed to downgrade org ${organizationId}:`, error);
          } else {
            console.log(`Subscription deleted for org ${organizationId}, downgraded to free`);
          }
        } else {
          // Try to find org by customer ID
          const { data: org, error: findError } = await supabaseAdmin
            .from("organizations")
            .select("id")
            .eq("stripe_customer_id", customerId)
            .single();

          if (findError) {
            console.error(`Failed to find org by customer ${customerId}:`, findError);
          } else if (org) {
            const { error } = await supabaseAdmin
              .from("organizations")
              .update({
                subscription_tier_id: "free",
                subscription_status: "canceled",
              })
              .eq("id", org.id);

            if (error) {
              console.error(`Failed to downgrade org ${org.id}:`, error);
            } else {
              console.log(`Subscription deleted for org ${org.id} (via customer), downgraded to free`);
            }
          }
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        if (customerId) {
          // Update status to active on successful payment
          const { error } = await supabaseAdmin
            .from("organizations")
            .update({ subscription_status: "active" })
            .eq("stripe_customer_id", customerId);

          if (error) {
            console.error(`Failed to update status for customer ${customerId}:`, error);
          } else {
            console.log(`Invoice paid for customer ${customerId}`);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;

        if (customerId) {
          // Update status to past_due on failed payment
          const { error } = await supabaseAdmin
            .from("organizations")
            .update({ subscription_status: "past_due" })
            .eq("stripe_customer_id", customerId);

          if (error) {
            console.error(`Failed to update status for customer ${customerId}:`, error);
          } else {
            console.log(`Invoice payment failed for customer ${customerId}`);
          }
        }
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error processing webhook:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
