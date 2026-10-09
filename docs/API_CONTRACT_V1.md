# Transfer Servis API Contract v1

Status: **FROZEN**

This document defines the current API contract used by the Transfer Servis platform.

The contract reflects the implemented behavior of:

- Cloudflare Worker `uber-v3`
- public PHP gateway on `transfer-servis52.ru`
- Android passenger application

Breaking changes require a new API version or an explicit coordinated migration of all clients.

---

# 1. Architecture boundary

Passenger clients do not call the Cloudflare Worker directly.

Public traffic:

```text
Android / Website
        |
        v
https://transfer-servis52.ru/api/*
        |
        | HMAC authenticated server-to-server request
        v
Cloudflare Worker
        |
        v
Cloudflare D1
```

Public passenger endpoints:

```text
POST /api/calculate.php
POST /api/order.php
POST /api/order-status.php
```

Internal Worker endpoints:

```text
POST /calculate
POST /orders
POST /order-status
GET  /orders
```

`GET /orders` is a private staff endpoint and is not part of the public passenger API.

`POST /order-status` is not called directly by Android or browser clients.

Passenger traffic reaches it through:

```text
POST /api/order-status.php
```

The PHP gateway authenticates the server-to-server request using the proxy HMAC contract.

---

# 2. Common response rules

Successful responses contain:

```json
{
  "ok": true
}
```

Errors use:

```json
{
  "ok": false,
  "error": "error description"
}
```

Clients must primarily use the HTTP status code and `ok`.

Additional error fields may be added without breaking the contract.

---

# 3. Data conventions

## 3.1 Timestamps

Business-data timestamps returned in API JSON payloads are Unix epoch timestamps in **milliseconds**.

This includes fields such as:

```text
createdAt
updatedAt
quoteExpiresAt
accessExpiresAt
```

Example:

```json
{
  "createdAt": 1791500000000
}
```

The proxy-authentication header:

```text
X-Proxy-Timestamp
```

is an exception.

It uses a **10-digit Unix timestamp in seconds**, as defined by the Proxy HMAC contract in section 18.

## 3.2 Trip date

Trip dates use:

```text
YYYY-MM-DD
```

Example:

```text
2026-10-20
```

## 3.3 Tariff codes

Frozen tariff identifiers:

```text
comfort
business
minivan
```

Clients must use the identifier, not the display name, as the contract value.

## 3.4 Order statuses

Frozen order statuses:

```text
new
taken
in_progress
done
canceled
```

Meaning:

| Status | Meaning |
|---|---|
| `new` | new unassigned order |
| `taken` | accepted/assigned |
| `in_progress` | trip in progress |
| `done` | completed |
| `canceled` | canceled |

Existing identifiers must not be renamed without an API migration.

---

# 4. POST /api/calculate.php

Public passenger endpoint.

The PHP gateway forwards the request to Worker:

```text
POST /calculate
```

The gateway adds HMAC authentication.

Passenger applications do not create HMAC signatures themselves.

## 4.1 Request

```json
{
  "from": "Нижний Новгород",
  "to": "Москва",
  "tariff": "comfort"
}
```

Fields:

| Field | Type | Required |
|---|---|---|
| `from` | string | yes |
| `to` | string | yes |
| `tariff` | string | yes |

Valid `tariff` values:

```text
comfort
business
minivan
```

The server is authoritative for:

- geocoding
- route
- distance
- duration
- tariff calculation
- final price
- quote lifetime

The client must never be treated as authoritative for price calculation.

---

## 4.2 Success response

HTTP:

```text
200 OK
```

Example:

