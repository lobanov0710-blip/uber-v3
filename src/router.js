import {
  json,
  cors,
  safeJson
} from "./core/utils.js";

import {
  hasRole
} from "./core/auth.js";

import {
  authenticateStaffRequest
} from "./core/staffAuthorization.js";

import {
  geoCalculate
} from "./core/geo.js";

import {
  calculatePrice,
  normalizeTariff
} from "./core/pricing.js";

import {
  createOrder,
  orderReceipt
} from "./core/orders.js";

import {
  createQuote,
  quoteReceipt
} from "./core/quotes.js";

import {
  getOrderById,
  listOrders
} from "./core/orderRepository.js";

import {
  verifyProxyRequest
} from "./core/proxyAuth.js";

import {
  requirePassengerOrderAccess,
  issuePassengerOrderAccess,
  verifyPassengerOrderAccess
} from "./core/passengerOrderAccess.js";

import {
  loginStaff,
  refreshStaff,
  logoutStaff
} from "./core/staffAuthService.js";

import {
  listStaffAccounts,
  createDriverAccount,
  changeDriverStatus,
  resetDriverPassword
} from "./core/staffAccountAdminService.js";

import {
  registerStaffPushDevice,
  unregisterStaffPushDevice
} from "./core/staffPushDeviceService.js";

import {
  exchangeDriverFirebaseSession
} from "./core/driverFirebaseSessionService.js";

import {
  createDriverVehicle,
  getDriverMe,
  patchDriverVehicle,
  putDriverRegistration
} from "./core/driverRegistrationService.js";

import {
  completeDriverPrivateUpload,
  issueDriverPrivateUpload,
  submitDriverRegistrationForReview
} from "./core/driverPrivateUploadService.js";

import {
  adminCan,
  requireOwner,
  resolveAdminAccess
} from "./core/adminAuthorization.js";

import {
  getAdminRegistrationQueue
} from "./core/adminRegistrationService.js";

import {
  completeAdminRegistrationReview,
  getAdminRegistrationReview,
  reviewAdminRegistrationItem,
  startAdminRegistrationReview
} from "./core/adminItemModerationService.js";

import {
  readAdminPrivateResource
} from "./core/adminPrivateResourceService.js";

import {
  assignOrderByAdmin,
  listDriverAssignments,
  reassignOrderByAdmin
} from "./core/orderAssignmentService.js";

import {
  putDriverAvailability
} from "./core/driverAvailabilityService.js";

import {
  changeDriverAssignmentPhase,
  createDriverTripVerificationChallenge
} from "./core/driverTripOperationalService.js";

import {
  transitionOrderTerminal
} from "./core/orderTerminalMutationService.js";

import {
  getAdminVehiclePhotoCheck,
  getDriverPhotoChecks,
  requestVehiclePhotoCheck,
  reviewAdminVehiclePhotoCheck
} from "./core/vehiclePhotoControlService.js";

import {
  postDriverSupportCase
} from "./core/driverSupportCaseService.js";


// =========================
// ROUTER
// =========================

