import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeContactDetail,
  normalizePastCall,
  normalizeSettingsStatus,
  normalizeWsCallSession,
} from "./normalize";

test("normalizePastCall always returns an actions array", () => {
  const call = normalizePastCall({
    id: "call_123",
    contactName: "Jane",
    actions: null,
  });

  assert.deepEqual(call.actions, []);
  assert.equal(call.contactName, "Jane");
});

test("normalizeWsCallSession guards transcript and actions", () => {
  const call = normalizeWsCallSession({
    id: "live_123",
    contactName: "Raj",
    transcript: undefined,
    actions: "bad-data",
  });

  assert.deepEqual(call.transcript, []);
  assert.deepEqual(call.actions, []);
  assert.equal(call.contactName, "Raj");
});

test("normalizeContactDetail guards nested memories and calls", () => {
  const contact = normalizeContactDetail({
    id: "contact_123",
    name: "Avery",
    memories: "not-an-array",
    calls: null,
  });

  assert.deepEqual(contact.memories, []);
  assert.deepEqual(contact.calls, []);
  assert.equal(contact.name, "Avery");
});

test("normalizeSettingsStatus always returns providers and security defaults", () => {
  const status = normalizeSettingsStatus({});

  assert.deepEqual(status.providers, []);
  assert.equal(status.telephonyProvider, "twilio");
  assert.equal(status.telephony, null);
  assert.deepEqual(status.security, {
    authProvider: "unknown",
    clerkConfigured: false,
  });
  assert.equal(status.databaseMode, "unknown");
});
