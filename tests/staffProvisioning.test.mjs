import assert from "node:assert/strict";

import {
  webcrypto
} from "node:crypto";

import {
  STAFF_PASSWORD_ITERATIONS
} from "../src/core/staffAuthCrypto.js";

import {
  createAdminBootstrapAccount,
  buildStaffAccountInsertSql
} from "../src/core/staffProvisioning.js";


// ========================================
// WEB CRYPTO
// ========================================

if (
  !globalThis.crypto
) {

  globalThis.crypto =
    webcrypto;
}


if (
  typeof globalThis.btoa !==
    "function"
) {

  globalThis.btoa =
    value =>
      Buffer
        .from(
          value,
          "binary"
        )
        .toString(
          "base64"
        );
}


if (
  typeof globalThis.atob !==
    "function"
) {

  globalThis.atob =
    value =>
      Buffer
        .from(
          value,
          "base64"
        )
        .toString(
          "binary"
        );
}


// ========================================
// CONSTANTS
// ========================================

const FIXED_NOW =
  1700000000000;

const STRONG_PASSWORD =
  "Very-Strong-Admin-Password-123!";


// ========================================
// TEST RUNNER
// ========================================

async function test(
  name,
  fn
) {

  try {

    await fn();

    console.log(
      `PASS: ${name}`
    );

  } catch (
    error
  ) {

    console.error(
      `FAIL: ${name}`
    );

    console.error(
      error
    );

    process.exitCode =
      1;
  }
}


// ========================================
// PASSWORD POLICY
// ========================================

await test(
  "bootstrap uses Cloudflare-compatible production work factor",
  async () => {

    assert.equal(
      STAFF_PASSWORD_ITERATIONS,
      100000
    );
  }
);


// ========================================
// BOOTSTRAP ACCOUNT
// ========================================

await test(
  "bootstrap creates active admin account",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            " ADMIN.MAIN ",

          displayName:
            "Main Administrator",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_001",

          now:
            FIXED_NOW
        }
      );


    assert.equal(
      account.id,
      "staff_test_admin_001"
    );


    assert.equal(
      account.login,
      "admin.main"
    );


    assert.equal(
      account.displayName,
      "Main Administrator"
    );


    assert.equal(
      account.role,
      "admin"
    );


    assert.equal(
      account.status,
      "active"
    );


    assert.equal(
      account.tokenVersion,
      1
    );


    assert.equal(
      account.passwordChangedAt,
      FIXED_NOW
    );


    assert.equal(
      account.createdAt,
      FIXED_NOW
    );


    assert.equal(
      account.updatedAt,
      FIXED_NOW
    );


    assert.equal(
      account.passwordVerifier
        .passwordAlgorithm,
      "pbkdf2-sha256"
    );


    assert.equal(
      account.passwordVerifier
        .passwordIterations,
      STAFF_PASSWORD_ITERATIONS
    );


    assert.equal(
      account.passwordVerifier
        .passwordIterations,
      100000
    );


    assert.match(
      account.passwordVerifier
        .passwordSalt,
      /^[A-Za-z0-9_-]{22}$/
    );


    assert.match(
      account.passwordVerifier
        .passwordHash,
      /^[A-Za-z0-9_-]{43}$/
    );
  }
);


// ========================================
// SQL
// ========================================

await test(
  "bootstrap SQL contains verifier but never plaintext password",
  async () => {

    const password =
      "Another-Very-Strong-Password-456!";


    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin O'Brien",

          password
        },
        {
          id:
            "staff_test_admin_002",

          now:
            FIXED_NOW
        }
      );


    const sql =
      buildStaffAccountInsertSql(
        account
      );


    assert.match(
      sql,
      /INSERT INTO staff_accounts/i
    );


    assert.doesNotMatch(
      sql,
      /INSERT OR REPLACE/i
    );


    assert.doesNotMatch(
      sql,
      /\bUPSERT\b/i
    );


    assert.doesNotMatch(
      sql,
      /\bUPDATE\s+staff_accounts\b/i
    );


    assert.equal(
      sql.includes(
        password
      ),
      false
    );


    assert.match(
      sql,
      /'admin'/
    );


    assert.match(
      sql,
      /'active'/
    );


    assert.match(
      sql,
      /100000/
    );


    // SQL quote escaping.
    assert.match(
      sql,
      /Admin O''Brien/
    );
  }
);


// ========================================
// LOGIN POLICY
// ========================================

await test(
  "invalid bootstrap login is rejected",
  async () => {

    await assert.rejects(
      () =>
        createAdminBootstrapAccount(
          {
            login:
              "Admin User",

            displayName:
              "Admin",

            password:
              STRONG_PASSWORD
          }
        ),

      /Invalid staff provisioning login/
    );
  }
);


// ========================================
// PASSWORD POLICY
// ========================================

await test(
  "short bootstrap password is rejected before hashing",
  async () => {

    await assert.rejects(
      () =>
        createAdminBootstrapAccount(
          {
            login:
              "admin",

            displayName:
              "Admin",

            password:
              "short-password"
          }
        ),

      /16-128 characters/
    );
  }
);


await test(
  "oversized bootstrap password is rejected",
  async () => {

    const password =
      "a".repeat(
        129
      );


    await assert.rejects(
      () =>
        createAdminBootstrapAccount(
          {
            login:
              "admin",

            displayName:
              "Admin",

            password
          }
        ),

      /16-128 characters/
    );
  }
);


