import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync, mkdirSync, copyFileSync, writeFileSync,
  readFileSync, rmSync, existsSync
} from "node:fs";
import os from "node:os";
import path from "node:path";
import router from "../src/router.js";
import { signJWT } from "../src/core/auth.js";
import {
  previewPassengerPushMaintenance, maintainPassengerPushData,
  PASSENGER_PUSH_REDACTED_TOKEN
} from "../src/core/passengerPushLifecycle.js";

// PUSH-01E: actual PHP signer -> real Worker router -> real SQLite SQL.
//
// No HTTP listener, curl, Cloudflare API, real orders, deployed secrets,
// Firebase network, or live FCM. The PHP file is from the public_html
// repository pinned by the workflow, NOT a reconstructed signature.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ORDER_A = "68516805-d870-4bc9-ac4a-43995df5bc05";
const ORDER_B = "16d9080a-72f1-439b-8d82-1eff62f28df0";
const INSTALL_A = "5d98e332-05e9-4e90-a4e1-bc61c1342030";
const INSTALL_B = "de96d36a-f64a-4d22-a31d-7cf80564f78a";
const ORDER_SECRET = "ci-order-signing-secret-not-used-anywhere-outside-tests-12345";
const PUSH_SECRET = "ci-push-signing-secret-independent-from-order-and-staff";
const PROXY_SECRET = "ci-php-worker-hmac-test-only-secret-with-adequate-length";
const STAFF_SECRET = "ci-staff-secret-unused-by-this-test-and-distinct-from-other";
const phpSource = path.join(process.cwd(), "_contract_php", "api", "_passenger_push_proxy_auth.php");
const legacyPhpSource = path.join(process.cwd(), "_contract_php", "api", "_proxy_auth.php");

if (!existsSync(phpSource)) {
  throw new Error("The real public_html/api/_proxy_auth.php checkout is required");
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "ts52-push-integration-"));
const apiFolder = path.join(tempRoot, "public_html", "api");
const secretsFolder = path.join(tempRoot, "transfer-private");
mkdirSync(apiFolder, { recursive: true });
mkdirSync(secretsFolder, { recursive: true });
const legacyAuthFile = path.join(apiFolder, "_proxy_auth.php");
const authFile = path.join(apiFolder, "_passenger_push_proxy_auth.php");
copyFileSync(legacyPhpSource, legacyAuthFile);
copyFileSync(phpSource, authFile);
writeFileSync(path.join(secretsFolder, "proxy-hmac-secret.txt"), PROXY_SECRET, { mode: 0o600 });
assert.ok(readFileSync(authFile, "utf8").includes("function buildPassengerPushAuthHeaders("));

function phpHmacHeaders(endpoint, rawBody, method = "POST") {
  const phpCode = [
    '$p = $argv[1];',
    '$auth = $argv[2];',
    'require $auth;',
    '$body = stream_get_contents(STDIN);',
    'echo json_encode(buildPassengerPushAuthHeaders($argv[3], $p, $body), JSON_THROW_ON_ERROR);'
  ].join(" ");
  const child = spawnSync("php", ["-r", phpCode, endpoint, authFile, method], {
    input: rawBody, encoding: "utf8", timeout: 9000
  });
  if (child.error || child.status !== 0) {
    throw new Error("PHP HMAC signer failed in isolated test");
  }
  const headers = JSON.parse(child.stdout);
  assert.equal(headers.length, 3);
  const map = {};
  for (const h of headers) {
    const at = h.indexOf(": ");
    assert.ok(at > 0);
    map[h.slice(0, at)] = h.slice(at + 2);
  }
  return map;
}

// node:sqlite uses anonymous binding. Re-map trusted numbered SQL
// placeholders (?1, ?2, including repeats) without changing SQL semantics.
function positionalSql(sql, args) {
  const ordered = [];
  const transformed = sql.replace(/\?([1-9][0-9]*)/g, (_, n) => {
    const index = Number(n) - 1;
    if (index >= args.length) throw new Error("Missing positional parameter");
    ordered.push(args[index]);
    return "?";
  });
  return [transformed, ordered];
}

