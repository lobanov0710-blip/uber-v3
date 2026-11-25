// =========================================
// DRIVER SUPPORT CASE SERVICE
// =========================================

import {
  createMutationIdempotency
} from "./mutationIdempotency.js";

import {
  getMutationIdempotencyRecord,
  prepareMutationIdempotencyComplete
} from "./mutationIdempotencyRepository.js";

import {
  createDriverSupportCase
} from "./driverSupportCaseRepository.js";


const CATEGORIES =
  new Set([
    "passenger_no_show",
    "delay",
    "vehicle",
    "route",
    "unable_to_complete",
    "reassignment",
    "conflict",
    "other"
  ]);

const INPUT_KEYS =
  new Set([
    "category",
    "orderId"
  ]);


function clean(value) {
  return String(value ?? "")
    .trim();
}


function invalid(code = "invalid_request") {
  return {
    ok: false,
    status: 400,
    error: "invalid request",
    code
  };
}


function forbidden(code = "driver_role_required") {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}


function conflict(code) {
  return {
    ok: false,
    status: 409,
    error: "conflict",
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


function parseInput(input) {
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
    return null;
  }


  const category =
    clean(input.category)
      .toLowerCase();

  const orderId =
    input.orderId == null ||
    clean(input.orderId) === ""
      ? null
      : clean(input.orderId);


  if (
    !CATEGORIES.has(category) ||
    (
      orderId !== null &&
      !/^[A-Za-z0-9_-]{8,120}$/.test(
        orderId
      )
    )
  ) {
    return null;
  }


  return {
    category,
    orderId
  };
}


async function prepareIdempotency(
  env,
  driverId,
  key,
  body
) {
  const prepared =
    await createMutationIdempotency({
      key,
      operation:
        "driver.support_case.create",
      target:
        driverId,
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
        actorAccountId:
          driverId,
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


async function completeRejectedOwnership(
  env,
  driverId,
  idempotency,
  now
) {
  const result = {
    ok: false,
    status: 404,
    error: "not found",
    code: "support_order_not_accessible"
  };


  const run =
    await prepareMutationIdempotencyComplete(
      env.DB,
      {
        actorAccountId:
          driverId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest,
        requestDigest:
          idempotency.requestDigest,
        claimId:
          idempotency.claimId,
        httpStatus:
          result.status,
        resultCode:
          result.code,
        result,
        completedAt:
          now
      }
    )
      .run();


  if (
    Number(
      run?.meta?.changes
    ) !== 1
  ) {
    throw new Error(
      "support ownership idempotency completion failed"
    );
  }


  return result;
}


async function resolveRepositoryResult(
  env,
  driverId,
  idempotency,
  repositoryResult,
  now
) {
  if (
    repositoryResult.kind ===
      "not_allowed"
  ) {
    return completeRejectedOwnership(
      env,
      driverId,
      idempotency,
      now
    );
  }


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
        actorAccountId:
          driverId,
        operation:
          idempotency.operation,
        keyDigest:
          idempotency.keyDigest
      }
    );


  if (!existing) {
    throw new Error(
      "support idempotency record disappeared"
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


export async function postDriverSupportCase(
  env,
  user,
  input,
  options = {}
) {
  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    clean(user.role)
      .toLowerCase() !== "driver" ||
    !clean(user.id)
  ) {
    return forbidden();
  }


  const parsed =
    parseInput(
      input
    );


  if (!parsed) {
    return invalid();
  }


  const driverId =
    clean(user.id);


  const idempotency =
    await prepareIdempotency(
      env,
      driverId,
      options.idempotencyKey,
      parsed
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const now =
    Number.isSafeInteger(
      options.nowMs
    )
      ? options.nowMs
      : Date.now();


  if (
    !Number.isSafeInteger(now) ||
    now <= 0
  ) {
    throw new Error(
      "invalid support timestamp"
    );
  }


  const result =
    await createDriverSupportCase(
      env,
      {
        driverId,
        caseId:
          createId(
            "support-case"
          ),
        orderId:
          parsed.orderId,
        category:
          parsed.category,
        createdAt:
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
    driverId,
    idempotency.value,
    result,
    now
  );
}
