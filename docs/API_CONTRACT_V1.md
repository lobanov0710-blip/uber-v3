# Transfer Servis API Contract v1

Status: **FROZEN**

This document defines the current API contract used by the Transfer Servis platform.

The contract reflects the implemented behavior of:

- Cloudflare Worker `uber-v3`
- public PHP gateway on `transfer-servis52.ru`
- Android passenger application
- private staff authentication and order API

Breaking changes require a new API version or an explicit coordinated migration of all affected clients.

---

# 1. Architecture boundary

Passenger clients do not call the Cloudflare Worker directly.

Public passenger traffic:

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

POST /staff/login
POST /staff/refresh
POST /staff/logout

GET  /orders
POST /orders/{orderId}/status
```

`POST /staff/login`, `POST /staff/refresh`, and `POST /staff/logout` implement the staff authentication lifecycle.

`GET /orders` and `POST /orders/{orderId}/status` are private staff endpoints and are not part of the public passenger API.

Private staff endpoints require a valid staff access JWT backed by an active D1 staff account and active D1 staff session.

Staff clients communicate directly with the Worker and do not use the public passenger PHP gateway.

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
refreshExpiresAt
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
| `taken` | accepted and assigned to a driver |
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
Authorization: Bearer <staff access JWT>
```

Allowed roles:

```text
admin
driver
```

The JWT alone is not authoritative.

The Worker also validates the current D1 staff account and D1 staff session associated with the token.

Passenger capability tokens must not access this endpoint.

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

## 13.1 POST /orders/{orderId}/status

Private staff state-transition endpoint.

Request:

```text
POST /orders/{orderId}/status
Authorization: Bearer <staff access JWT>
Content-Type: application/json
```

This endpoint is not part of the passenger PHP gateway.

Passenger capability tokens are not valid credentials for this endpoint.

### Request body

```json
{
  "status": "taken"
}
```

Allowed target values:

```text
taken
in_progress
done
canceled
```

The target value alone does not authorize the transition.

The authenticated role, current persisted order state, and current `driverId` determine whether the transition is permitted.

### Driver transition policy

An authenticated staff account with:

```text
role = driver
status = active
```

may perform:

```text
new
  -> taken

taken
  -> in_progress

in_progress
  -> done
```

The authoritative driver identity is the `staff_accounts.id` reconstructed by the Worker after validating both the access JWT and the current D1 account/session state.

`DRIVERS` KV is not part of staff authentication or authorization.

When a driver performs:

```text
new -> taken
```

the authenticated staff account id is written to:

```text
orders.driver_id
```

as part of the same atomic D1 update that changes the status.

For subsequent driver transitions:

```text
taken -> in_progress
in_progress -> done
```

the authenticated staff account id must exactly match the persisted:

```text
orders.driver_id
```

A different driver cannot advance another driver's assigned order.

### Admin transition policy

An authenticated admin may perform:

```text
new
taken
in_progress
    -> canceled
```

Admin does not perform driver workflow transitions through this endpoint.

In API v1, admin therefore cannot directly perform:

```text
new -> taken
taken -> in_progress
in_progress -> done
```

### Terminal states

The following states are terminal:

```text
done
canceled
```

No state transition out of either terminal state is permitted by API v1.

### Atomicity and concurrency

State transitions are enforced directly by conditional D1 `UPDATE` statements.

The backend does not rely on a separate read followed by an unconditional write.

For example, driver order acceptance requires the persisted row to satisfy:

```text
status = new
driver_id IS NULL
```

and assigns both:

```text
status = taken
driver_id = authenticated staff account id
```

atomically.

Therefore competing drivers cannot both successfully claim the same order.

