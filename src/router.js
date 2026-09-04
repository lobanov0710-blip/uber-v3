import {
  json,
  cors,
  safeJson
} from "./core/utils.js";

import {
  signJWT,
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
  tgSend
} from "./core/telegram.js";

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
} from "./core/db.js";


// =========================
// ROUTER
// =========================

export default async function router(
  req,
  env
) {

  const url =
    new URL(req.url);

  const path =
    "/" +
    url.pathname.replace(
      /^\/+|\/+$/g,
      ""
    );


  // =========================
  // CORS
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

  function cleanText(value) {

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
  // SAFE DRIVER RESPONSE
  // =========================

  function publicDriver(
    driver
  ) {

    if (!driver) {
      return null;
    }

    return {
      id:
        driver.id,

      name:
        driver.name,

      phone:
        driver.phone,

      car:
        driver.car || "",

      status:
        driver.status || "",

      createdAt:
        driver.createdAt || null
    };
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
  // WEBSOCKET
  // =========================

  if (
    path === "/ws"
  ) {

    const id =
      env.SOCKET_HUB
        .idFromName(
          "global"
        );

    return env.SOCKET_HUB
      .get(id)
      .fetch(req);
  }


  // =========================
  // CALCULATE
  // =========================

  if (
    path === "/calculate"
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
      await safeJson(req);

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

    if (!tariff) {

      return safeError(
        "invalid tariff",
        400
      );
    }

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

      if (!geoResult) {

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

      const distance =
        Number(
          geoResult.distance
        );

      const duration =
        Number(
          geoResult.duration
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
      // PRICE
      // =========================

      const pricing =
        calculatePrice(
          distance,
          tariff
        );

      if (!pricing.ok) {

        return safeError(
          pricing.error ||
            "price calculation failed",
          400
        );
      }

      // =========================
      // QUOTE
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

    } catch (error) {

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
    // PUBLIC
    // =========================

    if (
      req.method === "POST"
    ) {

      const body =
        await safeJson(req);

      try {

        const result =
          await createOrder(
            body,
            env
          );

        if (!result.ok) {

          return safeError(
            result.error ||
              "invalid order",

            result.status ||
              400
          );
        }

        return json(
          {
            ok: true,

            order:
              orderReceipt(
                result.order
              )
          },
          201,
          cors
        );

      } catch (error) {

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
      // AUTH
      // =========================

      const auth =
        await authenticateRequest(
          req,
          env
        );

      if (!auth.ok) {

        return safeError(
          auth.error,
          auth.status
        );
      }

      const user =
        auth.user;

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

      if (isDriver) {

        if (!user.id) {

          return safeError(
            "invalid driver account",
            403
          );
        }

        let driver = null;

        try {

          const raw =
            await env.DRIVERS.get(
              String(
                user.id
              )
            );

          if (raw) {

            driver =
              JSON.parse(raw);
          }

        } catch (error) {

          console.error(
            "DRIVER AUTH READ ERROR:",
            error
          );

          return safeError(
            "driver authorization failed",
            500
          );
        }

        if (!driver) {

          return safeError(
            "driver not found",
            403
          );
        }

        const driverStatus =
          String(
            driver.status || ""
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
      // FILTER: STATUS
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

        limit = 100;
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
      // LOAD
      // =========================

      let orders;

      try {

        orders =
          await listOrders(
            env,
            1000
          );

      } catch (error) {

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
      // new
      //
      // И заказы,
      // назначенные ему.
      //
      // Заказы другого
      // водителя скрыты.
      // =========================

      if (isDriver) {

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
      // STATUS FILTER
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
        (a, b) => {

          return (
            Number(
              b.createdAt || 0
            ) -
            Number(
              a.createdAt || 0
            )
          );
        }
      );

      const total =
        visibleOrders.length;


      // =========================
      // LIMIT
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
            // Admin видит всегда.
            //
            // Driver только после
            // назначения заказа ему.
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


    return safeError(
      "method not allowed",
      405
    );
  }


  // =========================
  // DRIVER REGISTER
  // =========================

  if (
    path ===
    "/drivers/register"
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
      await safeJson(req);

    const name =
      String(
        body?.name || ""
      ).trim();

    const phone =
      String(
        body?.phone || ""
      ).trim();

    const password =
      String(
        body?.password || ""
      );

    if (
      !name ||
      !phone
    ) {

      return safeError(
        "invalid data",
        400
      );
    }

    const driver = {

      id:
        crypto.randomUUID(),

      name,

      phone,

      // Временно сохраняется
      // существующий механизм.
      // Хэширование пароля
      // сделаем отдельным этапом.
      password,

      car:
        String(
          body?.car || ""
        ).trim(),

      status:
        "pending",

      createdAt:
        Date.now(),

      updatedAt:
        Date.now()
    };

    await env.DRIVERS.put(
      driver.id,
      JSON.stringify(
        driver
      )
    );

    try {

      await tgSend(
        env,
        `🚗 Новый водитель: ${driver.name}`
      );

    } catch (error) {

      console.error(
        "DRIVER TELEGRAM ERROR:",
        error
      );
    }

    // Никогда не возвращаем
    // password клиенту.
    return json(
      {
        ok: true,

        driver:
          publicDriver(driver)
      },
      201,
      cors
    );
  }


  // =========================
  // DRIVER LOGIN
  // =========================

  if (
    path ===
    "/drivers/login"
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
      await safeJson(req);

    const phone =
      String(
        body?.phone || ""
      ).trim();

    const password =
      String(
        body?.password || ""
      );

    if (
      !phone ||
      !password
    ) {

      return safeError(
        "invalid credentials",
        401
      );
    }


    // =========================
    // LOAD DRIVERS
    // =========================

    const list =
      await env.DRIVERS.list();

    const drivers =
      await Promise.all(
        list.keys.map(
          async key => {

            try {

              const value =
                await env.DRIVERS.get(
                  key.name
                );

              return value
                ? JSON.parse(value)
                : null;

            } catch (error) {

              console.error(
                "DRIVER READ ERROR:",
                key.name,
                error
              );

              return null;
            }
          }
        )
      );


    // =========================
    // CREDENTIALS
    // =========================

    const driver =
      drivers.find(
        item =>
          item &&
          item.phone === phone &&
          item.password ===
            password
      );

    if (!driver) {

      return safeError(
        "invalid credentials",
        401
      );
    }


    // =========================
    // APPROVAL
    // =========================

    const driverStatus =
      String(
        driver.status || ""
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


    // =========================
    // JWT
    // =========================

    let token;

    try {

      token =
        await signJWT(
          env.JWT_SECRET,
          {
            id:
              driver.id,

            role:
              "driver"
          }
        );

    } catch (error) {

      console.error(
        "JWT SIGN ERROR:",
        error
      );

      return safeError(
        "authorization failed",
        500
      );
    }


    // =========================
    // RESPONSE
    // =========================

    return json(
      {
        ok: true,

        token,

        driver:
          publicDriver(
            driver
          )
      },
      200,
      cors
    );
  }


  // =========================
  // STATS
  // =========================
  //
  // Пока статистика не содержит
  // PII, поэтому оставляем
  // существующее поведение.
  //
  // Админ-защиту подключим
  // вместе с admin API.
  // =========================

  if (
    path === "/stats"
  ) {

    if (
      req.method !== "GET"
    ) {

      return safeError(
        "method not allowed",
        405
      );
    }

    let orders;

    try {

      orders =
        await listOrders(
          env,
          1000
        );

    } catch (error) {

      console.error(
        "STATS ERROR:",
        error
      );

      return safeError(
        "stats failed",
        500
      );
    }

    const clean =
      orders.filter(
        Boolean
      );

    return json(
      {
        ok: true,

        total:
          clean.length,

        new:
          clean.filter(
            order =>
              order.status ===
              "new"
          ).length,

        taken:
          clean.filter(
            order =>
              order.status ===
              "taken"
          ).length,

        inProgress:
          clean.filter(
            order =>
              order.status ===
              "in_progress"
          ).length,

        done:
          clean.filter(
            order =>
              order.status ===
              "done"
          ).length,

        canceled:
          clean.filter(
            order =>
              order.status ===
              "canceled"
          ).length
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
      error: "not found",
      path
    },
    404,
    cors
  );
}