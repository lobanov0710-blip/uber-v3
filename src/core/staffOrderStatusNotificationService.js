import { isStagingEnvironment } from "./deploymentEnvironment.js";

import {
  listActiveDriverPushTargets,
  listActiveDriverPushTargetsForAccount
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


function clean(
  value
) {

  return String(
    value ?? ""
  )
    .trim();
}


function cleanOrderId(
  value
) {

  const orderId =
    clean(
      value
    )
      .toLowerCase();


  return ORDER_ID_PATTERN.test(
    orderId
  )
    ? orderId
    : "";
}


export function buildDriverOrderStatusPushPlan(
  order
) {

  const orderId =
    cleanOrderId(
      order?.id
    );


  if (!orderId) {

    throw new Error(
      "Invalid order id for status push"
    );
  }


  const status =
    clean(
      order?.status
    )
      .toLowerCase();


  const updatedAt =
    Number(
      order?.updatedAt
    );


  if (
    !Number.isSafeInteger(
      updatedAt
    )
    ||
    updatedAt <= 0
  ) {

    throw new Error(
      "Invalid order updatedAt for status push"
    );
  }


  const basePayload = {
    type:
      "order_status_changed",

    orderId,

    status,

    updatedAt:
      String(
        updatedAt
      )
  };


  // new -> taken:
  // all active drivers must invalidate a
  // stale "new order" notification.
  if (
    status ===
      "taken"
  ) {

    return {
      audience:
        "all",

      accountId:
        null,

      payload: {
        ...basePayload,
        action:
          "invalidate"
      }
    };
  }


  // * -> canceled:
  // assigned order -> notify only its driver;
  // unassigned order -> invalidate it for all.
  if (
    status ===
      "canceled"
  ) {

    const driverId =
      clean(
        order?.driverId
      );


    const assigned =
      Boolean(
        driverId
      );


    return {
      audience:
        assigned
          ? "account"
          : "all",

      accountId:
        driverId ||
        null,

      payload: {
        ...basePayload,
        action:
          assigned
            ? "notify"
            : "invalidate"
      }
    };
  }


  // in_progress and done are currently
  // initiated by the assigned driver itself.
  // Cross-device state propagation belongs
  // to the later device-sync stage.
  return null;
}


async function deliverStatusPush(
  env,
  targets,
  payload
) {

  if (
    targets.length ===
      0
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
                payload
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
                  "STAFF STATUS PUSH STALE TOKEN CLEANUP ERROR"
                );
              }
            }


            console.error(
              "STAFF STATUS PUSH SEND ERROR",
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
              "STAFF STATUS PUSH SEND ERROR"
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
      ).length,

    removed:
      outcomes.filter(
        outcome =>
          outcome.removed
      ).length
  };
}


export async function notifyDriversOfOrderStatusChange(
  env,
  order
) {

  const plan =
    buildDriverOrderStatusPushPlan(
      order
    );


  if (!plan) {

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


  const now =
    Date.now();


  const targets =
    plan.audience ===
      "account"
      ? await listActiveDriverPushTargetsForAccount(
          env,
          plan.accountId,
          now
        )
      : await listActiveDriverPushTargets(
          env,
          now
        );


  return deliverStatusPush(
    env,
    targets,
    plan.payload
  );
}
