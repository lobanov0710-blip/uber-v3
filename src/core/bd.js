// =========================
// DB / KV DATA ACCESS LAYER
// =========================

function requireNamespace(namespace, name) {
  if (!namespace) {
    throw new Error(`${name} KV binding is not configured`);
  }

  return namespace;
}

// =========================
// GENERIC JSON GET
// =========================
export async function getJson(namespace, key) {

  if (!namespace || !key) {
    return null;
  }

  const raw = await namespace.get(String(key));

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {

    console.error(
      "DB JSON PARSE ERROR:",
      key,
      error
    );

    return null;
  }
}

// =========================
// GENERIC JSON PUT
// =========================
export async function putJson(
  namespace,
  key,
  value
) {

  if (!namespace) {
    throw new Error("KV namespace is required");
  }

  if (!key) {
    throw new Error("KV key is required");
  }

  await namespace.put(
    String(key),
    JSON.stringify(value)
  );

  return value;
}

// =========================
// ORDERS
// =========================
export async function saveOrder(env, order) {

  const orders = requireNamespace(
    env?.ORDERS,
    "ORDERS"
  );

  if (!order?.id) {
    throw new Error("Order id is required");
  }

  await putJson(
    orders,
    order.id,
    order
  );

  return order;
}

export async function getOrder(env, orderId) {

  const orders = requireNamespace(
    env?.ORDERS,
    "ORDERS"
  );

  if (!orderId) {
    return null;
  }

  return getJson(
    orders,
    orderId
  );
}

// =========================
// LIST ORDERS
// =========================
//
// Пока route GET /orders не открываем.
// Функцию готовим заранее для CRM,
// но подключим после JWT authorization.
//
export async function listOrders(
  env,
  maxItems = 1000
) {

  const orders = requireNamespace(
    env?.ORDERS,
    "ORDERS"
  );

  const result = [];

  let cursor = undefined;

  while (result.length < maxItems) {

    const remaining =
      maxItems - result.length;

    const page = await orders.list({
      limit: Math.min(1000, remaining),
      ...(cursor ? { cursor } : {})
    });

    if (!page?.keys?.length) {
      break;
    }

    const values = await Promise.all(
      page.keys.map(async key => {

        try {
          return await getJson(
            orders,
            key.name
          );
        } catch (error) {

          console.error(
            "ORDER READ ERROR:",
            key.name,
            error
          );

          return null;
        }
      })
    );

    result.push(
      ...values.filter(Boolean)
    );

    if (
      page.list_complete ||
      !page.cursor
    ) {
      break;
    }

    cursor = page.cursor;
  }

  return result;
}