```json
{
  "ok": true,
  "quoteId": "11111111-1111-4111-8111-111111111111",
  "quoteExpiresAt": 1791501800000,
  "from": {
    "query": "нижний новгород",
    "lat": 56.3269,
    "lon": 44.0059,
    "displayName": "Нижний Новгород, Россия"
  },
  "to": {
    "query": "москва",
    "lat": 55.7558,
    "lon": 37.6176,
    "displayName": "Москва, Россия"
  },
  "tariff": "comfort",
  "tariffName": "Comfort",
  "distance": 420.0,
  "duration": 360,
  "price": 23100,
  "pricing": {
    "pricePerKm": 55,
    "coefficient": 1,
    "minimumPrice": 4000
  },
  "route": {
    "type": "LineString",
    "coordinates": [
      [44.0059, 56.3269],
      [37.6176, 55.7558]
    ]
  }
}
```

## 4.3 Response fields

### Quote

```text
quoteId
```

UUID identifying the server-side quote.

```text
quoteExpiresAt
```

Quote expiration timestamp in milliseconds.

Current quote lifetime:

```text
30 minutes
```

### Place

`from` and `to`:

```json
{
  "query": "string",
  "lat": 0.0,
  "lon": 0.0,
  "displayName": "string"
}
```

### Route

GeoJSON-compatible geometry:

```json
{
  "type": "LineString",
  "coordinates": [
    [longitude, latitude]
  ]
}
```

Coordinate order is:

```text
longitude, latitude
```

not:

```text
latitude, longitude
```

### Distance

`distance` is kilometers.

Example:

```json
420.0
```

### Duration

`duration` is whole minutes.

### Price

`price` is RUB as an integer.

The price returned by the backend is authoritative.

---

# 5. Quote rules

Quotes are persisted in Cloudflare D1.

D1 is the single authoritative source of truth.

A quote contains trusted:

```text
from
to
tariff
distance
duration
price
pricing metadata
```

Route geometry returned by `/calculate` is not persisted as part of the quote.

When a quoted order is created, its textual route is reconstructed from the authoritative `from` and `to` values stored in D1.

The current quote TTL is:

```text
30 minutes
```

A quoted order may consume the quote only once.

Database invariant:

```text
1 quoteId -> maximum 1 order
```

Repeated submission of the same order can therefore be handled idempotently.

---

# 6. POST /api/order.php

Public passenger endpoint.

The gateway forwards to:

```text
POST /orders
```

There are two accepted order modes.

---

# 7. Quoted order

This is the normal passenger application flow.

## 7.1 Request

```json
{
  "quoteId": "11111111-1111-4111-8111-111111111111",
  "name": "Иван",
  "phone": "+79990000001",
  "date": "2026-10-20",
  "comment": "Встреча у подъезда"
}
```

Fields:

| Field | Type | Required |
|---|---|---|
| `quoteId` | UUID string | yes |
| `name` | string | yes |
| `phone` | string | yes |
| `date` | `YYYY-MM-DD` | yes |
| `comment` | string | no |

The client must **not** be authoritative for:

```text
route
from
to
tariff
distance
duration
price
```

When `quoteId` is supplied, `from`, `to`, `tariff`, `distance`, `duration`, and `price` are loaded by the backend from the authoritative D1 quote.

The textual order route is constructed from the stored `from` and `to` values.

Client-supplied pricing or route fields must not override the stored quote.

---

# 8. Manual order

Manual orders remain supported for the website flow where a quote may not exist.

Request:

```json
{
  "name": "Иван",
  "phone": "+79990000001",
  "route": "Нижний Новгород → Москва",
  "date": "2026-10-20",
  "comment": ""
}
```

For a manual order:

```text
quoteId = null
tariff = null
distance = null
duration = null
price = null
```

The manual-order client must not supply a trusted calculated price.

---

# 9. Order creation response

Successful order creation:

```text
201 Created
```

Response:

```json
{
  "ok": true,
  "order": {
    "id": "order-id",
    "status": "new",
    "createdAt": 1791500000000
  },
  "accessToken": "<passenger-order-capability>",
  "accessExpiresAt": 1794092000000
}
```

The public order receipt intentionally does not expose:

```text
name
phone
comment
route
price
driverId
quoteId
```

