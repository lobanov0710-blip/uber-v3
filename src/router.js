import {
  json,
  cors,
  safeJson
} from "./core/utils.js";

import {
  authenticateRequest,
  hasRole
} from "./core/auth.js";

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
  listOrders
} from "./core/orderRepository.js";

import {
  verifyProxyRequest
} from "./core/proxyAuth.js";

import {
  requirePassengerOrderAccess,
  issuePassengerOrderAccess
} from "./core/passengerOrderAccess.js";


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
  // DISABLED LEGACY ENDPOINTS
  // =========================
  //
  // Эти endpoints намеренно
  // отключены до завершения
  // отдельной защищённой
  // реализации driver/admin API.
  //
  // Возвращаем 404, чтобы
  // публично не подтверждать
  // наличие этих API.
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
      // JWT AUTH
      // =========================

      const auth =
        await authenticateRequest(
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
      // DRIVER ACCOUNT CHECK
      // =========================
      //
      // Старые login/register
      // endpoints отключены,
      // однако эта проверка
      // остаётся для существующих
      // валидных JWT и будущей
      // безопасной driver auth.
      // =========================

      if (
        isDriver
      ) {

        if (
          !user.id
        ) {

          return safeError(
            "invalid driver account",
            403
          );
        }


        let driver =
          null;


        try {

          const raw =
            await env.DRIVERS.get(
              String(
                user.id
              )
            );


          if (
            raw
          ) {

            driver =
              JSON.parse(
                raw
              );
          }

        } catch (
          error
        ) {

          console.error(
            "DRIVER AUTH READ ERROR:",
            error
          );

          return safeError(
            "driver authorization failed",
            500
          );
        }


        if (
          !driver
        ) {

          return safeError(
            "driver not found",
            403
          );
        }


        const driverStatus =
          String(
            driver.status ||
              ""
          )
            .trim()
            .toLowerCase();


        if (
          driverStatus !==
            "approved" &&
          driverStatus !==
            "active"
        ) {

          return safeError(
            "driver not approved",
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