class LocalD1 {
  constructor() {
    this.sqlite = new DatabaseSync(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    const migrations = path.join(process.cwd(), "migrations");
    for (let version = 1; version <= 8; version++) {
      const name = readFileSync(
        path.join(migrations, [
          "0001_transactional_core.sql", "0002_staff_auth.sql",
          "0003_staff_admin_audit.sql", "0004_staff_push_devices.sql",
          "0005_passenger_push_devices.sql", "0006_passenger_push_security.sql",
          "0007_passenger_push_grant_events.sql",
          "0008_passenger_push_proxy_nonces.sql"
        ][version - 1]), "utf8"
      );
      this.sqlite.exec(name);
    }
  }

  prepare(sql) {
    const sqlite = this.sqlite;
    return {
      bind(...args) {
        const [normalized, ordered] = positionalSql(sql, args);
        return {
          async first() {
            return sqlite.prepare(normalized).get(...ordered) ?? null;
          },
          async all() {
            return {
              success: true, results: sqlite.prepare(normalized).all(...ordered)
            };
          },
          async run() {
            const out = sqlite.prepare(normalized).run(...ordered);
            return { success: true, meta: { changes: Number(out.changes) } };
          }
        };
      }
    };
  }

  async batch(statements) {
    this.sqlite.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      this.sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  addOrder(id, status = "new") {
    // Node SQLite requires anonymous placeholders for this fixture INSERT.
    this.sqlite.prepare(
      "INSERT INTO orders(id,name,phone,route,trip_date,comment,status,created_at,updated_at)" +
      " VALUES (?, 'Test only', '+79990000000', 'A to B', '2026-12-15', '', ?, 1000, 1000)"
    ).run(id, status);
  }

  order(id) {
    return this.sqlite.prepare("SELECT * FROM orders WHERE id=?").get(id);
  }

  device(installationId) {
    return this.sqlite.prepare(
      "SELECT * FROM passenger_push_devices WHERE installation_id=?"
    ).get(installationId);
  }

  count(table) {
    // Literal test-owned table names only, never user input.
    const valid = ["staff_push_devices", "passenger_push_devices",
      "passenger_push_grant_uses", "passenger_push_grant_events",
      "passenger_push_proxy_nonces"];
    if (!valid.includes(table)) throw new Error("Unsupported table");
    return this.sqlite.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
  }

  close() { this.sqlite.close(); }
}

function fixture() {
  const DB = new LocalD1();
  DB.addOrder(ORDER_A, "new");
  DB.addOrder(ORDER_B, "new");
  const env = {
    DB,
    PASSENGER_PUSH_API_ENABLED: "true",
    PASSENGER_PUSH_DEVICES_ENABLED: "true",
    PASSENGER_ORDER_SECRET: ORDER_SECRET,
    PASSENGER_PUSH_GRANT_SECRET: PUSH_SECRET,
    PROXY_HMAC_SECRET: PROXY_SECRET,
    JWT_SECRET: STAFF_SECRET
  };
  return { env, DB };
}

async function readToken(orderId = ORDER_A) {
  return signJWT(ORDER_SECRET, {
    sub: orderId, scope: "passenger_order:read"
  }, 1800);
}

function requestWithPhpSignature(endpoint, method, body, opts = {}) {
  const signedBody = opts.signedBody ?? body;
  const headers = { "Content-Type": "application/json" };
  if (!opts.noSignature) {
    Object.assign(headers, phpHmacHeaders(
      opts.signedPath ?? endpoint, signedBody, opts.signedMethod ?? method
    ));
  }
  if (opts.changeSignature) headers["X-Proxy-Signature"] = "0".repeat(64);
  return new Request("https://local-worker.invalid" + endpoint, {
    method, headers, body
  });
}

async function dispatch(env, endpoint, method, object, options) {
  const raw = JSON.stringify(object);
  return router(requestWithPhpSignature(
    endpoint, method, raw, options
  ), env);
}

async function createGrant(env, orderId = ORDER_A, installationId = INSTALL_A) {
  const response = await dispatch(env, "/passenger/push-grant", "POST", {
    accessToken: await readToken(orderId), installationId
  });
  const payload = await response.json();
  assert.equal(response.status, 200, "grant issuance expected 200");
  assert.equal(payload.ok, true);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(typeof payload.grantToken, "string");
  return payload.grantToken;
}

async function run(name, action) {
  let fixtureResult;
  try {
    fixtureResult = fixture();
    await action(fixtureResult);
    process.stdout.write("PASS: " + name + "\n");
  } catch (error) {
    process.exitCode = 1;
    process.stderr.write("FAIL: " + name + ": " + error.message + "\n");
  } finally {
    fixtureResult?.DB.close();
  }
}

try {
  await run("PHP HMAC -> Worker grant -> D1 register/revoke", async ({ env, DB }) => {
    const before = DB.order(ORDER_A);
    const grantToken = await createGrant(env);
    const register = await dispatch(env, "/passenger/push-device", "POST", {
      grantToken, platform: "android", token: "test-only-fcm-token-a"
    });
    assert.equal(register.status, 200);
    assert.deepEqual(await register.json(), { ok: true });
    assert.equal(DB.device(INSTALL_A).fcm_token, "test-only-fcm-token-a");

    const replay = await dispatch(env, "/passenger/push-device", "POST", {
      grantToken, platform: "android", token: "replayed-token"
    });
    assert.equal(replay.status, 409);
    assert.equal(DB.device(INSTALL_A).fcm_token, "test-only-fcm-token-a");
    assert.equal(DB.count("passenger_push_grant_uses"), 1);

    const revokeGrant = await createGrant(env);
    const revoke = await dispatch(env, "/passenger/push-device", "DELETE", {
      grantToken: revokeGrant
    });
    assert.equal(revoke.status, 200);
    assert.notEqual(DB.device(INSTALL_A).revoked_at, null);
    // FCM credential is destroyed in the SAME D1 transaction as revoke.
    assert.equal(DB.device(INSTALL_A).fcm_token, PASSENGER_PUSH_REDACTED_TOKEN);
    const newGrant = await createGrant(env);
    const refused = await dispatch(env, "/passenger/push-device", "POST", {
      grantToken: newGrant, platform: "android", token: "should-never-register"
    });
    assert.equal(refused.status, 409);

    assert.equal(DB.count("staff_push_devices"), 0);
    assert.equal(DB.order(ORDER_A).status, before.status);
    assert.equal(DB.order(ORDER_A).price_rub, before.price_rub);
  });

  await run("foreign installation cannot be rebound to another order", async ({ env, DB }) => {
    const grantA = await createGrant(env);
    assert.equal((await dispatch(env, "/passenger/push-device", "POST", {
      grantToken: grantA, platform: "android", token: "fcm-owner-a"
    })).status, 200);

    const foreignGrant = await createGrant(env, ORDER_B, INSTALL_A);
    const conflict = await dispatch(env, "/passenger/push-device", "POST", {
      grantToken: foreignGrant, platform: "android", token: "fcm-attacker"
    });
    assert.equal(conflict.status, 409);
    assert.equal(DB.device(INSTALL_A).order_id, ORDER_A);
    assert.equal(DB.device(INSTALL_A).fcm_token, "fcm-owner-a");
  });

  await run("PHP HMAC missing, altered and wrong path are rejected", async ({ env, DB }) => {
    const token = await readToken();
    const object = { accessToken: token, installationId: INSTALL_A };
    for (const opt of [
      { noSignature: true }, { changeSignature: true },
      { signedPath: "/passenger/push-device" },
      { signedBody: JSON.stringify(object) + " " }
    ]) {
      const response = await dispatch(
        env, "/passenger/push-grant", "POST", object, opt
      );
      assert.equal(response.status, 403);
    }
    assert.equal(DB.count("passenger_push_grant_events"), 0);
    assert.equal(DB.count("passenger_push_devices"), 0);
  });

  await run("signed HMAC replay denied before issuing another grant", async ({ env, DB }) => {
    const raw = JSON.stringify({
      accessToken: await readToken(), installationId: INSTALL_A
    });
    const headers = {
      "Content-Type": "application/json",
      ...phpHmacHeaders("/passenger/push-grant", raw)
    };
    const signed = () => new Request(
      "https://local-worker.invalid/passenger/push-grant",
      { method: "POST", headers, body: raw }
    );
    const first = await router(signed(), env);
    assert.equal(first.status, 200);
    const second = await router(signed(), env);
    assert.equal(second.status, 403);
    assert.equal(DB.count("passenger_push_grant_events"), 1);
    assert.equal(DB.count("passenger_push_proxy_nonces"), 1);
  });

  await run("passenger proxy method and nonce are authenticated", async ({ env, DB }) => {
    const grant = await createGrant(env);
    const body = JSON.stringify({ grantToken: grant });
    const valid = phpHmacHeaders("/passenger/push-device", body, "POST");
    // A POST signature cannot be replayed as DELETE.
    const wrongMethod = await router(new Request(
      "https://local-worker.invalid/passenger/push-device",
      { method: "DELETE", headers: valid, body }
    ), env);
    assert.equal(wrongMethod.status, 403);
    const missingNonce = { ...valid };
    delete missingNonce["X-Proxy-Nonce"];
    const noNonce = await router(new Request(
      "https://local-worker.invalid/passenger/push-device",
      { method: "POST", headers: missingNonce, body }
    ), env);
    assert.equal(noNonce.status, 403);
    const alteredNonce = { ...valid, "X-Proxy-Nonce": "f".repeat(32) };
    const changed = await router(new Request(
      "https://local-worker.invalid/passenger/push-device",
      { method: "POST", headers: alteredNonce, body }
    ), env);
    assert.equal(changed.status, 403);
    assert.equal(DB.count("passenger_push_devices"), 0);
  });

  await run("disabled features do not touch D1", async ({ env, DB }) => {
    const payload = { accessToken: await readToken(), installationId: INSTALL_A };
    const disabled = await dispatch(
      { ...env, PASSENGER_PUSH_API_ENABLED: undefined },
      "/passenger/push-grant", "POST", payload
    );
    assert.equal(disabled.status, 503);
    const disabledDevices = await dispatch(
      { ...env, PASSENGER_PUSH_DEVICES_ENABLED: undefined },
      "/passenger/push-device", "POST",
      { grantToken: "dummy", platform: "android", token: "dummy" }
    );
    assert.equal(disabledDevices.status, 503);
    assert.equal(DB.count("passenger_push_grant_events"), 0);
    assert.equal(DB.count("passenger_push_devices"), 0);
  });

  await run("done/canceled order blocks grant and registration", async ({ env, DB }) => {
    DB.sqlite.prepare("UPDATE orders SET status='canceled' WHERE id=?").run(ORDER_B);
    const denied = await dispatch(env, "/passenger/push-grant", "POST", {
      accessToken: await readToken(ORDER_B), installationId: INSTALL_B
    });
    assert.equal(denied.status, 403);

    const grant = await createGrant(env);
    DB.sqlite.prepare("UPDATE orders SET status='done' WHERE id=?").run(ORDER_A);
    const rejected = await dispatch(env, "/passenger/push-device", "POST", {
      grantToken: grant, platform: "android", token: "too-late"
    });
    assert.equal(rejected.status, 409);
    assert.equal(DB.count("passenger_push_devices"), 0);
  });

  await run("manual lifecycle redacts completed-order token without FCM", async ({ env, DB }) => {
    const grant = await createGrant(env);
    assert.equal((await dispatch(env, "/passenger/push-device", "POST", {
      grantToken: grant, platform: "android", token: "expire-in-memory"
    })).status, 200);
    DB.sqlite.prepare("UPDATE orders SET status='done' WHERE id=?").run(ORDER_A);
    const preview = await previewPassengerPushMaintenance(env);
    assert.equal(preview.eligibleDeviceTokens, 1);
    const result = await maintainPassengerPushData(env);
    assert.equal(result.redacted, 1);
    assert.equal(DB.device(INSTALL_A).fcm_token, PASSENGER_PUSH_REDACTED_TOKEN);
    assert.notEqual(DB.device(INSTALL_A).revoked_at, null);
    assert.equal(DB.count("staff_push_devices"), 0);
  });

  await run("revoke reserve remains inside five-total shared quota", async ({ env, DB }) => {
    const read = await readToken();
    async function issue(operation) {
      const payload = { accessToken: read, installationId: INSTALL_A };
      if (operation) payload.operation = operation;
      return dispatch(env, "/passenger/push-grant", "POST", payload);
    }
    for (let i = 0; i < 4; i++) {
      assert.equal((await issue(null)).status, 200);
    }
    assert.equal((await issue(null)).status, 429);
    const response = await issue("revoke");
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    assert.equal((await issue(null)).status, 429);
    assert.equal((await issue("revoke")).status, 429);
    assert.equal(DB.count("passenger_push_grant_events"), 5);
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (process.exitCode) throw new Error("PUSH-01E isolated integration failed");
console.log("PASSENGER_PUSH_PHP_WORKER_D1_ISOLATED=PASS");