### Success response

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
    "driverId": "staff-driver-id",
    "updatedAt": 1791503600000
  }
}
```

The transition acknowledgement intentionally contains only:

```text
id
status
driverId
updatedAt
```

Customer PII is not returned by this response.

### Error behavior

| Status | Meaning |
|---|---|
| `400` | invalid order id or target status |
| `401` | missing, invalid, expired, or revoked staff authentication |
| `403` | role/account is not authorized for the requested transition |
| `404` | order does not exist |
| `405` | HTTP method other than POST |
| `409` | order exists but its current state/assignment does not permit the requested transition |
| `500` | staff authorization, D1, or transition processing failure |

A `409 Conflict` is expected for races such as two drivers attempting to take the same `new` order.

Clients must reload authoritative order state after a conflict instead of assuming that their requested transition occurred.

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

# 16. Staff account and session requirement

A signed JWT is not sufficient by itself to access private staff endpoints.

For every protected staff request, the Worker validates:

```text
JWT signature and expiration
scope = staff
sub / id identity consistency
role
tokenVersion
sid
```

and then checks authoritative D1 state.

The corresponding row in:

```text
staff_accounts
```

must exist and have:

```text
status = active
```

The account role and `token_version` stored in D1 must match the JWT claims.

The JWT is also bound to a row in:

```text
staff_sessions
```

through its:

```text
sid
```

claim.

That session must:

```text
exist
belong to the authenticated account
not be revoked
not have been replaced
not be expired
```

The authenticated principal used by private routes is reconstructed from current D1 data.

Therefore changing account state, token version, or session state can invalidate previously issued access tokens without trusting stale role/account data contained only in the JWT.

`DRIVERS` KV is not authoritative for staff authentication or authorization.

Order state and assignment remain authoritative in D1.

---

# 17. Authentication zones

The platform has separate passenger and staff authentication zones.

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

Passenger credentials provide no authority to mutate order state.

## Staff authentication

Staff authentication is handled directly by the Worker.

There is no public staff self-registration endpoint.

Legacy endpoints:

```text
/drivers/register
/drivers/login
```

are disabled.

### Login

```text
POST /staff/login
```

Request:

```json
{
  "login": "admin.main",
  "password": "staff password"
}
```

Credentials are checked against authoritative:

```text
staff_accounts
```

in D1.

Only accounts with:

```text
status = active
```

may authenticate.

Unknown, inactive, locked, and incorrect-password cases use generic authentication errors rather than exposing account existence.

Successful login returns:

```json
{
  "ok": true,
  "staff": {
    "id": "staff-account-id",
    "displayName": "Staff member",
    "role": "admin"
  },
  "accessToken": "JWT",
  "accessExpiresAt": 1791500900000,
  "refreshToken": "tsr1....",
  "refreshExpiresAt": 1794092000000
}
```

The access JWT lifetime is:

```text
15 minutes
```

A newly authenticated refresh-token family has an absolute maximum lifetime of:

```text
30 days
```

Passwords are verified using:

```text
PBKDF2-HMAC-SHA256
```

New password verifiers use:

```text
600000 iterations
16-byte random salt
32-byte derived key
```

Plaintext staff passwords are not stored in D1.

### Refresh

```text
POST /staff/refresh
```

Request:

```json
{
  "refreshToken": "tsr1...."
}
```

Refresh tokens are opaque 256-bit random credentials.

D1 stores only:

```text
SHA-256(refreshToken)
```

and never the plaintext refresh token.

A successful refresh rotates the refresh token.

The old session becomes revoked and references its replacement.

The replacement session inherits the original session-family:

```text
expires_at
```

so repeated refresh operations cannot extend the absolute refresh lifetime.

Rotation is fail-closed.

The current active session is claimed/revoked before a replacement session is inserted.

A replacement session cannot become active unless the corresponding current session was successfully claimed by that rotation attempt.

Reuse of an already rotated or revoked refresh token revokes its session family.

### Logout

```text
POST /staff/logout
```

Request:

```json
{
  "refreshToken": "tsr1...."
}
```

Logout revokes the corresponding D1 session.

Logout is intentionally idempotent.

Malformed, unknown, or already revoked refresh tokens do not reveal whether a session existed.

Successful logout returns:

```json
{
  "ok": true
}
```

## Private staff traffic

```text
Transfer Driver / Admin
        |
        | staff access JWT
        v
Cloudflare Worker
        |
        v
