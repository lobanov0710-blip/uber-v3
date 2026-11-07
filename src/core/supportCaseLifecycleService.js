// =========================================
// SUPPORT CASE LIFECYCLE SERVICE
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
  appendAdminSupportMessage,
  appendDriverSupportMessage,
  deleteExpiredSupportMessages,
  getSupportCaseBundle,
  listAdminSupportCases,
  listDriverSupportCases,
  updateAdminSupportCaseStatus
} from "./supportCaseLifecycleRepository.js";


export const SUPPORT_CHAT_RETENTION_MS =
  30 * 24 * 60 * 60 * 1000;


const SUPPORT_STATUSES =
  new Set([
    "open",
    "in_progress",
    "resolved",
    "closed"
  ]);

const MESSAGE_INPUT_KEYS =
  new Set([
    "body",
    "expectedRevision"
  ]);

const STATUS_INPUT_KEYS =
  new Set([
    "status",
    "expectedRevision"
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


function forbidden(code = "permission_required") {
  return {
    ok: false,
    status: 403,
    error: "forbidden",
    code
  };
}


function notFound(code = "support_case_not_found") {
  return {
    ok: false,
    status: 404,
    error: "not found",
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


function requireDriver(user) {
  if (
    !user ||
    typeof user !== "object" ||
    Array.isArray(user) ||
    clean(user.role)
      .toLowerCase() !==
      "driver" ||
    !clean(user.id)
  ) {
    return null;
  }

  return {
    id:
      clean(user.id)
  };
}


async function requireSupportAdmin(
  env,
  user
) {
  const access =
    await resolveAdminAccess(
      env,
      user
    );


  if (
    access?.ok !== true ||
    !adminCan(
      access,
      "support.manage"
    )
  ) {
    return {
      ok: false,
      response:
        forbidden(
          access?.code ||
          "permission_required"
        )
    };
  }


  return {
    ok: true,
    access
  };
}


function parseMessageInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          !MESSAGE_INPUT_KEYS
            .has(key)
      )
  ) {
    return null;
  }


  const body =
    clean(input.body);

  const expectedRevision =
    Number(
      input.expectedRevision
    );


  if (
    body.length < 1 ||
    body.length > 4000 ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(
      body
    ) ||
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
  ) {
    return null;
  }


  return {
    body,
    expectedRevision
  };
}


function parseStatusInput(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input)
      .some(
        key =>
          !STATUS_INPUT_KEYS
            .has(key)
      )
  ) {
    return null;
  }


  const status =
    clean(input.status)
      .toLowerCase();

  const expectedRevision =
    Number(
      input.expectedRevision
    );


  if (
    !SUPPORT_STATUSES.has(
      status
    ) ||
    !Number.isSafeInteger(
      expectedRevision
    ) ||
    expectedRevision < 1
  ) {
    return null;
  }


  return {
    status,
    expectedRevision
  };
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
      "support lifecycle idempotency record disappeared"
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


function nowFrom(options) {
  const now =
    Number.isSafeInteger(
      options?.nowMs
    )
      ? options.nowMs
      : Date.now();


  if (
    !Number.isSafeInteger(now) ||
    now <= 0
  ) {
    throw new Error(
      "invalid support lifecycle timestamp"
    );
  }


  return now;
}


export async function getDriverSupportCases(
  env,
  user,
  options = {}
) {
  const driver =
    requireDriver(user);


  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }


  return {
    ok: true,
    supportCases:
      await listDriverSupportCases(
        env,
        driver.id,
        options.limit
      )
  };
}


export async function getDriverSupportCase(
  env,
  user,
  caseId,
  options = {}
) {
  const driver =
    requireDriver(user);


  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }


  const supportCase =
    await getSupportCaseBundle(
      env,
      clean(caseId),
      nowFrom(options)
    );


  if (
    !supportCase ||
    supportCase.driverId !==
      driver.id
  ) {
    return notFound();
  }


  return {
    ok: true,
    supportCase
  };
}


