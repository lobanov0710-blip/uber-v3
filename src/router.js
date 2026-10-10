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
  listOrders,
  takeOrderForDriver,
  advanceDriverOrder,
  cancelOrder
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


// =========================
// ROUTER
// =========================

export default async function router(
  req,
  env
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

      console.error(
        "STAFF LOGIN ERROR:",
        error
      );


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

      console.error(
        "STAFF REFRESH ERROR:",
        error
      );


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

      console.error(
        "STAFF LOGOUT ERROR:",
        error
      );


      return safeError(
        "staff logout failed",
        500
      );
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
  // through:
  //
  // POST /staff/login
  // POST /staff/refresh
  // POST /staff/logout
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


    // =========================
    // LOG
    // =========================
    //
    // На следующем security
    // этапе production logging
    // будет дополнительно
    // сокращён.
    // =========================

    console.log(
      "CALCULATE:",
      {
        from,
        to,
        tariff
      }
    );


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

      console.error(
        "ROUTE CALCULATE ERROR:",
        error
      );

      return safeError(
        "route calculation failed",
        500
      );
    }
  }


    // =========================
  // PRIVATE ORDER TRANSITION
  // =========================
  //
  // Staff-only endpoint:
  //
  // POST /orders/{orderId}/status
  //
  // Authentication:
  // staff JWT
  //
  // Driver:
  //
  // new
  //   -> taken
  //
  // taken
  //   -> in_progress
  //
  // in_progress
  //   -> done
  //
  // Admin:
  //
  // new / taken / in_progress
  //   -> canceled
  //
  // Repository performs the actual
  // transition atomically in D1.
  // =========================

  const orderTransitionMatch =
    path.match(
      /^\/orders\/([^/]+)\/status$/
    );


  if (
    orderTransitionMatch
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
    // STAFF AUTHORIZATION
    // =========================
    //
    // JWT signature alone is not enough.
    //
    // authenticateStaffRequest verifies:
    //
    // - staff scope
    // - account identity
    // - role
    // - tokenVersion
    // - active D1 account
    // - active D1 session
    // - session ownership
    // - revocation / rotation / expiration
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
    // ORDER ID
    // =========================

    let orderId;


    try {

      orderId =
        decodeURIComponent(
          orderTransitionMatch[1]
        )
          .trim();

    } catch (
      error
    ) {

      return safeError(
        "invalid order id",
        400
      );
    }


    if (!orderId) {

      return safeError(
        "invalid order id",
        400
      );
    }


    // =========================
    // BODY
    // =========================

    const body =
      await safeJson(
        req
      );


    const targetStatus =
      String(
        body?.status ??
        ""
      )
        .trim()
        .toLowerCase();


    const allowedTargetStatuses =
      new Set([
        "taken",
        "in_progress",
        "done",
        "canceled"
      ]);


    if (
      !allowedTargetStatuses.has(
        targetStatus
      )
    ) {

      return safeError(
        "invalid status",
        400
      );
    }


    // =========================
    // AUTHORITATIVE DRIVER ID
    // =========================
    //
    // user.id was reconstructed from
    // the active D1 staff account by
    // authenticateStaffRequest().
    //
    // DRIVERS KV is no longer part of
    // authentication/authorization.
    // =========================

    let driverId =
      null;


    if (
      isDriver
    ) {

      driverId =
        String(
          user.id ??
          ""
        )
          .trim();


      if (!driverId) {

        return safeError(
          "invalid staff identity",
          500
        );
      }
    }


    // =========================
    // ROLE -> TRANSITION POLICY
    // =========================

    let transitionResult;


    try {

      if (
        isDriver
      ) {

        if (
          targetStatus === "taken"
        ) {

          transitionResult =
            await takeOrderForDriver(
              env,
              orderId,
              driverId
            );

        } else if (
          targetStatus ===
            "in_progress"
          ||
          targetStatus ===
            "done"
        ) {

          transitionResult =
            await advanceDriverOrder(
              env,
              orderId,
              driverId,
              targetStatus
            );

        } else {

          return safeError(
            "forbidden transition",
            403
          );
        }

      } else {

        // =========================
        // ADMIN
        // =========================
        //
        // ARCH-08 intentionally gives
        // admin only the cancellation
        // transition.
        //
        // Admin must not impersonate
        // driver workflow.
        // =========================

        if (
          targetStatus !==
            "canceled"
        ) {

          return safeError(
            "forbidden transition",
            403
          );
        }


        transitionResult =
          await cancelOrder(
            env,
            orderId
          );
      }

    } catch (
      error
    ) {

      console.error(
        "ORDER TRANSITION ERROR:",
        error
      );


      return safeError(
        "order transition failed",
        500
      );
    }


    // =========================
    // TRANSITION RESULT
    // =========================

    if (
      transitionResult?.ok !== true
    ) {

      if (
        transitionResult?.reason ===
          "not_found"
      ) {

        return safeError(
          "order not found",
          404
        );
      }


      if (
        transitionResult?.reason ===
          "conflict"
      ) {

        return safeError(
          "order transition conflict",
          409
        );
      }


      return safeError(
        "order transition failed",
        500
      );
    }


    const transitionedOrder =
      transitionResult.order;


    if (
      !transitionedOrder
      ||
      !transitionedOrder.id
    ) {

      return safeError(
        "order transition failed",
        500
      );
    }


    // =========================
    // RESPONSE
    // =========================
    //
    // Deliberately minimal.
    //
    // No passenger PII is required
    // for acknowledgement of the
    // state transition itself.
    // =========================

    return json(
      {
        ok: true,

        order: {

          id:
            transitionedOrder.id,

          status:
            transitionedOrder.status,

          driverId:
            transitionedOrder.driverId,

          updatedAt:
            transitionedOrder.updatedAt
        }
      },
      200,
      cors
    );
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

        console.error(
          "ORDER CREATE ERROR:",
          error
        );

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

        console.error(
          "ORDER LIST ERROR:",
          error
        );

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
      // Driver видит:
      //
      // 1. новые заказы;
      //
      // 2. заказы,
      //    назначенные ему.
      //
      // Заказы другого
      // водителя скрыты.
      // =========================

      if (
        isDriver
      ) {

        visibleOrders =
          visibleOrders.filter(
            order => {

              if (
                order.status ===
                "new"
              ) {

                return true;
              }


              return (
                String(
                  order.driverId ||
                    ""
                ) ===
                String(
                  user.id
                )
              );
            }
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
                order.updatedAt
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
            // Новый неназначенный заказ
            // показывается водителю
            // без имени, телефона
            // и комментария.
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

      console.error(
        "PASSENGER ORDER READ ERROR:",
        error
      );

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