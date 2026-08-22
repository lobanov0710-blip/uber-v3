import { json, cors, safeJson } from "./core/utils.js";
import { signJWT } from "./core/auth.js";
import { geoCalculate } from "./core/geo.js";
import { calculatePrice, normalizeTariff } from "./core/pricing.js";
import { calc } from "./core/calc.js";
import { tgSend } from "./core/telegram.js";
import {
  createOrder,
  orderReceipt
} from "./core/orders.js";

export default async function router(req, env) {

  const url = new URL(req.url);
  const path = "/" + url.pathname.replace(/^\/+|\/+$/g, "");

  // ================= CORS =================
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: cors });
  }

  const safeError = (msg, status = 500) =>
    json({ ok: false, error: msg }, status, cors);

  // ================= CLEAN INPUT (PRO FIX v2) =================
  function cleanText(str) {
    return String(str || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^\p{L}\p{N}\s,.-]/gu, " ") // убрать мусор
      .replace(/\s+/g, " ")                 // убрать дубли пробелов
      .replace(/,+/g, ",")                  // чистка запятых
      .trim();
  }

  // ================= HEALTH =================
  if (path === "/") {
    return json({ ok: true, service: "uber-v3-pro" }, 200, cors);
  }

  // ================= WS =================
  if (path === "/ws") {
    const id = env.SOCKET_HUB.idFromName("global");
    return env.SOCKET_HUB.get(id).fetch(req);
  }

  // ================= CALCULATE =================
if (path === "/calculate") {

  if (req.method !== "POST") {
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
  // CLEAN ADDRESSES
  // =========================

  const from =
    cleanText(body.from);

  const to =
    cleanText(body.to);

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
  // VALIDATE TARIFF
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
      await geoCalculate({
        from,
        to
      });

    if (!geoResult) {
      return safeError(
        "geo failed",
        500
      );
    }

    if (!geoResult.ok) {
      return json(
        geoResult,
        400,
        cors
      );
    }

    if (
      !geoResult.route ||
      !Array.isArray(
        geoResult.route.coordinates
      ) ||
      geoResult.route.coordinates.length < 2
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
      !Number.isFinite(distance) ||
      distance <= 0
    ) {
      return safeError(
        "invalid route distance",
        404
      );
    }

    if (
      !Number.isFinite(duration) ||
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

    console.log(
      "PRICE RESULT:",
      pricing
    );

    // =========================
    // RESPONSE
    // =========================

    return json(
      {
        ok: true,

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

  // ================= GEO (PRO STABLE FIX) =================
  if (path === "/calculate") {

    if (req.method !== "POST") {
      return safeError("method not allowed", 405);
    }

    const body = await safeJson(req);

    if (!body?.from || !body?.to) {
      return safeError("missing from/to", 400);
    }

    // 🔥 CLEAN INPUT (FIX OSRM INVALID QUERY)
    const from = cleanText(body.from);
    const to = cleanText(body.to);

    console.log("FROM:", from, "TO:", to);

    // ❌ защита от мусора
    if (from.length < 3 || to.length < 3) {
      return safeError("address too short", 400);
    }

    try {

      const result = await geoCalculate(
        {
          from,
          to,
          tariff: body.tariff
        },
        env
      );

      // ================= HARD PROTECTION =================

      if (!result) {
        return safeError("geo failed", 500);
      }

      if (result.ok === false) {
        return json(result, 400, cors);
      }

      // ❌ защита пустого маршрута
      if (
        !result.route ||
        !Array.isArray(result.route.coordinates) ||
        result.route.coordinates.length === 0
      ) {
        return safeError("empty route", 404);
      }

      // ❌ защита distance
      if (!result.distance || result.distance <= 0) {
        return safeError("invalid route distance", 404);
      }

      return json(
        {
          ok: true,
          distance: Number(result.distance || 0),
          duration: Number(result.duration || 0),
          price: Number(result.price || 0),
          route: result.route,
        },
        200,
        cors
      );

    } catch (e) {
      console.error("ROUTE ERROR:", e);
      return safeError("route crash", 500);
    }
  }

    // ================= ORDERS =================
  if (path === "/orders") {

    // Пока разрешаем только создание.
    // GET подключим после JWT authorization.
    if (req.method !== "POST") {
      return safeError(
        "method not allowed",
        405
      );
    }

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
          result.status || 400
        );
      }

      return json(
        {
          ok: true,
          order: orderReceipt(
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

  // ================= REGISTER =================
  if (path === "/drivers/register") {

    if (req.method !== "POST") {
      return safeError("method not allowed", 405);
    }

    const body = await safeJson(req);

    if (!body?.phone || !body?.name) {
      return safeError("invalid data", 400);
    }

    const driver = {
      id: crypto.randomUUID(),
      name: body.name,
      phone: body.phone,
      password: body.password || "",
      car: body.car || "",
      status: "pending",
      createdAt: Date.now(),
    };

    await env.DRIVERS.put(driver.id, JSON.stringify(driver));

    try {
      await tgSend(env, `🚗 Driver: ${driver.name}`);
    } catch {}

    return json({ ok: true, driver }, 200, cors);
  }

  // ================= LOGIN =================
  if (path === "/drivers/login") {

    if (req.method !== "POST") {
      return safeError("method not allowed", 405);
    }

    const body = await safeJson(req);

    const list = await env.DRIVERS.list();

    const drivers = await Promise.all(
      list.keys.map(async (k) => {
        const v = await env.DRIVERS.get(k.name);
        return v ? JSON.parse(v) : null;
      })
    );

    const driver = drivers.find(
      (d) =>
        d?.phone === body?.phone &&
        d?.password === body?.password
    );

    if (!driver) {
      return safeError("invalid credentials", 401);
    }

    const token = await signJWT(env.JWT_SECRET, {
      id: driver.id,
      role: "driver",
    });

    return json({ ok: true, token, driver }, 200, cors);
  }

  // ================= STATS =================
  if (path === "/stats") {

    if (req.method !== "GET") {
      return safeError("method not allowed", 405);
    }

    const list = await env.ORDERS.list();

    const orders = await Promise.all(
      list.keys.map(async (k) => {
        const v = await env.ORDERS.get(k.name);
        return v ? JSON.parse(v) : null;
      })
    );

    const clean = orders.filter(Boolean);

    return json({
      ok: true,
      total: clean.length,
      new: clean.filter((o) => o.status === "new").length,
      taken: clean.filter((o) => o.status === "taken").length,
      done: clean.filter((o) => o.status === "done").length,
    });
  }

  // ================= DEFAULT =================
  return json(
    {
      ok: false,
      error: "not found",
      path,
    },
    404,
    cors
  );
}