export default async function router(
  req,
  env,
  executionContext = null
) {

  const url =
    new URL(
      req.url
    );

  const path =
    "/" +
    url.pathname.replace(
      /^\/+|\/+$/g,
      ""
    );


  // =========================
  // CORS PREFLIGHT
  // =========================

  if (
    req.method === "OPTIONS"
  ) {

    return new Response(
      null,
      {
        status: 204,
        headers: cors
      }
    );
  }


  // =========================
  // SAFE ERROR
  // =========================

  const safeError = (
    message,
    status = 500
  ) => {

    return json(
      {
        ok: false,
        error: message
      },
      status,
      cors
    );
  };


  // =========================
  // CLEAN INPUT
  // =========================

  function cleanText(
    value
  ) {

    return String(
      value || ""
    )
      .toLowerCase()
      .replace(
        /ё/g,
        "е"
      )
      .replace(
        /[^\p{L}\p{N}\s,.-]/gu,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .replace(
        /,+/g,
        ","
      )
      .trim();
  }


  // =========================
  // HEALTH
  // =========================

  if (
    path === "/"
  ) {

    return json(
      {
        ok: true,
        service:
          "uber-v3-pro"
      },
      200,
      cors
    );
  }


  // =========================
  // DRIVER FIREBASE SESSION EXCHANGE
  // =========================
  //
  // Public identity exchange endpoint.
  //
  // Trust boundary:
  // - Firebase ID token is verified server-side.
  // - phone/role/driverId from client are rejected.
  // - successful exchange returns the existing
  //   staff access + rotating refresh session.
  // =========================

  if (
    path ===
      "/v1/driver/session/exchange"
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      (
        "req_" +
        crypto.randomUUID()
      );


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await exchangeDriverFirebaseSession(
          env,
          body,
          {
            requestId,

            clientIp:
              req.headers.get(
                "CF-Connecting-IP"
              ),

            appCheckToken:
              req.headers.get(
                "X-Firebase-AppCheck"
              )
          }
        );


      if (
        result?.ok !==
          true
      ) {

        return json(
          {
            ok:
              false,

            error:
              result?.error ||
              "authentication failed",

            code:
              result?.code ||
              "driver_session_exchange_failed",

            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        result.created
          ? 201
          : 200,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "DRIVER FIREBASE SESSION EXCHANGE ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "authentication failed",

          code:
            "driver_session_exchange_failed",

          requestId
        },
        500,
        cors
      );

    } finally {

      // Reduce the lifetime of the raw
      // Firebase ID token in request scope.
      if (
        body
        &&
        typeof body ===
          "object"
        &&
        !Array.isArray(
          body
        )
        &&
        Object.hasOwn(
          body,
          "firebaseIdToken"
        )
      ) {

        body.firebaseIdToken =
          null;
      }
    }
  }


  // =========================
  // ADMIN SELF / AUTHORIZATION V1
  // =========================

  if (
    path === "/v1/admin/me"
  ) {

    if (
      req.method !== "GET"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }

    const requestId =
      "req_" +
      crypto.randomUUID();

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );

    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }

    try {

      const access =
        await resolveAdminAccess(
          env,
          auth.user
        );

      if (
        access?.ok !== true
      ) {
        return json(
          {
            ok: false,
            error:
              "forbidden",
            code:
              access?.code ||
              "admin_role_required",
            requestId
          },
          access?.status ||
            403,
          cors
        );
      }

      return json(
        {
          ok: true,
          admin: {
            accountId:
              access.accountId,
            role:
              access.role,
            permissions:
              access.permissions
          },
          requestId
        },
        200,
        cors
      );

    } catch (error) {

      console.error(
        "ADMIN ME ERROR"
      );

      return json(
        {
          ok: false,
          error:
            "admin authorization failed",
          code:
            "admin_authorization_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // ADMIN REGISTRATION MODERATION V1
  // =========================

  if (
    path ===
      "/v1/admin/registrations"
  ) {

    if (
      req.method !==
        "GET"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    try {

      const result =
        await getAdminRegistrationQueue(
          env,
          auth.user,
          {
            status:
              url.searchParams.get(
                "status"
              ),

            limit:
              url.searchParams.get(
                "limit"
              )
          }
        );


      if (
        result?.ok !==
          true
      ) {

        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN REGISTRATION QUEUE ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "registration queue failed",

          code:
            "registration_queue_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  const adminRegistrationDetailMatch =
    path.match(
      /^\/v1\/admin\/registrations\/([^/]+)$/
    );


  if (
    adminRegistrationDetailMatch
  ) {

    if (
      req.method !==
        "GET"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let driverId;


    try {

      driverId =
        decodeURIComponent(
          adminRegistrationDetailMatch[1]
        )
          .trim();

    } catch {

      driverId =
        "";
    }


    if (
      !/^staff_[A-Za-z0-9_-]{8,94}$/.test(
        driverId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_driver_id",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    try {

      const result =
        await getAdminRegistrationReview(
          env,
          auth.user,
          driverId
        );


      if (
        result?.ok !==
          true
      ) {

        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN REGISTRATION DETAIL ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "registration detail failed",

          code:
            "registration_detail_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  const adminRegistrationItemReviewMatch =
    path.match(
      /^\/v1\/admin\/registrations\/([^/]+)\/review\/items\/([^/]+)\/([^/]+)$/
    );


  if (
    adminRegistrationItemReviewMatch
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let driverId;
    let targetType;
    let targetId;


    try {

      driverId =
        decodeURIComponent(
          adminRegistrationItemReviewMatch[1]
        )
          .trim();

      targetType =
        decodeURIComponent(
          adminRegistrationItemReviewMatch[2]
        )
          .trim()
          .toLowerCase();

      targetId =
        decodeURIComponent(
          adminRegistrationItemReviewMatch[3]
        )
          .trim();

    } catch {

      driverId =
        "";

      targetType =
        "";

      targetId =
        "";
    }


    if (
      !/^staff_[A-Za-z0-9_-]{8,94}$/.test(
        driverId
      )
      ||
      ![
        "document",
        "vehicle",
        "vehicle_photo",
        "identity"
      ].includes(
        targetType
      )
      ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(
        targetId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_moderation_target",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await reviewAdminRegistrationItem(
          env,
          auth.user,
          driverId,
          targetType,
          targetId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN ITEM MODERATION ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "item moderation failed",

          code:
            "item_moderation_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  const adminRegistrationCompleteMatch =
    path.match(
      /^\/v1\/admin\/registrations\/([^/]+)\/review\/complete$/
    );


  if (
    adminRegistrationCompleteMatch
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let driverId;


    try {

      driverId =
        decodeURIComponent(
          adminRegistrationCompleteMatch[1]
        )
          .trim();

    } catch {

      driverId =
        "";
    }


    if (
      !/^staff_[A-Za-z0-9_-]{8,94}$/.test(
        driverId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_driver_id",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await completeAdminRegistrationReview(
          env,
          auth.user,
          driverId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN REGISTRATION COMPLETE ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "registration completion failed",

          code:
            "registration_completion_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  const adminRegistrationReviewMatch =
    path.match(
      /^\/v1\/admin\/registrations\/([^/]+)\/review$/
    );


  if (
    adminRegistrationReviewMatch
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let driverId;


    try {

      driverId =
        decodeURIComponent(
          adminRegistrationReviewMatch[1]
        )
          .trim();

    } catch {

      driverId =
        "";
    }


    if (
      !/^staff_[A-Za-z0-9_-]{8,94}$/.test(
        driverId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_driver_id",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await startAdminRegistrationReview(
          env,
          auth.user,
          driverId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      if (
        result?.ok !==
          true
      ) {

        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN REGISTRATION REVIEW ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "registration review failed",

          code:
            "registration_review_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  const adminPrivateResourceMatch =
    path.match(
      /^\/v1\/admin\/registrations\/([^/]+)\/resources\/(document|vehicle_photo)\/([^/]+)$/
    );


  if (
    adminPrivateResourceMatch
  ) {

    if (
      req.method !==
        "GET"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let driverId;
    let resourceType;
    let resourceId;


    try {

      driverId =
        decodeURIComponent(
          adminPrivateResourceMatch[1]
        )
          .trim();

      resourceType =
        decodeURIComponent(
          adminPrivateResourceMatch[2]
        )
          .trim()
          .toLowerCase();

      resourceId =
        decodeURIComponent(
          adminPrivateResourceMatch[3]
        )
          .trim();

    } catch {

      driverId =
        "";

      resourceType =
        "";

      resourceId =
        "";
    }


    if (
      !/^staff_[A-Za-z0-9_-]{8,94}$/.test(
        driverId
      )
      ||
      !/^[A-Za-z0-9_-]{8,120}$/.test(
        resourceId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_private_resource",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    try {

      const result =
        await readAdminPrivateResource(
          env,
          auth.user,
          {
            driverId,
            resourceType,
            resourceId
          },
          {
            requestId
          }
        );


      if (
        result?.ok !==
          true
      ) {

        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return new Response(
        result.resource.body,
        {
          status:
            200,

          headers: {
            "Content-Type":
              result.resource
                .contentType,

            "Cache-Control":
              "no-store, private",

            "Pragma":
              "no-cache",

            "X-Content-Type-Options":
              "nosniff",

            "Content-Disposition":
              "inline",

            "Content-Security-Policy":
              "default-src 'none'; sandbox",

            "Referrer-Policy":
              "no-referrer",

            "X-Request-Id":
              requestId
          }
        }
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN PRIVATE RESOURCE READ ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "private resource read failed",

          code:
            "private_resource_read_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // ADMIN ORDER ASSIGNMENT V1
  // =========================

  const adminOrderAssignmentMatch =
    path.match(
      /^\/v1\/admin\/orders\/([^/]+)\/(assign|reassign)$/
    );


  if (
    adminOrderAssignmentMatch
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let orderId;
    let action;


    try {

      orderId =
        decodeURIComponent(
          adminOrderAssignmentMatch[1]
        )
          .trim();

      action =
        adminOrderAssignmentMatch[2];

    } catch {

      orderId =
        "";

      action =
        "";
    }


    if (
      !/^[A-Za-z0-9_-]{8,120}$/.test(
        orderId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_order_id",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const service =
        action ===
          "assign"
          ? assignOrderByAdmin
          : reassignOrderByAdmin;


      const result =
        await service(
          env,
          auth.user,
          orderId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              ),

            schedule:
              executionContext
              &&
              typeof executionContext.waitUntil ===
                "function"
                ? promise =>
                    executionContext.waitUntil(
                      promise
                    )
                : null
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "ADMIN ORDER ASSIGNMENT ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "order assignment failed",

          code:
            "order_assignment_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // ADMIN VEHICLE PHOTO CONTROL V1
  // =========================

  const adminVehiclePhotoCheckReviewMatch =
    path.match(
      /^\/v1\/admin\/vehicles\/([^/]+)\/photo-checks\/([^/]+)\/review$/
    );


  if (
    adminVehiclePhotoCheckReviewMatch
  ) {

    if (
      req.method !== "POST"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          requestId
        },
        auth?.status || 401,
        cors
      );
    }


    let vehicleId;
    let photoCheckId;

    try {
      vehicleId =
        decodeURIComponent(
          adminVehiclePhotoCheckReviewMatch[1]
        )
          .trim();

      photoCheckId =
        decodeURIComponent(
          adminVehiclePhotoCheckReviewMatch[2]
        )
          .trim();

    } catch {
      vehicleId = "";
      photoCheckId = "";
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await reviewAdminVehiclePhotoCheck(
          env,
          auth.user,
          vehicleId,
          photoCheckId,
          body,
          {
            requestId,
            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status || 500,
        cors
      );

    } catch {

      console.error(
        "ADMIN VEHICLE PHOTO CHECK REVIEW ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "vehicle photo check review failed",
          code:
            "vehicle_photo_check_review_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  const adminVehiclePhotoCheckReadMatch =
    path.match(
      /^\/v1\/admin\/vehicles\/([^/]+)\/photo-checks\/([^/]+)$/
    );


  if (
    adminVehiclePhotoCheckReadMatch
  ) {

    if (
      req.method !== "GET"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          requestId
        },
        auth?.status || 401,
        cors
      );
    }


    let vehicleId;
    let photoCheckId;

    try {
      vehicleId =
        decodeURIComponent(
          adminVehiclePhotoCheckReadMatch[1]
        )
          .trim();

      photoCheckId =
        decodeURIComponent(
          adminVehiclePhotoCheckReadMatch[2]
        )
          .trim();

    } catch {
      vehicleId = "";
      photoCheckId = "";
    }


    try {

      const result =
        await getAdminVehiclePhotoCheck(
          env,
          auth.user,
          vehicleId,
          photoCheckId
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status || 500,
        cors
      );

    } catch {

      console.error(
        "ADMIN VEHICLE PHOTO CHECK READ ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "vehicle photo check read failed",
          code:
            "vehicle_photo_check_read_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  const adminVehiclePhotoCheckMatch =
    path.match(
      /^\/v1\/admin\/vehicles\/([^/]+)\/photo-checks$/
    );


  if (
    adminVehiclePhotoCheckMatch
  ) {

    if (
      req.method !== "POST"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          requestId
        },
        auth?.status || 401,
        cors
      );
    }


    let vehicleId;

    try {
      vehicleId =
        decodeURIComponent(
          adminVehiclePhotoCheckMatch[1]
        )
          .trim();
    } catch {
      vehicleId = "";
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await requestVehiclePhotoCheck(
          env,
          auth.user,
          vehicleId,
          body,
          {
            requestId,
            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 201
          : result?.status || 500,
        cors
      );

    } catch {

      console.error(
        "ADMIN VEHICLE PHOTO CHECK ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "vehicle photo check failed",
          code:
            "vehicle_photo_check_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER PHOTO CONTROLS V1
  // =========================

  if (
    path ===
      "/v1/driver/photo-checks"
  ) {

    if (
      req.method !== "GET"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          requestId
        },
        auth?.status || 401,
        cors
      );
    }


    try {

      const result =
        await getDriverPhotoChecks(
          env,
          auth.user
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status || 500,
        cors
      );

    } catch {

      console.error(
        "DRIVER PHOTO CONTROLS ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "driver photo controls failed",
          code:
            "driver_photo_controls_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER ASSIGNMENTS V1
  // =========================

  if (
    path ===
      "/v1/driver/assignments"
  ) {

    if (
      req.method !==
        "GET"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    try {

      const result =
        await listDriverAssignments(
          env,
          auth.user,
          {
            limit:
              url.searchParams.get(
                "limit"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "DRIVER ASSIGNMENTS ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "driver assignments failed",

          code:
            "driver_assignments_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER SUPPORT CASES V1
  // =========================

  if (
    path ===
      "/v1/driver/support-cases"
  ) {

    if (
      req.method !== "POST"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          requestId
        },
        auth?.status || 401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await postDriverSupportCase(
          env,
          auth.user,
          body,
          {
            requestId,
            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 201
          : result?.status || 500,
        cors
      );

    } catch {

      console.error(
        "DRIVER SUPPORT CASE ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "support case failed",
          code:
            "support_case_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER AVAILABILITY V1
  // =========================

  if (
    path ===
      "/v1/driver/availability"
  ) {

    if (
      req.method !==
        "PUT"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await putDriverAvailability(
          env,
          auth.user,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "DRIVER AVAILABILITY ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "driver availability failed",

          code:
            "driver_availability_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER TRIP VERIFICATION / PHASE V1
  // =========================

  const driverVerificationChallengeMatch =
    path.match(
      /^\/v1\/driver\/assignments\/([^/]+)\/verification-challenges$/
    );


  if (
    driverVerificationChallengeMatch
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let assignmentId;


    try {

      assignmentId =
        decodeURIComponent(
          driverVerificationChallengeMatch[1]
        )
          .trim();

    } catch {

      assignmentId =
        "";
    }


    if (
      !/^assignment_[A-Za-z0-9_-]{8,100}$/.test(
        assignmentId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_assignment_id",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await createDriverTripVerificationChallenge(
          env,
          auth.user,
          assignmentId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 201
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "DRIVER TRIP VERIFICATION CHALLENGE ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "trip verification challenge failed",

          code:
            "trip_verification_challenge_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  const driverAssignmentPhaseMatch =
    path.match(
      /^\/v1\/driver\/assignments\/([^/]+)\/phase$/
    );


  if (
    driverAssignmentPhaseMatch
  ) {

    if (
      req.method !==
        "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    let assignmentId;


    try {

      assignmentId =
        decodeURIComponent(
          driverAssignmentPhaseMatch[1]
        )
          .trim();

    } catch {

      assignmentId =
        "";
    }


    if (
      !/^assignment_[A-Za-z0-9_-]{8,100}$/.test(
        assignmentId
      )
    ) {

      return json(
        {
          ok:
            false,

          error:
            "invalid request",

          code:
            "invalid_assignment_id",

          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !==
        true
    ) {

      return json(
        {
          ok:
            false,

          error:
            auth?.error ||
            "authorization required",

          code:
            "authorization_required",

          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await changeDriverAssignmentPhase(
          env,
          auth.user,
          assignmentId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch (
      error
    ) {

      console.error(
        "DRIVER ASSIGNMENT PHASE ERROR"
      );


      return json(
        {
          ok:
            false,

          error:
            "assignment phase failed",

          code:
            "assignment_phase_failed",

          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER SELF-SERVICE V1
  // =========================

  if (
    path === "/v1/driver/me"
  ) {

    if (req.method !== "GET") {
      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (auth?.ok !== true) {

      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    try {

      const result =
        await getDriverMe(
          env,
          auth.user
        );


      if (result?.ok !== true) {

        return json(
          {
            ok: false,
            error:
              result?.error ||
              "driver request failed",
            code:
              result?.code ||
              "driver_request_failed",
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER ME ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "driver request failed",
          code:
            "driver_request_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  if (
    path ===
      "/v1/driver/registration"
  ) {

    if (req.method !== "PUT") {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (auth?.ok !== true) {

      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await putDriverRegistration(
          env,
          auth.user,
          body
        );


      if (result?.ok !== true) {

        return json(
          {
            ok: false,
            error:
              result?.error ||
              "driver registration failed",
            code:
              result?.code ||
              "driver_registration_failed",
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER REGISTRATION UPDATE ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "driver registration failed",
          code:
            "driver_registration_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  if (
    path === "/v1/driver/vehicles"
  ) {

    if (req.method !== "POST") {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (auth?.ok !== true) {

      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await createDriverVehicle(
          env,
          auth.user,
          body
        );


      if (result?.ok !== true) {

        return json(
          {
            ok: false,
            error:
              result?.error ||
              "vehicle request failed",
            code:
              result?.code ||
              "vehicle_request_failed",
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        201,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER VEHICLE CREATE ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "vehicle request failed",
          code:
            "vehicle_request_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  const driverVehicleMatch =
    path.match(
      /^\/v1\/driver\/vehicles\/([^/]+)$/
    );


  if (
    driverVehicleMatch
  ) {

    if (req.method !== "PATCH") {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const vehicleId =
      decodeURIComponent(
        driverVehicleMatch[1]
      );


    if (
      !/^vehicle_[0-9a-f-]{36}$/i.test(
        vehicleId
      )
    ) {

      return json(
        {
          ok: false,
          error:
            "invalid request",
          code:
            "invalid_vehicle_id",
          requestId
        },
        400,
        cors
      );
    }


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (auth?.ok !== true) {

      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await patchDriverVehicle(
          env,
          auth.user,
          vehicleId,
          body
        );


      if (result?.ok !== true) {

        return json(
          {
            ok: false,
            error:
              result?.error ||
              "vehicle request failed",
            code:
              result?.code ||
              "vehicle_request_failed",
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }


      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER VEHICLE UPDATE ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "vehicle request failed",
          code:
            "vehicle_request_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // DRIVER PRIVATE UPLOADS
  // =========================

  if (
    path === "/v1/driver/uploads"
  ) {

    if (
      req.method !== "POST"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }

    const requestId =
      "req_" +
      crypto.randomUUID();

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );

    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }

    const body =
      await safeJson(
        req
      );

    try {

      const result =
        await issueDriverPrivateUpload(
          env,
          auth.user,
          body,
          {
            requestId
          }
        );

      if (
        result?.ok !== true
      ) {
        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }

      return json(
        {
          ...result,
          requestId
        },
        201,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER UPLOAD ISSUE ERROR"
      );

      return json(
        {
          ok: false,
          error:
            "upload request failed",
          code:
            "upload_request_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  const driverUploadMatch =
    path.match(
      /^\/v1\/driver\/uploads\/([^/]+)$/
    );


  if (
    driverUploadMatch
  ) {

    if (
      req.method !== "PUT"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }

    const requestId =
      "req_" +
      crypto.randomUUID();

    let uploadId;

    try {
      uploadId =
        decodeURIComponent(
          driverUploadMatch[1]
        )
          .trim();
    } catch {
      uploadId =
        "";
    }

    if (
      !/^upload_[0-9a-f-]{36}$/i.test(
        uploadId
      )
    ) {
      return json(
        {
          ok: false,
          error:
            "invalid request",
          code:
            "invalid_upload_id",
          requestId
        },
        400,
        cors
      );
    }

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );

    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }

    const configuredLimit =
      Number(
        env?.DRIVER_UPLOAD_MAX_BYTES
      );

    if (
      !Number.isSafeInteger(
        configuredLimit
      ) ||
      configuredLimit <= 0
    ) {
      return json(
        {
          ok: false,
          error:
            "service unavailable",
          code:
            "driver_upload_limit_not_configured",
          requestId
        },
        503,
        cors
      );
    }

    const declaredLength =
      Number(
        req.headers.get(
          "Content-Length"
        )
      );

    if (
      !Number.isSafeInteger(
        declaredLength
      ) ||
      declaredLength <= 0
    ) {
      return json(
        {
          ok: false,
          error:
            "invalid request",
          code:
            "content_length_required",
          requestId
        },
        400,
        cors
      );
    }

    if (
      declaredLength >
        configuredLimit
    ) {
      return json(
        {
          ok: false,
          error:
            "invalid request",
          code:
            "invalid_upload_size",
          requestId
        },
        413,
        cors
      );
    }

    let bodyBytes;

    try {
      bodyBytes =
        await req.arrayBuffer();
    } catch {
      return json(
        {
          ok: false,
          error:
            "invalid request",
          code:
            "invalid_upload_body",
          requestId
        },
        400,
        cors
      );
    }

    if (
      bodyBytes.byteLength !==
        declaredLength
    ) {
      return json(
        {
          ok: false,
          error:
            "invalid request",
          code:
            "content_length_mismatch",
          requestId
        },
        400,
        cors
      );
    }

    try {

      const result =
        await completeDriverPrivateUpload(
          env,
          auth.user,
          uploadId,
          {
            contentType:
              req.headers.get(
                "Content-Type"
              ),

            bodyBytes,

            requestId
          }
        );

      if (
        result?.ok !== true
      ) {
        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }

      return json(
        {
          ...result,
          requestId
        },
        201,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER PRIVATE UPLOAD ERROR"
      );

      return json(
        {
          ok: false,
          error:
            "upload failed",
          code:
            "upload_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  if (
    path ===
      "/v1/driver/registration/submit"
  ) {

    if (
      req.method !== "POST"
    ) {
      return safeError(
        "method not allowed",
        405
      );
    }

    const requestId =
      "req_" +
      crypto.randomUUID();

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );

    if (
      auth?.ok !== true
    ) {
      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          code:
            "authorization_required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }

    const body =
      await safeJson(
        req
      );

    try {

      const result =
        await submitDriverRegistrationForReview(
          env,
          auth.user,
          body,
          {
            requestId
          }
        );

      if (
        result?.ok !== true
      ) {
        return json(
          {
            ...result,
            requestId
          },
          result?.status ||
            500,
          cors
        );
      }

      return json(
        {
          ...result,
          requestId
        },
        200,
        cors
      );

    } catch (error) {

      console.error(
        "DRIVER REGISTRATION SUBMIT ERROR"
      );

      return json(
        {
          ok: false,
          error:
            "registration submit failed",
          code:
            "registration_submit_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


    // =========================
  // STAFF LOGIN
  // =========================
  //
  // Public authentication endpoint.
  //
  // This endpoint does NOT use:
  //
  // - passenger proxy HMAC
  // - passenger capability token
  // - existing staff JWT
  //
  // Credentials are verified against
  // authoritative staff_accounts in D1.
  // =========================

  if (
    path === "/staff/login"
  ) {

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await loginStaff(
          env,
          body
        );


      if (
        result?.ok !== true
      ) {

        return safeError(
          result?.error ||
            "authentication failed",

          result?.status ||
            401
        );
      }


      return json(
        result,
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error("STAFF LOGIN ERROR:");


      return safeError(
        "staff authentication failed",
        500
      );
    }
  }


  // =========================
  // STAFF REFRESH
  // =========================
  //
  // Possession of the current refresh
  // token authorizes refresh.
  //
  // Refresh-token plaintext is never
  // persisted in D1.
  //
  // Successful refresh rotates the token.
  // =========================

  if (
    path === "/staff/refresh"
  ) {

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await refreshStaff(
          env,
          body?.refreshToken
        );


      if (
        result?.ok !== true
      ) {

        return safeError(
          result?.error ||
            "invalid refresh token",

          result?.status ||
            401
        );
      }


      return json(
        result,
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error("STAFF REFRESH ERROR:");


      return safeError(
        "staff refresh failed",
        500
      );
    }
  }


  // =========================
  // STAFF LOGOUT
  // =========================
  //
  // Logout is intentionally idempotent.
  //
  // An unknown or malformed refresh token
  // does not reveal session existence.
  // =========================

  if (
    path === "/staff/logout"
  ) {

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      await logoutStaff(
        env,
        body?.refreshToken
      );


      return json(
        {
          ok: true
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error("STAFF LOGOUT ERROR:");


      return safeError(
        "staff logout failed",
        500
      );
    }
  }


  // =========================
  // STAFF PUSH DEVICE
  // =========================
  //
  // Private authenticated staff API.
  //
  // PUT:
  // register/update this application
  // installation and its current FCM token.
  //
  // DELETE:
  // remove this application installation
  // for the authenticated staff account.
  //
  // account_id and session_family_id are
  // never accepted from the client.
  // They come from authoritative D1-backed
  // staff authorization.
  // =========================

  if (
    path === "/staff/push-device"
  ) {

    if (
      req.method !== "PUT"
      &&
      req.method !== "DELETE"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    // =======================
    // STAFF AUTHENTICATION
    // =======================

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {

      return safeError(
        auth?.error ||
          "authorization required",

        auth?.status ||
          401
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        req.method === "PUT"
          ? await registerStaffPushDevice(
              env,
              auth,
              body
            )
          : await unregisterStaffPushDevice(
              env,
              auth,
              body
            );


      if (
        result?.ok !== true
      ) {

        return safeError(
          result?.error ||
            "staff push device request failed",

          result?.status ||
            500
        );
      }


      return json(
        {
          ok: true
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      // Never attach the thrown object here:
      // a provider/database error must not
      // accidentally serialize sensitive
      // FCM routing data.
      console.error(
        "STAFF PUSH DEVICE ERROR"
      );


      return safeError(
        "staff push device request failed",
        500
      );

    } finally {

      // Reduce FCM token lifetime in this
      // request scope. It must never be
      // logged or returned by the API.
      if (
        body
        &&
        typeof body === "object"
        &&
        !Array.isArray(
          body
        )
        &&
        Object.hasOwn(
          body,
          "token"
        )
      ) {

        body.token =
          null;
      }
    }
  }


    // =========================
  // STAFF ACCOUNT MANAGEMENT
  // =========================
  //
  // ARCH-10
  //
  // Private admin-only API.
  //
  // Authentication:
  //
  // Authorization: Bearer <staff JWT>
  //
  // authenticateStaffRequest() additionally
  // verifies authoritative D1 account and
  // session state.
  //
  // Passenger HMAC/capability credentials
  // are not valid for these endpoints.
  // =========================


  // =========================
  // GET /staff/accounts
  // POST /staff/accounts
  // =========================

  if (
    path === "/staff/accounts"
  ) {

    if (
      req.method !== "GET"
      &&
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    // =======================
    // STAFF AUTHENTICATION
    // =======================

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {

      return safeError(
        auth?.error ||
          "authorization required",

        auth?.status ||
          401
      );
    }


    // =======================
    // OWNER / PERMISSION
    // =======================

    let adminAccess;

    try {
      adminAccess =
        await resolveAdminAccess(
          env,
          auth.user
        );
    } catch {
      return safeError(
        "admin authorization failed",
        500
      );
    }

    if (
      adminAccess?.ok !== true
    ) {
      return safeError(
        "forbidden",
        403
      );
    }


    // =======================
    // LIST ACCOUNTS
    // =======================

    if (
      req.method === "GET"
    ) {

      if (
        !adminCan(
          adminAccess,
          "drivers.read"
        )
      ) {
        return safeError(
          "forbidden",
          403
        );
      }

      try {

        const result =
          await listStaffAccounts(
            env,
            auth.user
          );


        if (
          result?.ok !== true
        ) {

          return safeError(
            result?.error ||
              "staff account request failed",

            result?.status ||
              500
          );
        }


        return json(
          {
            ok: true,

            count:
              result.count,

            staff:
              result.staff
          },
          200,
          cors
        );

      } catch (
        error
      ) {

        console.error("STAFF ACCOUNT LIST ERROR:");


        return safeError(
          "staff account request failed",
          500
        );
      }
    }


    // =======================
    // CREATE DRIVER (LEGACY, OWNER ONLY)
    // =======================

    if (
      requireOwner(
        adminAccess
      ).ok !== true
    ) {
      return safeError(
        "forbidden",
        403
      );
    }

    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await createDriverAccount(
          env,
          auth.user,
          body
        );


      if (
        result?.ok !== true
      ) {

        return safeError(
          result?.error ||
            "staff account creation failed",

          result?.status ||
            500
        );
      }


      return json(
        {
          ok: true,

          staff:
            result.staff
        },
        201,
        cors
      );

    } catch (
      error
    ) {

      console.error("STAFF ACCOUNT CREATE ERROR:");


      return safeError(
        "staff account creation failed",
        500
      );

    } finally {

      // Reduce plaintext password lifetime
      // in this request scope.
      if (
        body
        &&
        typeof body === "object"
        &&
        !Array.isArray(
          body
        )
        &&
        Object.hasOwn(
          body,
          "password"
        )
      ) {

        body.password =
          null;
      }
    }
  }


  // =========================
  // PATCH
  // /staff/accounts/{id}/status
  // =========================

  const staffStatusMatch =
    path.match(
      /^\/staff\/accounts\/([^/]+)\/status$/
    );


  if (
    staffStatusMatch
  ) {

    if (
      req.method !== "PATCH"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    // =======================
    // STAFF AUTHENTICATION
    // =======================

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {

      return safeError(
        auth?.error ||
          "authorization required",

        auth?.status ||
          401
      );
    }


    // =======================
    // OWNER ONLY
    // =======================

    let adminAccess;

    try {
      adminAccess =
        await resolveAdminAccess(
          env,
          auth.user
        );
    } catch {
      return safeError(
        "admin authorization failed",
        500
      );
    }

    if (
      requireOwner(
        adminAccess
      ).ok !== true
    ) {
      return safeError(
        "forbidden",
        403
      );
    }


    // =======================
    // ACCOUNT ID
    // =======================

    let accountId;


    try {

      accountId =
        decodeURIComponent(
          staffStatusMatch[1]
        )
          .trim();

    } catch (
      error
    ) {

      return safeError(
        "invalid staff account id",
        400
      );
    }


    if (!accountId) {

      return safeError(
        "invalid staff account id",
        400
      );
    }


    // =======================
    // BODY
    // =======================

    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await changeDriverStatus(
          env,
          auth.user,
          accountId,
          body
        );


      if (
        result?.ok !== true
      ) {

        return safeError(
          result?.error ||
            "staff account update failed",

          result?.status ||
            500
        );
      }


      return json(
        {
          ok: true,

          changed:
            result.changed,

          staff:
            result.staff
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error("STAFF ACCOUNT STATUS ERROR:");


      return safeError(
        "staff account update failed",
        500
      );
    }
  }


  // =========================
  // POST
  // /staff/accounts/{id}/password-reset
  // =========================

  const staffPasswordResetMatch =
    path.match(
      /^\/staff\/accounts\/([^/]+)\/password-reset$/
    );


  if (
    staffPasswordResetMatch
  ) {

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    // =======================
    // STAFF AUTHENTICATION
    // =======================

    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {

      return safeError(
        auth?.error ||
          "authorization required",

        auth?.status ||
          401
      );
    }


    // =======================
    // OWNER ONLY
    // =======================

    let adminAccess;

    try {
      adminAccess =
        await resolveAdminAccess(
          env,
          auth.user
        );
    } catch {
      return safeError(
        "admin authorization failed",
        500
      );
    }

    if (
      requireOwner(
        adminAccess
      ).ok !== true
    ) {
      return safeError(
        "forbidden",
        403
      );
    }


    // =======================
    // ACCOUNT ID
    // =======================

    let accountId;


    try {

      accountId =
        decodeURIComponent(
          staffPasswordResetMatch[1]
        )
          .trim();

    } catch (
      error
    ) {

      return safeError(
        "invalid staff account id",
        400
      );
    }


    if (!accountId) {

      return safeError(
        "invalid staff account id",
        400
      );
    }


    // =======================
    // BODY
    // =======================

    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await resetDriverPassword(
          env,
          auth.user,
          accountId,
          body
        );


      if (
        result?.ok !== true
      ) {

        return safeError(
          result?.error ||
            "staff password reset failed",

          result?.status ||
            500
        );
      }


      return json(
        {
          ok: true,

          staff:
            result.staff
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error("STAFF PASSWORD RESET ERROR:");


      return safeError(
        "staff password reset failed",
        500
      );

    } finally {

      // Do not retain the plaintext password
      // in the router request object longer
      // than required.
      if (
        body
        &&
        typeof body === "object"
        &&
        !Array.isArray(
          body
        )
        &&
        Object.hasOwn(
          body,
          "password"
        )
      ) {

        body.password =
          null;
      }
    }
  }


  // =========================
  // DISABLED LEGACY ENDPOINTS
  // =========================
  //
  // Legacy driver authentication remains
  // disabled.
  //
  // Staff authentication is provided only
  // through the D1-backed staff API.
  //
  // There is intentionally NO public
  // staff/register endpoint.
  // =========================

  const disabledLegacyPaths =
    new Set([
      "/ws",
      "/drivers/register",
      "/drivers/login",
      "/stats"
    ]);


  if (
    disabledLegacyPaths.has(
      path
    )
  ) {

    return safeError(
      "not found",
      404
    );
  }


  // =========================
  // CALCULATE
  // =========================

  if (
    path === "/calculate"
  ) {

    // =========================
    // METHOD
    // =========================

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }
      const proxyAuth =
    await verifyProxyRequest(
      req,
      env,
      "/calculate"
    );

  if (
    proxyAuth.ok !== true
  ) {

    return safeError(
      proxyAuth.error,
      proxyAuth.status
    );
  }


    // =========================
    // BODY
    // =========================

    const body =
      await safeJson(
        req
      );


    // =========================
    // REQUIRED
    // =========================

    if (
      !body?.from ||
      !body?.to
    ) {

      return safeError(
        "missing from/to",
        400
      );
    }


    // =========================
    // ADDRESSES
    // =========================

    const from =
      cleanText(
        body.from
      );

    const to =
      cleanText(
        body.to
      );

    if (
      from.length < 3 ||
      to.length < 3
    ) {

      return safeError(
        "address too short",
        400
      );
    }


    // =========================
    // TARIFF
    // =========================

    const tariff =
      normalizeTariff(
        body.tariff
      );

    if (
      !tariff
    ) {

      return safeError(
        "invalid tariff",
        400
      );
    }


    try {

      // =========================
      // GEO
      // =========================

      const geoResult =
        await geoCalculate(
          {
            from,
            to
          },
          env
        );


      if (
        !geoResult
      ) {

        return safeError(
          "geo failed",
          500
        );
      }


      if (
        geoResult.ok !== true
      ) {

        return json(
          geoResult,
          400,
          cors
        );
      }


      // =========================
      // ROUTE
      // =========================

      if (
        !geoResult.route ||
        !Array.isArray(
          geoResult.route
            .coordinates
        ) ||
        geoResult.route
          .coordinates
          .length < 2
      ) {

        return safeError(
          "empty route",
          404
        );
      }


      // =========================
      // DISTANCE
      // =========================

      const distance =
        Number(
          geoResult.distance
        );

      if (
        !Number.isFinite(
          distance
        ) ||
        distance <= 0
      ) {

        return safeError(
          "invalid route distance",
          404
        );
      }


      // =========================
      // DURATION
      // =========================

      const duration =
        Number(
          geoResult.duration
        );

      if (
        !Number.isFinite(
          duration
        ) ||
        duration <= 0
      ) {

        return safeError(
          "invalid route duration",
          404
        );
      }


      // =========================
      // SERVER PRICING
      // =========================

      const pricing =
        calculatePrice(
          distance,
          tariff
        );

      if (
        !pricing.ok
      ) {

        return safeError(
          pricing.error ||
            "price calculation failed",
          400
        );
      }


      // =========================
      // SERVER QUOTE
      // =========================

      const quote =
        await createQuote(
          env,
          {
            from:
              geoResult.from,

            to:
              geoResult.to,

            tariff:
              pricing.tariff,

            tariffName:
              pricing.tariffName,

            distance,

            duration,

            price:
              pricing.price,

            pricePerKm:
              pricing.pricePerKm,

            coefficient:
              pricing.coefficient,

            minimumPrice:
              pricing.minimumPrice
          }
        );


      const receipt =
        quoteReceipt(
          quote
        );


      // =========================
      // RESPONSE
      // =========================

      return json(
        {
          ok: true,

          quoteId:
            receipt.quoteId,

          quoteExpiresAt:
            receipt.expiresAt,

          from:
            geoResult.from,

          to:
            geoResult.to,

          tariff:
            pricing.tariff,

          tariffName:
            pricing.tariffName,

          distance,

          duration,

          price:
            pricing.price,

          pricing: {

            pricePerKm:
              pricing.pricePerKm,

            coefficient:
              pricing.coefficient,

            minimumPrice:
              pricing.minimumPrice
          },

          route:
            geoResult.route
        },
        200,
        cors
      );

    } catch (
      error
    ) {

      console.error("ROUTE CALCULATE ERROR:");

      return safeError(
        "route calculation failed",
        500
      );
    }
  }


    // =========================
  // PUBLIC STAFF ORDER TERMINAL MUTATION
  // =========================
  //
  // POST /orders/{orderId}/status
  //
  // Driver:
  //   in_progress -> done
  //
  // Admin with orders.cancel:
  //   new/taken/in_progress -> canceled
  //
  // D3 hardening:
  // - mandatory Idempotency-Key
  // - mandatory expectedRevision
  // - atomic order + assignment + audit
  // - idempotent result replay
  // =========================

  const orderTransitionMatch =
    path.match(
      /^\/orders\/([^/]+)\/status$/
    );


  if (
    orderTransitionMatch
  ) {

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    const requestId =
      "req_" +
      crypto.randomUUID();


    const auth =
      await authenticateStaffRequest(
        req,
        env
      );


    if (
      auth?.ok !== true
    ) {

      return json(
        {
          ok: false,
          error:
            auth?.error ||
            "authorization required",
          requestId
        },
        auth?.status ||
          401,
        cors
      );
    }


    let orderId;


    try {

      orderId =
        decodeURIComponent(
          orderTransitionMatch[1]
        )
          .trim();

    } catch {

      orderId =
        "";
    }


    if (!orderId) {

      return json(
        {
          ok: false,
          error:
            "invalid order id",
          code:
            "invalid_order_id",
          requestId
        },
        400,
        cors
      );
    }


    const body =
      await safeJson(
        req
      );


    try {

      const result =
        await transitionOrderTerminal(
          env,
          auth.user,
          orderId,
          body,
          {
            requestId,

            idempotencyKey:
              req.headers.get(
                "Idempotency-Key"
              )
          }
        );


      return json(
        {
          ...result,
          requestId
        },
        result?.ok === true
          ? 200
          : result?.status ||
            500,
        cors
      );

    } catch {

      console.error(
        "ORDER TERMINAL MUTATION ERROR"
      );


      return json(
        {
          ok: false,
          error:
            "order transition failed",
          code:
            "order_terminal_mutation_failed",
          requestId
        },
        500,
        cors
      );
    }
  }


  // =========================
  // ORDERS
  // =========================

  if (
    path === "/orders"
  ) {

    // =========================
// POST /orders
// PUBLIC GATEWAY
// =========================
//
// Создание заявки.
//
// Если передан quoteId,
// доверенные route / tariff /
// distance / duration / price
// загружаются внутри createOrder()
// только из authoritative D1 quote.
//
// Клиентские значения цены,
// тарифа и параметров маршрута
// не являются доверенными.
// =========================

        if (
      req.method === "POST"
    ) {

      // =========================
      // PROXY AUTH
      // =========================

      const proxyAuth =
        await verifyProxyRequest(
          req,
          env,
          "/orders"
        );


      if (
        proxyAuth.ok !== true
      ) {

        return safeError(
          proxyAuth.error,
          proxyAuth.status
        );
      }


      // =========================
      // PASSENGER ACCESS CONFIG
      // =========================
      //
      // Проверяем конфигурацию ДО
      // создания D1-order.
      //
      // Новый заказ не должен быть
      // создан, если клиенту нельзя
      // безопасно выдать accessToken.
      // =========================

      try {

        requirePassengerOrderAccess(
          env
        );

      } catch (
        error
      ) {

        console.error(
          "PASSENGER ORDER ACCESS CONFIG ERROR"
        );

        return safeError(
          "order access unavailable",
          500
        );
      }


      // =========================
      // BODY
      // =========================

      const body =
        await safeJson(
          req
        );


      try {

        // =========================
        // CREATE ORDER
        // =========================

        const result =
          await createOrder(
            body,
            env
          );


        if (
          !result.ok
        ) {

          return safeError(
            result.error ||
              "invalid order",

            result.status ||
              400
          );
        }


        // =========================
        // PASSENGER ACCESS TOKEN
        // =========================

        const passengerAccess =
          await issuePassengerOrderAccess(
            env,
            result.order
          );


        // Driver notifications are assignment-scoped.
        // Creating an unassigned order must not wake any Driver.


        // =========================
        // RESPONSE
        // =========================

        return json(
          {
            ok: true,

            order:
              orderReceipt(
                result.order
              ),

            accessToken:
              passengerAccess
                .accessToken,

            accessExpiresAt:
              passengerAccess
                .accessExpiresAt
          },
          201,
          cors
        );

      } catch (
        error
      ) {

        console.error("ORDER CREATE ERROR:");

        return safeError(
          "order create failed",
          500
        );
      }
    }


    // =========================
    // GET /orders
    // PRIVATE
    // =========================

    if (
      req.method === "GET"
    ) {

            // =========================
      // STAFF AUTHORIZATION
      // =========================
      //
      // Staff access is authoritative
      // against D1 account + session.
      //
      // Legacy role-only JWTs and
      // DRIVERS KV are not authorization
      // mechanisms here anymore.
      // =========================

      const auth =
        await authenticateStaffRequest(
          req,
          env
        );


      if (
        !auth.ok
      ) {

        return safeError(
          auth.error,
          auth.status
        );
      }


      const user =
        auth.user;


      // =========================
      // ROLE
      // =========================

      const isAdmin =
        hasRole(
          user,
          "admin"
        );


      const isDriver =
        hasRole(
          user,
          "driver"
        );


      if (
        !isAdmin &&
        !isDriver
      ) {

        return safeError(
          "forbidden",
          403
        );
      }


      // =========================
      // ADMIN PERMISSION
      // =========================

      if (isAdmin) {

        let adminAccess;

        try {
          adminAccess =
            await resolveAdminAccess(
              env,
              user
            );
        } catch {
          return safeError(
            "admin authorization failed",
            500
          );
        }

        if (
          !adminCan(
            adminAccess,
            "orders.read"
          )
        ) {
          return safeError(
            "forbidden",
            403
          );
        }
      }


      // =========================
      // STATUS FILTER
      // =========================

      const allowedStatuses =
        new Set([
          "new",
          "taken",
          "in_progress",
          "done",
          "canceled"
        ]);


      const requestedStatus =
        String(
          url.searchParams.get(
            "status"
          ) || ""
        )
          .trim()
          .toLowerCase();


      if (
        requestedStatus &&
        !allowedStatuses.has(
          requestedStatus
        )
      ) {

        return safeError(
          "invalid status",
          400
        );
      }


      // =========================
      // LIMIT
      // =========================

      let limit =
        Number(
          url.searchParams.get(
            "limit"
          ) || 100
        );


      if (
        !Number.isInteger(
          limit
        )
      ) {

        limit =
          100;
      }


      limit =
        Math.max(
          1,
          Math.min(
            limit,
            200
          )
        );


      // =========================
      // LOAD ORDERS
      // =========================

      let orders;


      try {

        orders =
          await listOrders(
            env,
            1000
          );

      } catch (
        error
      ) {

        console.error("ORDER LIST ERROR:");

        return safeError(
          "order list failed",
          500
        );
      }


      // =========================
      // VALID ORDERS
      // =========================

      let visibleOrders =
        orders.filter(
          order =>
            order &&
            order.id
        );


      // =========================
      // DRIVER VISIBILITY
      // =========================
      //
      // Driver видит только заказы,
      // назначенные ему сервером.
      //
      // Свободные new-заказы Driver
      // больше не получает.
      // =========================

      if (
        isDriver
      ) {

        visibleOrders =
          visibleOrders.filter(
            order =>
              String(
                order.driverId ||
                  ""
              ) ===
              String(
                user.id
              )
          );
      }


      // =========================
      // APPLY STATUS FILTER
      // =========================

      if (
        requestedStatus
      ) {

        visibleOrders =
          visibleOrders.filter(
            order =>
              order.status ===
              requestedStatus
          );
      }


      // =========================
      // SORT
      // newest first
      // =========================

      visibleOrders.sort(
        (
          a,
          b
        ) => {

          return (
            Number(
              b.createdAt ||
                0
            ) -
            Number(
              a.createdAt ||
                0
            )
          );
        }
      );


      const total =
        visibleOrders.length;


      // =========================
      // APPLY LIMIT
      // =========================

      visibleOrders =
        visibleOrders.slice(
          0,
          limit
        );


      // =========================
      // API VIEW
      // =========================

      const apiOrders =
        visibleOrders.map(
          order => {

            const item = {

              id:
                order.id,

              route:
                order.route,

              from:
                order.from,

              to:
                order.to,

              date:
                order.date,

              tariff:
                order.tariff,

              distance:
                order.distance,

              duration:
                order.duration,

              price:
                order.price,

              status:
                order.status,

              driverId:
                order.driverId,

              createdAt:
                order.createdAt,

              updatedAt:
                order.updatedAt,

              revision:
                order.revision
            };


            // =========================
            // CUSTOMER PII
            // =========================
            //
            // Admin:
            //   видит всегда.
            //
            // Driver:
            //   только если заказ
            //   назначен именно ему.
            //
            // Неназначенные заказы Driver
            // вообще не получает.
            // =========================

            const canSeeCustomer =
              isAdmin ||
              (
                isDriver &&
                String(
                  order.driverId ||
                    ""
                ) ===
                String(
                  user.id
                )
              );


            if (
              canSeeCustomer
            ) {

              item.name =
                order.name;

              item.phone =
                order.phone;

              item.comment =
                order.comment;
            }


            return item;
          }
        );


      // =========================
      // RESPONSE
      // =========================

      return json(
        {
          ok: true,

          total,

          count:
            apiOrders.length,

          limit,

          status:
            requestedStatus ||
            null,

          orders:
            apiOrders
        },
        200,
        cors
      );
    }


    // =========================
    // UNSUPPORTED /orders METHOD
    // =========================

    return safeError(
      "method not allowed",
      405
    );
  }


    // =========================
  // PASSENGER ORDER STATUS
  // =========================
  //
  // Public passenger read endpoint.
  //
  // Request arrives through the PHP
  // gateway and therefore requires:
  //
  // 1. valid proxy HMAC;
  // 2. valid passenger capability token.
  //
  // The token grants read-only access
  // to exactly one order.
  // =========================

  if (
    path === "/order-status"
  ) {

    // =========================
    // METHOD
    // =========================

    if (
      req.method !== "POST"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }


    // =========================
    // PROXY AUTH
    // =========================

    const proxyAuth =
      await verifyProxyRequest(
        req,
        env,
        "/order-status"
      );


    if (
      proxyAuth.ok !== true
    ) {

      return safeError(
        proxyAuth.error,
        proxyAuth.status
      );
    }


    // =========================
    // BODY
    // =========================

    const body =
      await safeJson(
        req
      );


    const accessToken =
      String(
        body?.accessToken ??
        ""
      )
        .trim();


    if (!accessToken) {

      return safeError(
        "missing accessToken",
        400
      );
    }


    // =========================
    // PASSENGER ACCESS
    // =========================

    let passengerAccess;


    try {

      passengerAccess =
        await verifyPassengerOrderAccess(
          env,
          accessToken
        );

    } catch (
      error
    ) {

      console.error(
        "PASSENGER ORDER ACCESS VERIFY ERROR"
      );

      return safeError(
        "order access unavailable",
        500
      );
    }


    if (
      passengerAccess.ok !== true
    ) {

      return safeError(
        "forbidden",
        403
      );
    }


    // =========================
    // LOAD EXACT ORDER
    // =========================

    let order;


    try {

      order =
        await getOrderById(
          env,
          passengerAccess.orderId
        );

    } catch (
      error
    ) {

      console.error("PASSENGER ORDER READ ERROR:");

      return safeError(
        "order read failed",
        500
      );
    }


    if (!order) {

      return safeError(
        "order not found",
        404
      );
    }


    // =========================
    // PASSENGER VIEW
    // =========================
    //
    // Intentionally excluded:
    //
    // name
    // phone
    // comment
    // driverId
    // quoteId
    //
    // Passenger receives only data
    // required for own trip tracking.
    // =========================

    return json(
      {
        ok: true,

        order: {

          id:
            order.id,

          status:
            order.status,

          route:
            order.route,

          from:
            order.from,

          to:
            order.to,

          date:
            order.date,

          tariff:
            order.tariff,

          distance:
            order.distance,

          duration:
            order.duration,

          price:
            order.price,

          createdAt:
            order.createdAt,

          updatedAt:
            order.updatedAt
        }
      },
      200,
      cors
    );
  }


  // =========================
  // DEFAULT
  // =========================

  return json(
    {
      ok: false,
      error:
        "not found",
      path
    },
    404,
    cors
  );
}