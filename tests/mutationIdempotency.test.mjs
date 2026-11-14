import assert from "node:assert/strict";

import {
  createMutationIdempotency
} from "../src/core/mutationIdempotency.js";


const first =
  await createMutationIdempotency({
    key:
      "review-12345678",
    operation:
      "admin.registration.item.document",
    target:
      "staff_driver123:document_12345678",
    body: {
      decision:
        "verified",
      expectedRevision:
        1,
      nested: {
        b:
          2,
        a:
          1
      }
    }
  });


const reordered =
  await createMutationIdempotency({
    key:
      "review-12345678",
    operation:
      "admin.registration.item.document",
    target:
      "staff_driver123:document_12345678",
    body: {
      nested: {
        a:
          1,
        b:
          2
      },
      expectedRevision:
        1,
      decision:
        "verified"
    }
  });


assert.equal(
  first.ok,
  true
);

assert.equal(
  first.keyDigest.length,
  43
);

assert.equal(
  first.requestDigest,
  reordered.requestDigest,
  "canonical body order must not change request digest"
);

assert.equal(
  first.keyDigest.includes(
    "review-12345678"
  ),
  false,
  "raw idempotency key must not survive in digest"
);


const changed =
  await createMutationIdempotency({
    key:
      "review-12345678",
    operation:
      "admin.registration.item.document",
    target:
      "staff_driver123:document_12345678",
    body: {
      decision:
        "rejected",
      expectedRevision:
        1
    }
  });


assert.notEqual(
  changed.requestDigest,
  first.requestDigest,
  "same key with different request must be detectable"
);


const missing =
  await createMutationIdempotency({
    key:
      null,
    operation:
      "admin.registration.item.document",
    target:
      "target",
    body:
      {}
  });


assert.equal(
  missing.status,
  400
);

assert.equal(
  missing.code,
  "idempotency_key_required"
);


const invalid =
  await createMutationIdempotency({
    key:
      "short",
    operation:
      "admin.registration.item.document",
    target:
      "target",
    body:
      {}
  });


assert.equal(
  invalid.code,
  "invalid_idempotency_key"
);


console.log(
  "✓ MUTATION IDEMPOTENCY TESTS PASSED"
);

const digest = async body => (await createMutationIdempotency({
  key: "canonical-edge-123", operation: "test.canonical", target: "test", body
})).requestDigest;
assert.notEqual(await digest(JSON.parse('{"__proto__":{"a":1}}')), await digest({}),
  "own __proto__ data must not disappear from the request digest");
assert.notEqual(await digest({ nested: JSON.parse('{"__proto__":{"a":1}}') }),
  await digest({ nested: {} }), "nested keys must survive canonicalization");