`accessToken` is a passenger read capability bound to the created order.

`accessExpiresAt` is a Unix epoch timestamp in milliseconds.

The passenger client must treat `accessToken` as sensitive credential material.

It must not be:

```text
logged
embedded in URLs
included in analytics
stored in plaintext
```

The Android passenger application stores the capability encrypted using Android Keystore-backed AES/GCM storage.

---

## 9.1 Passenger order access capability

Passenger order access uses a dedicated signed capability token.

The signing secret is:

```text
PASSENGER_ORDER_SECRET
```

It must be separate from:

```text
JWT_SECRET
proxy HMAC secret
```

The capability payload contains:

```text
sub = order id
scope = passenger_order:read
```

The token grants read access to exactly one order.

The capability token is not stored in D1.

Minimum access lifetime:

```text
30 days
```

For a future trip, access remains valid until at least:

```text
end of trip date + 7 days
```

The server calculates the effective expiration and returns it as:

```text
accessExpiresAt
```

in milliseconds.

An idempotent retry of order creation may issue a new valid capability for the same existing order.

---

## 9.2 POST /api/order-status.php

Public passenger endpoint:

```text
POST /api/order-status.php
```

The PHP gateway forwards the exact JSON body to:

```text
POST /order-status
```

using the server-to-server proxy HMAC contract.

### Request

```json
{
  "accessToken": "<passenger-order-capability>"
}
```

`accessToken` is required.

The passenger client does not select an order using an `orderId` request parameter.

The Worker verifies the capability and loads the order identified by the token subject:

```text
token.sub -> exact D1 order id
```

Client-supplied `orderId` data must not change which order is loaded.

### Successful response

HTTP:

```text
200 OK
```

Example:

```json
{
  "ok": true,
  "order": {
    "id": "order-id",
    "status": "taken",
    "route": "Нижний Новгород → Москва",
    "from": "Нижний Новгород",
    "to": "Москва",
    "date": "2026-10-20",
    "tariff": "comfort",
    "distance": 420,
    "duration": 360,
    "price": 23100,
    "createdAt": 1791500000000,
    "updatedAt": 1791503600000
  }
}
```

For manual orders, the following values may be `null`:

```text
tariff
distance
duration
price
```

For manual orders created only from a textual route, `from` and `to` may be empty strings.

Passenger status responses intentionally exclude:

```text
name
phone
comment
driverId
quoteId
```

Principal error behavior:

| Status | Meaning |
|---|---|
| `400` | missing or invalid request input |
| `403` | invalid, expired, or unauthorized passenger capability |
| `404` | capability is valid but the referenced order does not exist |
| `405` | HTTP method other than POST |
| `500` | passenger-access configuration or D1 read failure |
| `502` | PHP gateway upstream failure |

A temporary network or server failure must not cause the Android client to discard a still-valid local passenger capability.

---

# 10. Order idempotency

For quoted orders, `quoteId` is the idempotency boundary.

If the same `quoteId` is submitted again with the same:

```text
name
phone
date
comment
```

the backend returns the existing order instead of creating another physical order.

A duplicate Telegram notification is not sent.

If the same `quoteId` is reused with different customer information, the request fails with:

```text
409 Conflict
```

Example:

```json
{
  "ok": false,
  "error": "quote already used"
}
```

---

# 11. Telegram behavior

Telegram is an operational notification channel.

D1 remains the source of truth.

Sequence:

```text
persist order in D1
        |
        v
send Telegram notification
```

Telegram failure does not roll back an already persisted order.

Therefore:

```text
D1 order exists
```

does not necessarily guarantee that Telegram delivery succeeded.

Only a newly created order triggers a Telegram notification.

An idempotent retry does not send another notification.

---

# 12. Private GET /orders

Internal staff endpoint:

```text
GET /orders
```

Authentication:

```text
Authorization: Bearer <JWT>
```

