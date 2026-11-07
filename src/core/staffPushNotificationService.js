import { isStagingEnvironment } from "./deploymentEnvironment.js";

// =========================================
// TARGETED DRIVER PUSH NOTIFICATIONS
// =========================================
//
// Assignment-only delivery.
//
// Security rules:
// - no broadcast selector exists here;
// - target account is explicit and is still
//   checked against active Driver account +
//   active registered session family in D1;
// - payload contains only opaque routing/state
//   metadata, never passenger PII;
// - FCM tokens are never logged.
// =========================================

import {
  listActiveDriverPushTargetsForAccount
} from "./staffPushDeliveryRepository.js";

import {
  deleteStaffPushDevice
} from "./staffPushDeviceRepository.js";

import {
  getFirebaseAccessToken,
  sendFirebaseDataMessage
} from "./firebaseMessaging.js";


const EVENT_TYPES =
  new Set([
    "order_assigned",
    "order_assignment_revoked"
  ]);


function cleanText(
  value,
  maxLength
) {

  const text =
    String(
      value ?? ""
    )
      .trim();


  if (
    !text
    ||
    text.length >
      maxLength
    ||
    /[\u0000-\u001F\u007F]/.test(
      text
    )
  ) {

    return "";
  }


  return text;
}


function normalizeEvent(
  input
) {

  if (
    !input
    ||
    typeof input !==
      "object"
    ||
    Array.isArray(
      input
    )
  ) {

    return null;
  }


  const type =
    cleanText(
      input.type,
      80
    );


  const accountId =
    cleanText(
      input.accountId,
      100
    );


  const orderId =
    cleanText(
      input.orderId,
      120
    );


  const assignmentId =
    input.assignmentId == null
      ? null
      : cleanText(
          input.assignmentId,
          120
        );


  const orderRevision =
    Number(
      input.orderRevision
    );


  if (
    !EVENT_TYPES.has(
      type
    )
    ||
    !accountId
    ||
    !orderId
    ||
    !Number.isSafeInteger(
      orderRevision
    )
    ||
    orderRevision < 1
  ) {

    return null;
  }


  if (
    type === "order_assigned"
    &&
    !assignmentId
  ) {

    return null;
  }


  return {
    type,
    accountId,
    orderId,
    assignmentId,
    orderRevision
  };
}


export async function notifyDriverAssignmentEvent(
  env,
  input
) {

  const event =
    normalizeEvent(
      input
    );


  if (!event) {

    throw new Error(
      "Invalid driver assignment push event"
    );
  }


  if (
    isStagingEnvironment(
      env
    )
  ) {

    return {
      ok:
        true,

      attempted:
        0,

      delivered:
        0,

      removed:
        0,

      skipped:
        true
    };
  }


  const targets =
    await listActiveDriverPushTargetsForAccount(
      env,
      event.accountId,
      Date.now()
    );


  if (
    targets.length === 0
  ) {

    return {
      ok:
        true,

      attempted:
        0,

      delivered:
        0,

      removed:
        0
    };
  }


  const accessToken =
    await getFirebaseAccessToken(
      env
    );


  const data = {
    type:
      event.type,

    orderId:
      event.orderId,

    orderRevision:
      String(
        event.orderRevision
      )
  };


  if (
    event.assignmentId
  ) {

    data.assignmentId =
      event.assignmentId;
  }


  const outcomes =
    await Promise.all(
      targets.map(
        async target => {

          try {

            const result =
              await sendFirebaseDataMessage(
                env,
                accessToken,
                target.fcmToken,
                data
              );


            if (
              result.ok
            ) {

              return {
                delivered:
                  true,

                removed:
                  false
              };
            }


            if (
              result.errorCode ===
                "UNREGISTERED"
            ) {

              try {

                await deleteStaffPushDevice(
                  env,
                  target.accountId,
                  target.installationId
                );


                return {
                  delivered:
                    false,

                  removed:
                    true
                };

              } catch {

                console.error(
                  "STAFF PUSH STALE TOKEN CLEANUP ERROR"
                );
              }
            }


            console.error(
              "STAFF PUSH SEND ERROR",
              {
                status:
                  result.status,

                errorCode:
                  result.errorCode ||
                  "UNKNOWN"
              }
            );


            return {
              delivered:
                false,

              removed:
                false
            };

          } catch {

            console.error(
              "STAFF PUSH SEND ERROR"
            );


            return {
              delivered:
                false,

              removed:
                false
            };
          }
        }
      )
    );


  return {
    ok:
      true,

    attempted:
      targets.length,

    delivered:
      outcomes.filter(
        outcome =>
          outcome.delivered
      )
        .length,

    removed:
      outcomes.filter(
        outcome =>
          outcome.removed
      )
        .length
  };
}
