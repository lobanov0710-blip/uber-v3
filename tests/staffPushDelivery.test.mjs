import assert from "node:assert/strict";

import {
  listActiveDriverPushTargets
} from "../src/core/staffPushDeliveryRepository.js";

import {
  sendFirebaseDataMessage
} from "../src/core/firebaseMessaging.js";


const FIXED_NOW =
  1700000000000;

const INSTALLATION_ID =
  "11111111-2222-4333-8444-555555555555";

const ORDER_ID =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const FCM_TOKEN =
  "fcm:test-token_123-ABC";


async function test(
  name,
  fn
) {

  try {

    await fn();

    console.log(
      `✓ ${name}`
    );

  } catch (
    error
  ) {

    console.error(
      `✘ ${name}`
    );

    console.error(
      error
    );

    process.exitCode =
      1;
  }
}


function createFakeDatabase(
  rows
) {

  const calls =
    [];


  const db = {

    prepare(
      sql
    ) {

      const call = {
        sql,
        args:
          null
      };


      calls.push(
        call
      );


      const statement = {

        bind(
          ...args
        ) {

          call.args =
            args;

          return statement;
        },


        async all() {

          return {
            success:
              true,

            results:
              rows
          };
        }
      };


      return statement;
    }
  };


  return {
    db,
    calls
  };
}


await test(
  "push target query requires active driver account and active registered session family",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase(
        [
          {
            installation_id:
              INSTALLATION_ID,

            account_id:
              "staff-1",

            session_family_id:
              "family-1",

            fcm_token:
              FCM_TOKEN
          }
        ]
      );


    const targets =
      await listActiveDriverPushTargets(
        {
          DB:
            db
        },
        FIXED_NOW
      );


    assert.deepEqual(
      targets,
      [
        {
          installationId:
            INSTALLATION_ID,

          accountId:
            "staff-1",

          sessionFamilyId:
            "family-1",

          fcmToken:
            FCM_TOKEN
        }
      ]
    );


    assert.equal(
      calls.length,
      1
    );


    assert.match(
      calls[0].sql,
      /a\.role\s*=\s*'driver'/i
    );


    assert.match(
      calls[0].sql,
      /a\.status\s*=\s*'active'/i
    );


    assert.match(
      calls[0].sql,
      /s\.family_id\s*=\s*p\.session_family_id/i
    );


    assert.match(
      calls[0].sql,
      /s\.revoked_at\s+IS\s+NULL/i
    );


    assert.match(
      calls[0].sql,
      /s\.replaced_by_session_id\s+IS\s+NULL/i
    );


    assert.match(
      calls[0].sql,
      /s\.expires_at\s*>\s*\?1/i
    );


    assert.deepEqual(
      calls[0].args,
      [
        FIXED_NOW
      ]
    );
  }
);


await test(
  "FCM new-order data message contains only routing metadata",
  async () => {

    let capturedUrl =
      null;

    let capturedOptions =
      null;


    const fakeFetch =
      async (
        url,
        options
      ) => {

        capturedUrl =
          url;

        capturedOptions =
          options;


        return new Response(
          JSON.stringify(
            {
              name:
                "projects/test/messages/1"
            }
          ),
          {
            status:
              200,

            headers: {
              "Content-Type":
                "application/json"
            }
          }
        );
      };


    const result =
      await sendFirebaseDataMessage(
        {
          FIREBASE_PROJECT_ID:
            "transfer-servis-test"
        },
        "oauth-access-token",
        FCM_TOKEN,
        {
          type:
            "new_order",

          orderId:
            ORDER_ID,

          updatedAt:
            String(
              FIXED_NOW
            )
        },
        fakeFetch
      );


    assert.equal(
      result.ok,
      true
    );


    assert.match(
      capturedUrl,
      /fcm\.googleapis\.com\/v1\/projects\/transfer-servis-test\/messages:send$/
    );


    const body =
      JSON.parse(
        capturedOptions.body
      );


    assert.equal(
      body.message.token,
      FCM_TOKEN
    );


    assert.deepEqual(
      body.message.data,
      {
        type:
          "new_order",

        orderId:
          ORDER_ID,

        updatedAt:
          String(
            FIXED_NOW
          )
      }
    );


    assert.deepEqual(
      body.message.android,
      {
        priority:
          "high",

        ttl:
          "300s"
      }
    );


    assert.equal(
      "notification" in
        body.message,
      false
    );
  }
);


await test(
  "FCM UNREGISTERED response is classified without exposing token",
  async () => {

    const fakeFetch =
      async () =>
        new Response(
          JSON.stringify(
            {
              error: {
                code:
                  404,

                status:
                  "NOT_FOUND",

                details: [
                  {
                    "@type":
                      "type.googleapis.com/google.firebase.fcm.v1.FcmError",

                    errorCode:
                      "UNREGISTERED"
                  }
                ]
              }
            }
          ),
          {
            status:
              404,

            headers: {
              "Content-Type":
                "application/json"
            }
          }
        );


    const result =
      await sendFirebaseDataMessage(
        {
          FIREBASE_PROJECT_ID:
            "transfer-servis-test"
        },
        "oauth-access-token",
        FCM_TOKEN,
        {
          type:
            "new_order",

          orderId:
            ORDER_ID,

          updatedAt:
            String(
              FIXED_NOW
            )
        },
        fakeFetch
      );


    assert.deepEqual(
      result,
      {
        ok:
          false,

        status:
          404,

        errorCode:
          "UNREGISTERED"
      }
    );


    assert.equal(
      JSON.stringify(
        result
      )
        .includes(
          FCM_TOKEN
        ),
      false
    );
  }
);
