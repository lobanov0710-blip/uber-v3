import assert from "node:assert/strict";

import {
  adminCan,
  requireAdminPermission,
  requireOwner,
  resolveAdminAccess
} from "../src/core/adminAuthorization.js";


function dbFor({
  ownerAccountId = null,
  permissions = {}
} = {}) {
  return {
    prepare(sql) {
      return {
        sql,
        args: [],

        bind(...args) {
          this.args = args;
          return this;
        },

        async first() {
          if (
            /FROM\s+staff_owner_binding/i.test(
              this.sql
            )
          ) {
            return (
              ownerAccountId &&
              this.args[0] ===
                ownerAccountId
            )
              ? {
                  account_id:
                    ownerAccountId
                }
              : null;
          }

          throw new Error(
            "unexpected first query"
          );
        },

        async all() {
          if (
            /FROM\s+staff_permissions/i.test(
              this.sql
            )
          ) {
            return {
              success: true,
              results:
                (
                  permissions[
                    this.args[0]
                  ] ||
                  []
                )
                  .map(
                    permission => ({
                      permission
                    })
                  )
            };
          }

          throw new Error(
            "unexpected all query"
          );
        }
      };
    }
  };
}


const owner =
  await resolveAdminAccess(
    {
      DB:
        dbFor({
          ownerAccountId:
            "staff_owner123"
        })
    },
    {
      id:
        "staff_owner123",
      role:
        "admin"
    }
  );


assert.equal(
  owner.role,
  "owner"
);

assert.equal(
  adminCan(
    owner,
    "anything.future.permission"
  ),
  true
);

assert.equal(
  requireOwner(owner).ok,
  true
);


const dispatcher =
  await resolveAdminAccess(
    {
      DB:
        dbFor({
          permissions: {
            staff_dispatcher123: [
              "orders.read",
              "orders.assign",
              "drivers.read"
            ]
          }
        })
    },
    {
      id:
        "staff_dispatcher123",
      role:
        "admin"
    }
  );


assert.equal(
  dispatcher.role,
  "dispatcher"
);

assert.equal(
  adminCan(
    dispatcher,
    "orders.assign"
  ),
  true
);

assert.equal(
  adminCan(
    dispatcher,
    "staff.manage"
  ),
  false
);

assert.equal(
  requireAdminPermission(
    dispatcher,
    "drivers.read"
  ).ok,
  true
);

assert.equal(
  requireAdminPermission(
    dispatcher,
    "documents.read_sensitive"
  ).status,
  403
);

assert.equal(
  requireOwner(
    dispatcher
  ).status,
  403
);


const driverDenied =
  await resolveAdminAccess(
    {
      DB:
        dbFor()
    },
    {
      id:
        "staff_driver123",
      role:
        "driver"
    }
  );


assert.equal(
  driverDenied.status,
  403
);


console.log(
  "✓ ADMIN AUTHORIZATION TESTS PASSED"
);
