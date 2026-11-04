import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import router from "../src/router.js";
import { signJWT } from "../src/core/auth.js";

// Only 127.0.0.1 networking. Actual PHP HTTP handlers/cURL -> original
// Worker router in local Node HTTP -> actual SQLite migrations/queries.
// No remote Cloudflare, no real FCM or real orders.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const ORDER = "68516805-d870-4bc9-ac4a-43995df5bc05";
const INSTALL = "5d98e332-05e9-4e90-a4e1-bc61c1342030";
const READ_KEY = "test-passenger-read-isolated-ci-key-only-64-characters-abc";
const PUSH_KEY = "test-push-grant-isolated-ci-key-only-64-characters-def";
const HMAC_KEY = "test-proxy-hmac-isolated-ci-key-only-64-characters-ghi";
const STAFF_KEY = "test-staff-unused-isolated-ci-key-only-64-characters-jkl";
const SOURCE_HOST = "https://uber-v3.lobanov0710.workers.dev";

function normalized(sql, args) {
  const result = [];
  const text = sql.replace(/\?([1-9]\d*)/g, (_, number) => {
    const index = Number(number) - 1;
    if (index >= args.length) throw new Error("Missing SQL positional bind");
    result.push(args[index]);
    return "?";
  });
  return [text, result];
}

class LocalD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    this.db.exec("PRAGMA foreign_keys=ON");
    const files = [
      "0001_transactional_core.sql", "0002_staff_auth.sql",
      "0003_staff_admin_audit.sql", "0004_staff_push_devices.sql",
      "0005_passenger_push_devices.sql", "0006_passenger_push_security.sql",
      "0007_passenger_push_grant_events.sql",
      "0008_passenger_push_proxy_nonces.sql"
    ];
    for (const file of files)
      this.db.exec(readFileSync(path.resolve("migrations", file), "utf8"));
    this.db.prepare("INSERT INTO orders(id,name,phone,route,trip_date,comment,status,created_at,updated_at) VALUES (?, 'Fixture', '+79990000000', 'A to B', '2026-12-15', '', 'new', 1000, 1000)").run(ORDER);
  }
  prepare(sql) {
    const db = this.db;
    return {
      bind(...args) {
        const [query, values] = normalized(sql, args);
        return {
          async first() { return db.prepare(query).get(...values) ?? null; },
          async all() { return { success: true, results: db.prepare(query).all(...values) }; },
          async run() {
            return { success: true, meta: { changes: Number(db.prepare(query).run(...values).changes) } };
          }
        };
      }
    };
  }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  scalar(table) {
    if (!new Set(["orders", "staff_push_devices", "passenger_push_grant_uses",
      "passenger_push_proxy_nonces", "passenger_push_grant_events"]).has(table)) {
      throw new Error("Invalid table");
    }
    return this.db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
  }
  device() {
    return this.db.prepare(
      "SELECT * FROM passenger_push_devices WHERE installation_id=?"
    ).get(INSTALL);
  }
}

async function listen(server) {
  await new Promise((yes, no) => {
    server.once("error", no);
    server.listen(0, "127.0.0.1", yes);
  });
  return server.address().port;
}
async function unusedPort() {
  const s = createServer();
  const port = await listen(s);
  await new Promise(done => s.close(done));
  return port;
}

function temporaryPhp(temp, port) {
  const root = path.join(temp, "public_html");
  const api = path.join(root, "api");
  const privateDir = path.join(temp, "transfer-private");
  mkdirSync(api, { recursive: true });
  mkdirSync(privateDir, { recursive: true });
  const files = ["_proxy_auth.php", "_passenger_push_proxy_auth.php",
    "_passenger_push_grant_validation.php",
    "passenger-push-grant.php", "passenger-push-device.php"];
  for (const file of files) {
    let src = readFileSync(path.join("_contract_php", "api", file), "utf8");
    if (file.startsWith("passenger-push-")) {
      // A test-only URL rewrite of a temp copy; NEVER the git working tree.
      const old = SOURCE_HOST + "/passenger/push-";
      assert.equal(src.split(old).length - 1, 1, "Upstream URL must be pinned");
      src = src.replace(old, "http://127.0.0.1:" + port + "/passenger/push-");
      assert.ok(!src.includes(SOURCE_HOST), "No public upstream can remain");
    }
    writeFileSync(path.join(api, file), src, { mode: 0o600 });
  }
  writeFileSync(path.join(privateDir, "proxy-hmac-secret.txt"),
    HMAC_KEY, { mode: 0o600 });
  return { root, privateDir };
}