D1
```

Private staff endpoints include:

```text
GET  /orders
POST /orders/{orderId}/status
```

Staff traffic does not use the passenger PHP gateway.

Staff JWTs and passenger capability credentials belong to separate security domains.

A staff access JWT is accepted only while both its D1 account and its D1 session remain valid.

For a driver, the authoritative identity used for order ownership is:

```text
staff_accounts.id
```

Order ownership and legal state transitions remain authoritative in D1.

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

Private staff authentication and staff API endpoints do not use the passenger proxy HMAC authentication zone.

They use the separate D1-backed staff authentication model.

---

# 19. HTTP status contract

The API currently uses the following principal statuses:

| Status | Meaning |
|---|---|
| `200` | successful calculation/read/authentication operation/state transition |
| `201` | order created/accepted |
| `204` | CORS preflight |
| `400` | invalid input |
| `401` | staff credentials/token/session invalid, expired, revoked, or authentication required |
| `403` | forbidden operation or passenger capability rejection |
| `404` | resource/route unavailable or disabled legacy endpoint |
| `405` | method not allowed |
| `409` | quote conflict or order state-transition conflict |
| `413` | PHP gateway request too large |
| `500` | internal/configuration/storage failure |
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

Staff endpoints:

```text
POST /staff/login
POST /staff/refresh
POST /staff/logout
GET  /orders
POST /orders/{orderId}/status
```

do not pass through the public PHP passenger gateway.

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
- changing public passenger authentication requirements;
- changing the meaning or scope of the passenger order capability;
- allowing a passenger capability to select an order other than its token subject;
- changing the staff access-token claim contract;
- changing the staff refresh-token rotation semantics;
- allowing staff JWT claims to bypass authoritative D1 account/session validation;
- allowing unauthorized roles to perform staff state transitions;
- changing legal order transition semantics without coordinated staff-client support.

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

The Android passenger application does not use:

```text
POST /staff/login
POST /staff/refresh
POST /staff/logout
GET  /orders
POST /orders/{orderId}/status
```

Those endpoints belong to the staff authentication/private staff API.

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

Authoritative transactional and security storage:

```text
Cloudflare D1
```

Authoritative entities:

```text
quotes
orders
staff_accounts
staff_sessions
```

KV must not be used as an authoritative or mirrored store for:

```text
quotes
orders
staff authentication state
staff authorization state
staff refresh sessions
```

The authoritative staff-security fields include:

```text
staff_accounts.id
staff_accounts.role
staff_accounts.status
staff_accounts.token_version
staff_accounts.password_*
staff_accounts.locked_until

staff_sessions.id
staff_sessions.account_id
staff_sessions.family_id
staff_sessions.refresh_token_hash
staff_sessions.expires_at
staff_sessions.revoked_at
staff_sessions.replaced_by_session_id
```

The authoritative order fields involved in staff state transitions are:

```text
orders.status
orders.driver_id
orders.updated_at
```

For driver-owned orders:

```text
orders.driver_id
```

contains the authoritative D1 staff account id of the assigned driver.

Legal transitions are enforced by conditional D1 updates.

Passenger order capability tokens are signed credentials and are not stored as authoritative order state in D1 or KV.

Staff access JWTs are signed credentials, but their account/session authorization state remains authoritative in D1.

Plaintext staff refresh tokens are not stored in D1.

Only their cryptographic hashes are persisted.

---

# 24. Contract ownership

Any code change affecting:

```text
POST /calculate
POST /orders
POST /order-status

POST /staff/login
POST /staff/refresh
POST /staff/logout

GET  /orders
POST /orders/{orderId}/status
```

must be checked against this document and the backend test suite.

Changes to the passenger capability contract must also be coordinated with:

```text
/api/order.php
/api/order-status.php
Android passenger application
```

Changes to staff authentication must preserve:

```text
D1-authoritative account state
D1-authoritative session state
generic credential failures
password verifier policy
account lockout policy
tokenVersion validation
sid/session binding
refresh-token hashing
refresh-token rotation
absolute refresh-family expiration
refresh replay detection
session revocation
disabled public self-registration
```

Changes to staff order-transition behavior must preserve:

```text
role authorization
D1 staff account validation
D1 staff session validation
driver identity
driver ownership
legal state transitions
terminal states
atomic D1 concurrency control
```

Before merge:

```bash
npm test
npx wrangler deploy --dry-run
```

If an intentional breaking contract change is required, update this specification and all affected clients in the same coordinated migration.