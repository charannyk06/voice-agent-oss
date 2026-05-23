import Stripe from "stripe";
import { ApiError } from "./api";

export function getStripeClient() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new ApiError(500, "Stripe secret key is not configured");
  }

  return new Stripe(secretKey, {
    apiVersion: "2026-04-22.dahlia",
  });
}

export function getStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    throw new ApiError(500, "Stripe webhook secret is not configured");
  }
  return secret;
}
