import {
  listActiveDriverPushTargets,
  listActiveDriverPushTargetsForAccount
} from "./staffPushDeliveryRepository.js";

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


async function sha256(
  value
) {

  const bytes =
    new TextEncoder()
      .encode(
        value
      );


  return new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes
    )
  );
}


export async function constantTimeSecretEqual(
  left,
  right
) {

  const a =
    await sha256(
      clean(
        left
      )
    );


  const b =
    await sha256(
      clean(
        right
      )
    );


  let diff =
    0;


  for (
    let index = 0;
    index < a.length;
    index++
  ) {

    diff |=
      a[index] ^
      b[index];
  }


  return diff ===
    0;
}


function validateOrderId(
  value
) {

  const orderId =
    clean(
      value
    )
      .toLowerCase();


  if (
    !ORDER_ID_PATTERN.test(
      orderId
    )
  ) {

    throw new Error(
      "Invalid test order id"
    );
  }


  return orderId;
}


function validateUpdatedAt(
  value
) {

  const updatedAt =
    Number(
      value
    );


  if (
    !Number.isSafeInteger(
      updatedAt
    )
    ||
    updatedAt <= 0
  ) {

    throw new Error(
      "Invalid test updatedAt"
    );
  }


  return updatedAt;
}


export async function sendArch1116SyntheticPush(
  env,
  body
) {

  const event =
    clean(
      body?.event
    )
      .toLowerCase();


  const orderId =
    validateOrderId(
      body?.orderId
    );


  const updatedAt =
    validateUpdatedAt(
      body?.updatedAt
    );


  let targets;
  let payload;


  if (
    event ===
      "new_order"
  ) {

    targets =
      await listActiveDriverPushTargets(
        env,
        Date.now()
      );


    payload = {
      type:
        "new_order",

      orderId,

      updatedAt:
        String(
          updatedAt
        )
    };

  } else if (
    event ===
      "taken"
  ) {

    targets =
      await listActiveDriverPushTargets(
        env,
        Date.now()
      );


    payload = {
      type:
        "order_status_changed",

      orderId,

      status:
        "taken",

      updatedAt:
        String(
          updatedAt
        ),

      action:
        "invalidate"
    };

  } else if (
    event ===
      "canceled"
  ) {

    const driverId =
      clean(
        body?.driverId
      );


    if (!driverId) {

      throw new Error(
        "Missing test driver id"
      );
    }


    targets =
      await listActiveDriverPushTargetsForAccount(
        env,
        driverId,
        Date.now()
      );


    payload = {
      type:
        "order_status_changed",

      orderId,

      status:
        "canceled",

      updatedAt:
        String(
          updatedAt
        ),

      action:
        "notify"
    };

  } else {

    throw new Error(
      "Invalid test event"
    );
  }


  if (
    targets.length ===
      0
  ) {

    return {
      ok:
        true,

      event,

      attempted:
        0,

      delivered:
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


            return result.ok ===
              true;

          } catch (
            error
          ) {

            return false;
          }
        }
      )
    );


  return {
    ok:
      true,

    event,

    attempted:
      targets.length,

    delivered:
      outcomes.filter(
        Boolean
      )
        .length
  };
}
