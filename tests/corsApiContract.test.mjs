import assert from "node:assert/strict";

import {
  cors
} from "../src/core/utils.js";


assert.match(
  cors[
    "Access-Control-Allow-Headers"
  ],
  /\bIdempotency-Key\b/
);

assert.match(
  cors[
    "Access-Control-Allow-Headers"
  ],
  /\bX-Firebase-AppCheck\b/
);

for (
  const method of [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "OPTIONS"
  ]
) {

  assert.match(
    cors[
      "Access-Control-Allow-Methods"
    ],
    new RegExp(
      `\\b${method}\\b`
    )
  );
}


console.log(
  "✓ CORS API CONTRACT TESTS PASSED"
);