async function run() {
  const DB = new LocalD1();
  const env = {
    DB,
    PASSENGER_PUSH_API_ENABLED: "true",
    PASSENGER_PUSH_DEVICES_ENABLED: "true",
    PASSENGER_ORDER_SECRET: READ_KEY,
    PASSENGER_PUSH_GRANT_SECRET: PUSH_KEY,
    PROXY_HMAC_SECRET: HMAC_KEY,
    JWT_SECRET: STAFF_KEY
  };
  const worker = createServer(async (req, res) => {
    try {
      const chunks = [];
      let length = 0;
      for await (const item of req) {
        length += item.length;
        if (length > 16384) throw new Error("Oversized");
        chunks.push(item);
      }
      const headers = Object.entries(req.headers).map(([k,v]) =>
        [k, Array.isArray(v) ? v.join(",") : v]);
      const request = new Request("http://127.0.0.1" + req.url, {
        method: req.method, headers,
        body: req.method === "GET" ? undefined : Buffer.concat(chunks)
      });
      const result = await router(request, env);
      res.writeHead(result.status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
      });
      res.end(await result.text());
    } catch {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end('{"ok":false,"error":"isolated harness error"}');
    }
  });
  const temp = mkdtempSync(path.join(tmpdir(), "ts52-push-http-"));
  let php;
  try {
    const workerPort = await listen(worker);
    const { root, privateDir } = temporaryPhp(temp, workerPort);
    const phpPort = await unusedPort();
    php = spawn("php", ["-S", "127.0.0.1:" + phpPort, "-t", root], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    // Never expose bearer token or HTTP trace.
    php.stdout.on("data", () => {});
    php.stderr.on("data", () => {});
    const origin = "http://127.0.0.1:" + phpPort;
    const grantUrl = origin + "/api/passenger-push-grant.php";
    const deviceUrl = origin + "/api/passenger-push-device.php";
    let started = false;
    for (let i = 0; i < 80; i++) {
      if (php.exitCode !== null) throw new Error("PHP server terminated");
      try {
        const response = await fetch(grantUrl);
        if (response.status === 405) { started = true; break; }
      } catch {}
      await new Promise(done => setTimeout(done, 100));
    }
    assert.ok(started, "Local PHP HTTP service not ready");

    async function post(url, method, object) {
      const response = await fetch(url, {
        method, headers: { "Content-Type": "application/json" },
        body: JSON.stringify(object)
      });
      assert.equal(response.headers.get("Cache-Control"), "no-store");
      return { status: response.status, body: await response.json() };
    }
    assert.equal((await post(grantUrl, "POST", {
      accessToken: "invalid", installationId: INSTALL
    })).status, 503);
    assert.equal((await post(deviceUrl, "DELETE", { grantToken: "invalid" })).status, 503);
    assert.equal(DB.scalar("passenger_push_proxy_nonces"), 0);

    // Opt-in files are created ONLY in OS temporary directory.
    writeFileSync(path.join(privateDir, "passenger-push-gateway-enabled.flag"), "enabled");
    writeFileSync(path.join(privateDir, "passenger-push-device-enabled.flag"), "enabled");

    assert.equal((await post(grantUrl, "POST", {
      accessToken: "invalid", installationId: INSTALL
    })).status, 403);

    // Signed-but-expired read capability may not obtain a revoke grant.
    // A fractional TTL rounds down to an already-expired JWT.
    const expired = await signJWT(READ_KEY,
      { sub: ORDER, scope: "passenger_order:read" }, 0.5);
    assert.equal((await post(grantUrl, "POST", {
      accessToken: expired, installationId: INSTALL, operation: "revoke"
    })).status, 403);
    assert.equal(DB.scalar("passenger_push_grant_events"), 0);

    const readToken = await signJWT(READ_KEY,
      { sub: ORDER, scope: "passenger_order:read" }, 1800);
    async function grant(operation = null) {
      const body = { accessToken: readToken, installationId: INSTALL };
      if (operation !== null) body.operation = operation;
      const response = await post(grantUrl, "POST", body);
      assert.equal(response.status, 200, "Expected new grant");
      assert.equal(typeof response.body.grantToken, "string");
      return response.body.grantToken;
    }

    const first = await grant();
    assert.equal((await post(deviceUrl, "POST", {
      grantToken: first, platform: "android", token: "test-only-fcm-not-real"
    })).status, 200);
    assert.equal(DB.device().fcm_token, "test-only-fcm-not-real");

    // New PHP nonce cannot make an already-consumed grant usable again.
    assert.equal((await post(deviceUrl, "POST", {
      grantToken: first, platform: "android", token: "attempted-replay"
    })).status, 409);
    assert.equal(DB.device().fcm_token, "test-only-fcm-not-real");

    // A narrow revoke-only JWT must fail POST without consuming its jti.
    assert.equal((await post(grantUrl, "POST", {
      accessToken: readToken, installationId: INSTALL, operation: "manage"
    })).status, 400);
    const narrowRevoke = await grant("revoke");
    assert.equal((await post(deviceUrl, "POST", {
      grantToken: narrowRevoke, platform: "android", token: "cannot-enroll"
    })).status, 403);
    assert.equal(DB.device().fcm_token, "test-only-fcm-not-real");
    assert.equal((await post(deviceUrl, "DELETE", {
      grantToken: narrowRevoke
    })).status, 200);
    assert.notEqual(DB.device().revoked_at, null);

    assert.equal((await post(deviceUrl, "POST", {
      grantToken: await grant(), platform: "android", token: "must-fail"
    })).status, 409);

    assert.equal(DB.scalar("orders"), 1);
    assert.equal(DB.scalar("staff_push_devices"), 0);
    assert.equal(DB.scalar("passenger_push_grant_uses"), 3);
    // Three existing grants (manage, revoke, manage) + one more manage = four.
    assert.equal(typeof (await grant()), "string");
    assert.equal((await post(grantUrl, "POST", {
      accessToken: readToken, installationId: INSTALL
    })).status, 429);
    // The fifth grant remains reserved exclusively for a narrow revoke.
    assert.equal(typeof (await grant("revoke")), "string");
    assert.equal((await post(grantUrl, "POST", {
      accessToken: readToken, installationId: INSTALL, operation: "revoke"
    })).status, 429);
    assert.equal(DB.scalar("passenger_push_grant_events"), 5);
    assert.equal(DB.scalar("passenger_push_grant_uses"), 3);
    assert.equal(DB.db.prepare("SELECT status FROM orders WHERE id=?")
      .get(ORDER).status, "new");
    console.log("PUSH_01J_LOCAL_HTTP_QUOTA_AND_EXPIRED_READ=PASS");
  } finally {
    if (php && php.exitCode === null) php.kill("SIGTERM");
    if (worker.listening) await new Promise(done => worker.close(done));
    DB.db.close();
    rmSync(temp, { recursive: true, force: true });
  }
}
await run();