Allowed roles:

```text
admin
driver
```

Passenger JWTs must not access this endpoint.

---

## 12.1 Query parameters

Optional:

```text
status
limit
```

Example:

```text
/orders?status=new&limit=100
```

Valid statuses:

```text
new
taken
in_progress
done
canceled
```

`limit`:

```text
default: 100
minimum: 1
maximum: 200
```

---

# 13. GET /orders response

Example:

```json
{
  "ok": true,
  "total": 2,
  "count": 2,
  "limit": 100,
  "status": null,
  "orders": []
}
```

`total` is calculated after authorization/status filtering and before the requested response limit is applied.

---

# 14. Staff order object

Base fields:

```json
{
  "id": "order-id",
  "route": "Нижний Новгород → Москва",
  "from": "Нижний Новгород",
  "to": "Москва",
  "date": "2026-10-20",
  "tariff": "comfort",
  "distance": 420,
  "duration": 360,
  "price": 23100,
  "status": "new",
  "driverId": null,
  "createdAt": 1791500000000,
  "updatedAt": 1791500000000
}
```

---

# 15. PII visibility

## Admin

Admin can see:

```text
name
phone
comment
```

for all visible orders.

## Driver

A driver may see:

1. unassigned orders with `status = new`;
2. orders assigned to that driver.

For an unassigned `new` order, customer PII is hidden.

The following fields are omitted:

```text
name
phone
comment
```

For an order assigned to the authenticated driver, those fields are included.

Orders assigned to another driver are not visible.

---

# 16. Driver account requirement

A JWT with role:

```text
driver
```

is not sufficient by itself.

The corresponding driver record must exist and its current status must be:

```text
approved
```

or:

```text
active
```

The current driver registry remains in `DRIVERS` KV.

Transactional quote/order data does not use KV.

---

# 17. Authentication zones

The platform has separate authentication zones.

## Public passenger traffic

```text
Android / Website
        |
        v
PHP Gateway
        |
        | HMAC
        v
Worker
```

The HMAC secret must never be embedded in Android or browser JavaScript.

For passenger order-status access there are two independent security layers:

```text
1. PHP gateway -> Worker:
   proxy HMAC

2. Passenger -> own order:
   accessToken capability
```

The passenger capability does not replace proxy HMAC.

Proxy HMAC does not grant access to an arbitrary passenger order without a valid passenger capability.

## Private staff traffic

```text
Driver / Admin
        |
        | JWT
        v
Worker private API
```

Staff JWT and passenger capability credentials are separate security domains.

---

# 18. Proxy HMAC contract

Server-to-server requests contain:

```text
X-Proxy-Timestamp
X-Proxy-Signature
```

Canonical string:

```text
timestamp + "\n" + path + "\n" + rawBody
```

Algorithm:

```text
HMAC-SHA256
```

Signature format:

```text
lowercase hexadecimal
```

Timestamp:

```text
10-digit Unix timestamp in seconds
```

Maximum accepted clock skew:

```text
300 seconds
```

The signature is calculated over the **exact raw body**.

Equivalent JSON serialized differently does not have the same signature.

For `/order-status`, the canonical Worker pathname is:

```text
/order-status
```

The passenger `accessToken` remains inside the JSON request body.

---

# 19. HTTP status contract

The API currently uses the following principal statuses:

| Status | Meaning |
|---|---|
| `200` | successful calculation/read |
| `201` | order created/accepted |
| `204` | CORS preflight |
| `400` | invalid input |
| `401` | authentication required/invalid |
| `403` | forbidden/authentication failure/capability rejection |
| `404` | resource/route unavailable |
| `405` | method not allowed |
| `409` | quote conflict/expired/already used |
| `413` | PHP gateway request too large |
| `500` | internal/configuration failure |
| `502` | PHP gateway upstream failure |

Clients must not infer business state purely from the text of an error message.

HTTP status and `ok` remain the primary machine-readable indicators until typed error codes are introduced.

