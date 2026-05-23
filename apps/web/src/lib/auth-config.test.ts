import assert from "node:assert/strict";
import test from "node:test";
import { getClerkConfigStatus, isAllowedClerkPublishableKey, isUsableClerkConfigValue } from "./auth-config";

function clerkPublishableKey(kind: "test" | "live", frontendHost: string) {
  const encoded = Buffer.from(`${frontendHost}$`, "utf8").toString("base64url");
  return `pk_${kind}_${encoded}`;
}

test("isUsableClerkConfigValue rejects placeholders", () => {
  assert.equal(isUsableClerkConfigValue(undefined), false);
  assert.equal(isUsableClerkConfigValue("pk_test_replace_me"), false);
  assert.equal(isUsableClerkConfigValue("replace-with-clerk-publishable-key"), false);
  assert.equal(isUsableClerkConfigValue(`pk_${"test"}_realistic_value`), true);
});

test("isAllowedClerkPublishableKey rejects stale product frontend hosts", () => {
  assert.equal(isAllowedClerkPublishableKey(clerkPublishableKey("live", "clerk.voice-agent.example.com")), true);
  assert.equal(isAllowedClerkPublishableKey(clerkPublishableKey("live", `clerk.${"con"}ductross.com`)), false);
  assert.equal(isAllowedClerkPublishableKey(clerkPublishableKey("live", `accounts.${"con"}ductross.com`)), false);
});

test("getClerkConfigStatus requires usable Clerk keys", () => {
  const testPublishableKey = `pk_${"test"}_realistic_value`;
  const testSecretKey = `sk_${"test"}_realistic_value`;
  const livePublishableKey = `pk_${"live"}_realistic_value`;
  const liveSecretKey = `sk_${"live"}_realistic_value`;

  assert.deepEqual(getClerkConfigStatus({}), {
    publishableKeyConfigured: false,
    secretKeyConfigured: false,
    configured: false,
  });

  assert.deepEqual(getClerkConfigStatus({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_replace_me",
    CLERK_SECRET_KEY: "replace_with_clerk_secret_key",
  }), {
    publishableKeyConfigured: false,
    secretKeyConfigured: false,
    configured: false,
  });

  assert.deepEqual(getClerkConfigStatus({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: testPublishableKey,
    CLERK_SECRET_KEY: "clerk_secret_realistic_value",
  }), {
    publishableKeyConfigured: true,
    secretKeyConfigured: true,
    configured: true,
  });

  assert.deepEqual(getClerkConfigStatus({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: testPublishableKey,
    CLERK_SECRET_KEY: testSecretKey,
    VERCEL_ENV: "production",
  }), {
    publishableKeyConfigured: true,
    secretKeyConfigured: true,
    configured: false,
  });

  assert.deepEqual(getClerkConfigStatus({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: livePublishableKey,
    CLERK_SECRET_KEY: liveSecretKey,
    VERCEL_ENV: "production",
  }), {
    publishableKeyConfigured: true,
    secretKeyConfigured: true,
    configured: true,
  });

  assert.deepEqual(getClerkConfigStatus({
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: clerkPublishableKey("live", `clerk.${"con"}ductross.com`),
    CLERK_SECRET_KEY: liveSecretKey,
    VERCEL_ENV: "production",
  }), {
    publishableKeyConfigured: false,
    secretKeyConfigured: true,
    configured: false,
  });
});
