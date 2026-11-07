// =========================================
// ORDER TERMINAL MUTATION SERVICE
// =========================================

import {
  adminCan,
  resolveAdminAccess
} from "./adminAuthorization.js";

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord
} from "./mutationIdempotencyRepository.js";

import {
  getTerminalOrderState,
  transitionTerminalOrder
} from "./orderTerminalMutationRepository.js";


const INPUT_KEYS =
  new Set([
    "status",
    "expectedRevision"
  ]);


function clean(value) {
  return String(value ?? "")
    .trim();
}


function invalid(
  code,
  error = "invalid request"
) {
  return {
    ok: false,
    status: 400,
    error,
    code
  };
}


function forbidden(
  error = "forbidden transition",
  code = "forbidden_transition"
) {
  return {
    ok: false,
    status: 403,
    error,
    code
  };
}


function notFound() {
  return {
    ok: false,
    status: 404,
    error: "order not found",
    code: "order_not_found"
  };
}


function conflict(code) {
  return {
    ok: false,
    status: 409,
    error: "order transition conflict",
    code
  };
}


function createId(prefix) {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error(
      "secure random UUID unavailable"
    );
  }

  return `${prefix}_${crypto.randomUUID()}`;
}


async function prepareIdempotency(
  env,
  actorAccountId,
  {
    key,
    operation,
    target,
    body
  }
) {
  const prepared =
    await createMutationIdempotency({
      key,
      operation,
      target,
      body
    });


  if (
    prepared?.ok !== true
  ) {
    return {
      ok: false,
      response:
        prepared
    };
  }


  const existing =
    await getMutationIdempotencyRecord(
      env,
      {
        actorAccountId,
        operation:
          prepared.operation,
        keyDigest:
          prepared.keyDigest
      }
    );


  if (existing) {
    if (
      existing.requestDigest !==
        prepared.requestDigest
    ) {
      return {
        ok: false,
        response:
          conflict(
            "idempotency_key_reused"
          )
      };
    }


    if (
      existing.state ===
        "completed" &&
      existing.result
    ) {
      return {
        ok: false,
        response:
          existing.result
      };
    }


    return {
      ok: false,
      response:
        conflict(
          "idempotency_in_progress"
        )
    };
  }


  return {
    ok: true,
    value: {
      ...prepared,
      claimId:
        createId(
          "idem-claim"
        )
    }
  };
}


async function resolveRepositoryResult(
  env,
  actorAccountId,
  idempotency,
  repositoryResult
) {
  if (
    repositoryResult.kind !==
      "existing_idempotency"
  ) {
    return repositoryResult.result;
  }


  const existing =
    await getMutationIdempotencyRecord(
      env,
      {
        actorAccountId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest
      }
    );


  if (!existing) {
    throw new Error(
      "terminal idempotency record disappeared"
    );
  }


  if (
    existing.requestDigest !==
      idempotency.requestDigest
  ) {
    return conflict(
      "idempotency_key_reused"
    );
  }


  if (
    existing.state ===
      "completed" &&
    existing.result
  ) {
    return existing.result;
  }


  return conflict(
    "idempotency_in_progress"
  );
}


export async function transitionOrderTerminal(
  env,
  user,
  orderId,
  input,
  options = {}
) {
  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    !clean(user.id)
  ) {
    return forbidden(
      "forbidden",
      "staff_identity_required"
    );
  }


  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          !INPUT_KEYS.has(key)
      )
  ) {
    return invalid(
      "invalid_request"
    );
  }


  const targetStatus =
    clean(
      input.status
    )
      .toLowerCase();

  const expectedRevision =
    Number(
      input.expectedRevision
    );


  if (
    ![
      "done",
      "canceled"
    ].includes(
      targetStatus
    )
  ) {
    return invalid(
      "invalid_status",
      "invalid status"
    );
  }


  if (
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
  ) {
    return invalid(
      "invalid_revision"
    );
  }


  const role =
    clean(
      user.role
    )
      .toLowerCase();

  let actorAccountId;


  if (
    role === "driver"
  ) {
    if (
      targetStatus !==
        "done"
    ) {
      return forbidden();
    }

    actorAccountId =
      clean(user.id);

  } else if (
    role === "admin"
  ) {

    let access;

    try {
      access =
        await resolveAdminAccess(
          env,
          user
        );
    } catch {
      return {
        ok: false,
        status: 500,
        error:
          "admin authorization failed",
        code:
          "admin_authorization_failed"
      };
    }


    if (
      access?.ok !== true ||
      !adminCan(
        access,
        "orders.cancel"
      )
    ) {
      return forbidden(
        "forbidden",
        "permission_required"
      );
    }


    if (
      targetStatus !==
        "canceled"
    ) {
      return forbidden();
    }


    actorAccountId =
      clean(
        access.accountId
      );

  } else {

    return forbidden(
      "forbidden",
      "staff_role_required"
    );
  }


  const normalizedOrderId =
    clean(
      orderId
    );


  const operation =
    targetStatus === "done"
      ? "driver.order.done"
      : "admin.order.cancel";


  const idempotency =
    await prepareIdempotency(
      env,
      actorAccountId,
      {
        key:
          options.idempotencyKey,
        operation,
        target:
          normalizedOrderId,
        body: {
          status:
            targetStatus,
          expectedRevision
        }
      }
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const state =
    await getTerminalOrderState(
      env,
      normalizedOrderId
    );


  if (!state) {
    return notFound();
  }


  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  const result =
    await transitionTerminalOrder(
      env,
      {
        actorAccountId,
        orderId:
          normalizedOrderId,
        expectedRevision,
        targetStatus,
        currentDriverId:
          state.driverId,
        changedAt:
          now,
        requestId:
          clean(
            options.requestId
          ),
        auditId:
          createId(
            "audit"
          ),
        idempotency:
          idempotency.value
      }
    );


  return resolveRepositoryResult(
    env,
    actorAccountId,
    idempotency.value,
    result
  );
}