---

# 20. PHP gateway limits

Current public gateway limits:

```text
/api/calculate.php    : 32768 bytes
/api/order.php        : 65536 bytes
/api/order-status.php : 32768 bytes
```

The gateway validates:

- HTTP method
- request size
- non-empty request body
- valid JSON
- proxy HMAC configuration
- valid JSON response from Worker

`/api/order-status.php` additionally validates that:

```text
accessToken
```

is present as a non-empty string before forwarding the request.

The gateway passes valid Worker status codes and JSON responses through to the client.

---

# 21. Compatibility policy

For API v1, the following are breaking changes:

- removing an existing required response field;
- renaming an existing field;
- changing an existing field type;
- changing business-data timestamp units;
- changing tariff identifiers;
- changing status identifiers;
- changing coordinate ordering;
- changing the meaning of `quoteId`;
- allowing client pricing to override server pricing;
- changing public authentication requirements;
- changing the meaning or scope of the passenger order capability;
- allowing a passenger capability to select an order other than its token subject.

The following may be introduced compatibly:

- new optional response fields;
- new optional request fields;
- new error metadata;
- new private endpoints;
- new order statuses only after coordinated client support.

---

# 22. Current Android passenger contract

The Android passenger application currently uses:

```text
POST /api/calculate.php
POST /api/order.php
POST /api/order-status.php
```

## Calculation request

The Android client sends:

```text
from
to
tariff
```

Calculation response consumes:

```text
ok
quoteId
quoteExpiresAt
from
to
tariff
tariffName
distance
duration
price
pricing
route
```

## Order creation request

The Android client sends:

```text
quoteId
name
phone
date
comment
```

Order creation response consumes:

```text
ok
order.id
order.status
order.createdAt
accessToken
accessExpiresAt
```

A successful order receipt is not considered valid by the Android repository if the required passenger capability is missing or invalid.

The Android application securely persists:

```text
orderId
accessExpiresAt
encrypted accessToken
```

The encryption key is held by Android Keystore.

The access token ciphertext and IV may be stored in application-private preferences.

The plaintext token must not be persisted.

## Active order restore

After application restart, Android loads the secure passenger session and requests the current authoritative order from:

```text
POST /api/order-status.php
```

Request:

```text
accessToken
```

The active-order response consumes:

```text
ok
order.id
order.status
order.route
order.from
order.to
order.date
order.tariff
order.distance
order.duration
order.price
order.createdAt
order.updatedAt
```

The Android application verifies that the returned:

```text
order.id
```

matches the locally stored order id.

D1 remains authoritative for current order state.

Android local storage is not authoritative for:

```text
status
route
tariff
distance
duration
price
```

Temporary network or backend failure does not automatically destroy the still-valid passenger capability.

## Routing provider

The Android DTO currently contains an optional `routingProvider` property.

The Worker internally knows the routing provider, but `router.js` does not currently expose `routingProvider` in the public `/calculate` response.

Therefore `routingProvider` is **not part of API v1** and clients must not depend on it.

---

# 23. Source of truth

Transactional storage:

```text
Cloudflare D1
```

Authoritative entities:

```text
quotes
orders
```

KV must not be used as an authoritative or mirrored store for quotes or orders.

Current remaining KV responsibility:

```text
DRIVERS
```

for existing driver authorization/account status.

Passenger order capability tokens are signed credentials and are not stored as authoritative order state in D1 or KV.

---

# 24. Contract ownership

Any code change affecting:

```text
POST /calculate
POST /orders
POST /order-status
GET /orders
```

must be checked against this document and the backend test suite.

Changes to the passenger capability contract must also be coordinated with:

```text
/api/order.php
/api/order-status.php
Android passenger application
```

Before merge:

```bash
npm test
npx wrangler deploy --dry-run
```

If an intentional breaking contract change is required, update this specification and all affected clients in the same coordinated migration.