// ========================================
// DISPLAY NAME
// ========================================

await test(
  "display name with control characters is rejected",
  async () => {

    await assert.rejects(
      () =>
        createAdminBootstrapAccount(
          {
            login:
              "admin",

            displayName:
              "Admin\nInjected",

            password:
              STRONG_PASSWORD
          }
        ),

      /Invalid staff provisioning displayName/
    );
  }
);


// ========================================
// STAFF ID POLICY
// ========================================

await test(
  "bootstrap staff id cannot exceed D1 length limit",
  async () => {

    const oversizedId =
      "staff_" +
      "a".repeat(
        95
      );


    assert.equal(
      oversizedId.length,
      101
    );


    await assert.rejects(
      () =>
        createAdminBootstrapAccount(
          {
            login:
              "admin",

            displayName:
              "Admin",

            password:
              STRONG_PASSWORD
          },
          {
            id:
              oversizedId,

            now:
              FIXED_NOW
          }
        ),

      /Invalid staff provisioning id/
    );
  }
);


// ========================================
// ROLE / STATUS POLICY
// ========================================

await test(
  "bootstrap SQL rejects changed role or status",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_003",

          now:
            FIXED_NOW
        }
      );


    const driverAccount = {
      ...account,

      role:
        "driver"
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          driverAccount
        ),

      /Invalid bootstrap account role\/status/
    );


    const pendingAccount = {
      ...account,

      status:
        "pending"
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          pendingAccount
        ),

      /Invalid bootstrap account role\/status/
    );
  }
);


// ========================================
// PASSWORD WORK FACTOR
// ========================================
//
// Security regression:
//
// Cloudflare Workers rejects PBKDF2
// iteration counts above 100,000.
//
// Provisioning must therefore reject
// verifier metadata that does not match
// the exact production work factor.
// ========================================

await test(
  "bootstrap SQL rejects unsupported high password work factor",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_004",

          now:
            FIXED_NOW
        }
      );


    const unsupportedAccount = {
      ...account,

      passwordVerifier: {
        ...account.passwordVerifier,

        passwordIterations:
          600000
      }
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          unsupportedAccount
        ),

      /Invalid staff provisioning password verifier/
    );
  }
);


await test(
  "bootstrap SQL rejects password work factor below production policy",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_005",

          now:
            FIXED_NOW
        }
      );


    const unsupportedAccount = {
      ...account,

      passwordVerifier: {
        ...account.passwordVerifier,

        passwordIterations:
          99999
      }
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          unsupportedAccount
        ),

      /Invalid staff provisioning password verifier/
    );
  }
);


await test(
  "bootstrap SQL accepts only current production password work factor",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_006",

          now:
            FIXED_NOW
        }
      );


    assert.equal(
      account.passwordVerifier
        .passwordIterations,
      STAFF_PASSWORD_ITERATIONS
    );


    assert.equal(
      account.passwordVerifier
        .passwordIterations,
      100000
    );


    assert.doesNotThrow(
      () =>
        buildStaffAccountInsertSql(
          account
        )
    );
  }
);


// ========================================
// VERIFIER INTEGRITY
// ========================================

await test(
  "bootstrap SQL rejects malformed password verifier",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_007",

          now:
            FIXED_NOW
        }
      );


    const malformedAccount = {
      ...account,

      passwordVerifier: {
        ...account.passwordVerifier,

        passwordHash:
          "invalid"
      }
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          malformedAccount
        ),

      /Invalid staff provisioning password verifier/
    );
  }
);


// ========================================
// TOKEN VERSION
// ========================================

await test(
  "bootstrap SQL requires initial token version one",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_008",

          now:
            FIXED_NOW
        }
      );


    const modifiedAccount = {
      ...account,

      tokenVersion:
        2
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          modifiedAccount
        ),

      /Invalid staff provisioning tokenVersion/
    );
  }
);


// ========================================
// INITIAL TIMESTAMPS
// ========================================

await test(
  "bootstrap SQL requires identical initial timestamps",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "admin",

          displayName:
            "Admin",

          password:
            STRONG_PASSWORD
        },
        {
          id:
            "staff_test_admin_009",

          now:
            FIXED_NOW
        }
      );


    const changedUpdatedAt = {
      ...account,

      updatedAt:
        FIXED_NOW +
        1
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          changedUpdatedAt
        ),

      /Invalid staff provisioning timestamps/
    );


    const changedPasswordAt = {
      ...account,

      passwordChangedAt:
        FIXED_NOW -
        1
    };


    assert.throws(
      () =>
        buildStaffAccountInsertSql(
          changedPasswordAt
        ),

      /Invalid staff provisioning timestamps/
    );
  }
);


// ========================================
// GENERATED ID
// ========================================

await test(
  "bootstrap can generate secure staff id",
  async () => {

    const account =
      await createAdminBootstrapAccount(
        {
          login:
            "generated.admin",

          displayName:
            "Generated Admin",

          password:
            STRONG_PASSWORD
        },
        {
          now:
            FIXED_NOW
        }
      );


    assert.match(
      account.id,
      /^staff_[A-Za-z0-9_-]{8,94}$/
    );


    assert.ok(
      account.id.length <=
        100
    );
  }
);


// ========================================
// FINAL RESULT
// ========================================

console.log("");


if (
  !process.exitCode
) {

  console.log(
    "ALL STAFF PROVISIONING TESTS PASSED"
  );
}