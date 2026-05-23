import type Stripe from "stripe";
import { ApiError } from "./api";

export function getStripeWebhookSecret(env?: { STRIPE_WEBHOOK_SECRET?: string }) {
  const secret = (env ?? process.env).STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError(500, "Stripe webhook secret is not configured");
  }
  return secret;
}

export function getStripeSignatureHeader(headers: Pick<Headers, "get">) {
  const signature = headers.get("stripe-signature");
  if (!signature) {
    throw new ApiError(400, "Missing Stripe signature");
  }
  return signature;
}

type StripeWebhookVerifier = {
  webhooks: {
    constructEvent(rawBody: string, signature: string, secret: string): unknown;
  };
};

export function constructStripeWebhookEvent(
  stripe: StripeWebhookVerifier,
  rawBody: string,
  signature: string,
  webhookSecret: string,
) {
  try {
    return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) as Stripe.Event;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook signature";
    throw new ApiError(400, message);
  }
}
