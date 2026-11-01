import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

import {
  createQuote,
  QUOTE_TTL_SECONDS
} from "../src/core/quotes.js";


if (!globalThis.crypto) {
  globalThis.crypto =
    webcrypto;
}


// ========================================
// SIMPLE ASYNC TEST RUNNER
// ========================================

async function test(
  name,
  fn
) {
  try {

    await fn();

    console.log(
      `✓ ${name}`
    );

  } catch (error) {

    console.error(
      `✘ ${name}`
    );

    console.error(
      error
    );

    process.exitCode = 1;
  }
}


// ========================================
// FAKE D1
// ========================================

function createFakeDatabase(
  options = {}
) {

  const calls = [];

  const runResult =
    options.runResult ?? {
      success: true
    };

  const runError =
    options.runError ??
    null;

  const db = {

    prepare(sql) {

      const call = {
        sql,
        args: null
      };

      calls.push(
        call
      );

      return {

        bind(...args) {

          call.args =
            args;

          return this;
        },

        async run() {

          if (runError) {
            throw runError;
          }

          return runResult;
        }
      };
    }
  };

  return {
    db,
    calls
  };
}


// ========================================
// VALID INPUT
// ========================================

function validQuoteInput() {

  return {

    from: {
      query:
        "Нижний Новгород"
    },

    to: {
      query:
        "Москва"
    },

    tariff:
      "comfort",

    tariffName:
      "Комфорт",

    distance:
      420,

    duration:
      360,

    price:
      23100,

    pricePerKm:
      55,

    coefficient:
      1,

    minimumPrice:
      4000
  };
}


// ========================================
// D1 IS SOURCE OF TRUTH
// ========================================

await test(
  "quote is persisted in D1 before success",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();

    const quote =
      await createQuote(
        {
          DB: db
        },
        validQuoteInput()
      );

    assert.equal(
      calls.length,
      1
    );

    assert.match(
      calls[0].sql,
      /INSERT INTO quotes/i
    );

    assert.ok(
      Array.isArray(
        calls[0].args
      )
    );

    assert.equal(
      calls[0].args[0],
      quote.id
    );

    assert.equal(
      calls[0].args[1],
      "Нижний Новгород"
    );

    assert.equal(
      calls[0].args[2],
      "Москва"
    );

    assert.equal(
      calls[0].args[3],
      "comfort"
    );

    assert.equal(
      calls[0].args[4],
      "Комфорт"
    );

    assert.equal(
      calls[0].args[5],
      420
    );

    assert.equal(
      calls[0].args[6],
      360
    );

    assert.equal(
      calls[0].args[7],
      23100
    );
  }
);


// ========================================
// CANONICAL ADDRESS PERSISTENCE
// ========================================
// The live PROD-SMOKE quote displayed "Нижний Новгород"
// while D1 stored a typo from the original query.
// Quoted orders build their route from D1 place strings.
// These tests only use fake D1; they never call Mapbox,
// the live Worker, Telegram or Firebase.
// ========================================

await test(
  "quote stores canonical geocoder display names instead of typo queries",
  async () => {
    const { db, calls } = createFakeDatabase();

    const input = validQuoteInput();
    input.from = {
      query: "ниний новгород",
      displayName: "Нижний Новгород, Нижегородская область, Россия"
    };
    input.to = {
      query: "москва",
      displayName: "Москва, Россия"
    };

    const quote = await createQuote({ DB: db }, input);

    assert.equal(
      quote.from,
      "Нижний Новгород, Нижегородская область, Россия"
    );
    assert.equal(quote.to, "Москва, Россия");
    assert.equal(
      calls[0].args[1],
      "Нижний Новгород, Нижегородская область, Россия"
    );
    assert.equal(calls[0].args[2], "Москва, Россия");
  }
);

await test(
  "quote keeps a full geocoded street address for the quoted order",
  async () => {
    const { db, calls } = createFakeDatabase();
    const input = validQuoteInput();
    input.from = {
      query: "Красная площадь 1",
      displayName: "Красная площадь 1с1, Москва, Россия"
    };
    const quote = await createQuote({ DB: db }, input);

    assert.equal(
      quote.from,
      "Красная площадь 1с1, Москва, Россия"
    );
    assert.equal(calls[0].args[1], quote.from);
  }
);

await test(
  "quote falls back to query when geocoder display name is missing",
  async () => {
    const { db, calls } = createFakeDatabase();
    const input = validQuoteInput();
    input.from = {
      query: "Нижний Новгород",
      displayName: "   "
    };

    const quote = await createQuote({ DB: db }, input);

    assert.equal(quote.from, "Нижний Новгород");
    assert.equal(calls[0].args[1], "Нижний Новгород");
  }
);


// ========================================
// NO QUOTES KV REQUIRED
// ========================================

await test(
  "quote creation does not require QUOTES KV",
  async () => {

    const {
      db
    } =
      createFakeDatabase();

    const quote =
      await createQuote(
        {
          DB: db
        },
        validQuoteInput()
      );

    assert.ok(
      quote.id
    );

    assert.equal(
      quote.tariff,
      "comfort"
    );
  }
);


// ========================================
// TTL
// ========================================

await test(
  "quote expires after configured TTL",
  async () => {

    const {
      db
    } =
      createFakeDatabase();

    const quote =
      await createQuote(
        {
          DB: db
        },
        validQuoteInput()
      );

    assert.equal(
      quote.expiresAt -
        quote.createdAt,

      QUOTE_TTL_SECONDS *
        1000
    );
  }
);


// ========================================
// D1 FAILURE MUST PROPAGATE
// ========================================

await test(
  "D1 failure prevents quote creation success",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runError:
            new Error(
              "D1 unavailable"
            )
        }
      );

    await assert.rejects(
      () =>
        createQuote(
          {
            DB: db
          },
          validQuoteInput()
        ),

      /D1 unavailable/
    );
  }
);


// ========================================
// UNSUCCESSFUL D1 RESULT
// ========================================

await test(
  "unsuccessful D1 insert prevents quote success",
  async () => {

    const {
      db
    } =
      createFakeDatabase(
        {
          runResult: {
            success: false
          }
        }
      );

    await assert.rejects(
      () =>
        createQuote(
          {
            DB: db
          },
          validQuoteInput()
        ),

      /Quote insert failed/
    );
  }
);


// ========================================
// VALIDATION BEFORE PERSISTENCE
// ========================================

await test(
  "invalid quote is rejected before D1 write",
  async () => {

    const {
      db,
      calls
    } =
      createFakeDatabase();

    const input =
      validQuoteInput();

    input.distance = 0;

    await assert.rejects(
      () =>
        createQuote(
          {
            DB: db
          },
          input
        ),

      /Quote distance is invalid/
    );

    assert.equal(
      calls.length,
      0
    );
  }
);


console.log("");

if (!process.exitCode) {

  console.log(
    "✓ ALL QUOTE TESTS PASSED"
  );
}