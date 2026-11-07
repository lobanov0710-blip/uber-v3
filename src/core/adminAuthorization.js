// =========================================
// ADMIN AUTHORIZATION
// =========================================
//
// staff_accounts.role remains the legacy
// authentication category: admin/driver.
//
// Operational role is derived server-side:
// - OWNER: singleton staff_owner_binding
// - DISPATCHER: admin account with explicit
//   staff_permissions.
//
// No client-supplied role/permission is
// trusted.
// =========================================


function requireDatabase(env) {
  if (!env?.DB) {
    throw new Error(
      "D1 DB binding is not configured"
    );
  }

  return env.DB;
}


function clean(value) {
  return String(value ?? "")
    .trim();
}


function normalizePermission(value) {
  return clean(value)
    .toLowerCase();
}


export async function resolveAdminAccess(
  env,
  user
) {
  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user)
  ) {
    return {
      ok: false,
      status: 403,
      code: "admin_role_required"
    };
  }

  const accountId =
    clean(user.id);

  const authRole =
    clean(user.role)
      .toLowerCase();

  if (
    !accountId ||
    authRole !== "admin"
  ) {
    return {
      ok: false,
      status: 403,
      code: "admin_role_required"
    };
  }

  const db =
    requireDatabase(env);

  const owner =
    await db
      .prepare(`
        SELECT account_id

        FROM staff_owner_binding

        WHERE singleton = 1
          AND account_id = ?1

        LIMIT 1
      `)
      .bind(
        accountId
      )
      .first();

  if (owner) {
    return {
      ok: true,
      accountId,
      role: "owner",
      isOwner: true,
      permissions: [
        "*"
      ]
    };
  }

  const result =
    await db
      .prepare(`
        SELECT permission

        FROM staff_permissions

        WHERE account_id = ?1

        ORDER BY permission ASC
      `)
      .bind(
        accountId
      )
      .all();

  if (
    result?.success !== true ||
    !Array.isArray(
      result?.results
    )
  ) {
    throw new Error(
      "admin permission lookup failed"
    );
  }

  const permissions =
    [
      ...new Set(
        result.results
          .map(
            row =>
              normalizePermission(
                row?.permission
              )
          )
          .filter(Boolean)
      )
    ];

  return {
    ok: true,
    accountId,
    role: "dispatcher",
    isOwner: false,
    permissions
  };
}


export function adminCan(
  access,
  permission
) {
  if (
    access?.ok !== true
  ) {
    return false;
  }

  if (
    access.isOwner === true
  ) {
    return true;
  }

  const required =
    normalizePermission(
      permission
    );

  if (!required) {
    return false;
  }

  return Array.isArray(
    access.permissions
  )
    &&
    access.permissions.includes(
      required
    );
}


export function requireAdminPermission(
  access,
  permission
) {
  if (
    !adminCan(
      access,
      permission
    )
  ) {
    return {
      ok: false,
      status: 403,
      error: "forbidden",
      code: "permission_required"
    };
  }

  return {
    ok: true
  };
}


export function requireOwner(
  access
) {
  if (
    access?.ok !== true ||
    access.isOwner !== true
  ) {
    return {
      ok: false,
      status: 403,
      error: "forbidden",
      code: "owner_required"
    };
  }

  return {
    ok: true
  };
}