export async function postDriverSupportMessage(
  env,
  user,
  caseId,
  input,
  options = {}
) {
  const driver =
    requireDriver(user);


  if (!driver) {
    return forbidden(
      "driver_role_required"
    );
  }


  const parsed =
    parseMessageInput(
      input
    );


  if (!parsed) {
    return invalid();
  }


  const normalizedCaseId =
    clean(caseId);

  const now =
    nowFrom(options);


  const supportCase =
    await getSupportCaseBundle(
      env,
      normalizedCaseId,
      now
    );


  if (
    !supportCase ||
    supportCase.driverId !==
      driver.id
  ) {
    return notFound();
  }


  const idempotency =
    await prepareIdempotency(
      env,
      driver.id,
      {
        key:
          options.idempotencyKey,
        operation:
          "driver.support.message.create",
        target:
          normalizedCaseId,
        body:
          parsed
      }
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const expiry =
    now +
    SUPPORT_CHAT_RETENTION_MS;


  if (
    !Number.isSafeInteger(
      expiry
    )
  ) {
    throw new Error(
      "invalid support message retention"
    );
  }


  const result =
    await appendDriverSupportMessage(
      env,
      {
        actorAccountId:
          driver.id,
        caseId:
          normalizedCaseId,
        expectedRevision:
          parsed.expectedRevision,
        senderKind:
          "driver",
        body:
          parsed.body,
        messageId:
          createId(
            "support-message"
          ),
        createdAt:
          now,
        expiresAt:
          expiry,
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
    driver.id,
    idempotency.value,
    result
  );
}


export async function getAdminSupportCases(
  env,
  user,
  options = {}
) {
  const resolved =
    await requireSupportAdmin(
      env,
      user
    );


  if (!resolved.ok) {
    return resolved.response;
  }


  const status =
    options.status == null ||
    clean(options.status) === ""
      ? null
      : clean(options.status)
          .toLowerCase();


  if (
    status !== null &&
    !SUPPORT_STATUSES.has(
      status
    )
  ) {
    return invalid(
      "invalid_support_status"
    );
  }


  return {
    ok: true,
    supportCases:
      await listAdminSupportCases(
        env,
        {
          status,
          limit:
            options.limit
        }
      )
  };
}


export async function getAdminSupportCase(
  env,
  user,
  caseId,
  options = {}
) {
  const resolved =
    await requireSupportAdmin(
      env,
      user
    );


  if (!resolved.ok) {
    return resolved.response;
  }


  const supportCase =
    await getSupportCaseBundle(
      env,
      clean(caseId),
      nowFrom(options)
    );


  if (!supportCase) {
    return notFound();
  }


  return {
    ok: true,
    supportCase
  };
}


export async function postAdminSupportMessage(
  env,
  user,
  caseId,
  input,
  options = {}
) {
  const resolved =
    await requireSupportAdmin(
      env,
      user
    );


  if (!resolved.ok) {
    return resolved.response;
  }


  const parsed =
    parseMessageInput(
      input
    );


  if (!parsed) {
    return invalid();
  }


  const normalizedCaseId =
    clean(caseId);

  const now =
    nowFrom(options);

  const supportCase =
    await getSupportCaseBundle(
      env,
      normalizedCaseId,
      now
    );


  if (!supportCase) {
    return notFound();
  }


  const actor =
    resolved.access.accountId;


  const idempotency =
    await prepareIdempotency(
      env,
      actor,
      {
        key:
          options.idempotencyKey,
        operation:
          "admin.support.message.create",
        target:
          normalizedCaseId,
        body:
          parsed
      }
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const expiry =
    now +
    SUPPORT_CHAT_RETENTION_MS;


  if (
    !Number.isSafeInteger(
      expiry
    )
  ) {
    throw new Error(
      "invalid support message retention"
    );
  }


  const result =
    await appendAdminSupportMessage(
      env,
      {
        actorAccountId:
          actor,
        caseId:
          normalizedCaseId,
        expectedRevision:
          parsed.expectedRevision,
        senderKind:
          resolved.access.isOwner
            ? "owner"
            : "dispatcher",
        body:
          parsed.body,
        messageId:
          createId(
            "support-message"
          ),
        createdAt:
          now,
        expiresAt:
          expiry,
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
    actor,
    idempotency.value,
    result
  );
}


export async function postAdminSupportCaseStatus(
  env,
  user,
  caseId,
  input,
  options = {}
) {
  const resolved =
    await requireSupportAdmin(
      env,
      user
    );


  if (!resolved.ok) {
    return resolved.response;
  }


  const parsed =
    parseStatusInput(
      input
    );


  if (!parsed) {
    return invalid();
  }


  const normalizedCaseId =
    clean(caseId);

  const now =
    nowFrom(options);

  const supportCase =
    await getSupportCaseBundle(
      env,
      normalizedCaseId,
      now
    );


  if (!supportCase) {
    return notFound();
  }


  const actor =
    resolved.access.accountId;


  const idempotency =
    await prepareIdempotency(
      env,
      actor,
      {
        key:
          options.idempotencyKey,
        operation:
          "admin.support.status.update",
        target:
          normalizedCaseId,
        body:
          parsed
      }
    );


  if (!idempotency.ok) {
    return idempotency.response;
  }


  const result =
    await updateAdminSupportCaseStatus(
      env,
      {
        actorAccountId:
          actor,
        caseId:
          normalizedCaseId,
        expectedRevision:
          parsed.expectedRevision,
        targetStatus:
          parsed.status,
        updatedAt:
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
    actor,
    idempotency.value,
    result
  );
}


export async function runSupportChatRetention(
  env,
  options = {}
) {
  return deleteExpiredSupportMessages(
    env,
    {
      nowMs:
        nowFrom(options),
      limit:
        options.limit
    }
  );
}
