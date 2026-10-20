// =========================================
// STAFF PUSH NOTIFICATION SERVICE
// =========================================
//
// New-order push delivery.
//
// Security rules:
// - D1 push row alone is not authorization.
// - Repository selects only active driver
//   accounts with an active session in the
//   registered session family.
// - FCM payload contains only event type
//   and order UUID. No passenger PII.
// - FCM tokens are never logged.
// =========================================

import {
  listActiveDriverPushTargets
} from "./staffPushDeliveryRepository.js";

import {
  deleteStaffPushDevice
} from "./staffPushDeviceRepository.js";

import {
  getFirebaseAccessToken,
  sendFirebaseDataMessage
} from "./firebaseMessaging.js";


const ORDER_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


function cleanOrderId(
  value
) {

  const orderId =
    String(
      value ?? ""
    )
      .trim()
      .toLowerCase();


  return ORDER_ID_PATTERN.test(
    orderId
  )
    ? orderId
    : "";
}


export async function notifyActiveDriversOfNewOrder(
  env,
  orderId
) {

  const normalizedOrderId =
    cleanOrderId(
      orderId
    );


  if (!normalizedOrderId) {

    throw new Error(
      "Invalid order id for push delivery"
    );
  }


  const targets =
    await listActiveDriverPushTargets(
      env,
      Date.now()
    );


  if (targets.length === 0) {

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
                {
                  type:
                    "new_order",

                  orderId:
                    normalizedOrderId
                }
              );


            if (result.ok) {

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

              } catch (
                error
              ) {

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

          } catch (
            error
          ) {

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


  const delivered =
    outcomes.filter(
      outcome =>
        outcome.delivered
    )
      .length;


  const removed =
    outcomes.filter(
      outcome =>
        outcome.removed
    )
      .length;


  return {
    ok:
      true,

    attempted:
      targets.length,

    delivered,

    removed
  };
}
