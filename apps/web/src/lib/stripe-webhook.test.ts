import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "./api";
import {
  constructStripeWebhookEvent,
  getStripeSignatureHeader,
  getStripeWebhookSecret,
} from "./stripe-webhook";

test("getStripeWebhookSecret fails closed when the webhook secret is missing", () => {
  assert.throws(
    () => getStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: undefined }),
    (error) => error instanceof ApiError && error.status === 500,
  );
  assert.equal(getStripeWebhookSecret({ STRIPE_WEBHOOK_SECRET: "test-webhook-secret" }), "test-webhook-secret");
});

test("getStripeSignatureHeader requires Stripe's signature header", () => {
  assert.throws(
    () => getStripeSignatureHeader(new Headers()),
    (error) => error instanceof ApiError && error.status === 400,
  );

  const headers = new Headers({ "stripe-signature": "t=1,v1=sig" });
  assert.equal(getStripeSignatureHeader(headers), "t=1,v1=sig");
});

test("constructStripeWebhookEvent converts signature verification failures into 400s", () => {
  const event = { id: "evt_test", type: "checkout.session.completed" };
  const okStripe = {
    webhooks: {
      constructEvent(rawBody: string, signature: string, secret: string) {
        assert.equal(rawBody, "{}");
        assert.equal(signature, "sig");
        assert.equal(secret, "test-webhook-secret");
        return event;
      },
    },
  };

  assert.equal(
    constructStripeWebhookEvent(okStripe, "{}", "sig", "test-webhook-secret"),
    event,
  );

  const failingStripe = {
    webhooks: {
      constructEvent() {
        throw new Error("bad signature");
      },
    },
  };

  assert.throws(
    () => constructStripeWebhookEvent(failingStripe, "{}", "bad", "test-webhook-secret"),
    (error) => error instanceof ApiError && error.status === 400,
  );
});
