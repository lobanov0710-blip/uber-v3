import readline
  from "node:readline";

import readlinePromises
  from "node:readline/promises";

import {
  stdin as input,
  stdout as output
} from "node:process";

import {
  mkdir,
  writeFile
} from "node:fs/promises";

import path
  from "node:path";

import {
  fileURLToPath
} from "node:url";

import {
  createAdminBootstrapAccount,
  buildStaffAccountInsertSql
} from "../src/core/staffProvisioning.js";


// =========================================
// PROJECT ROOT
// =========================================
//
// Resolve paths from this script itself,
// not from process.cwd().
//
// This keeps bootstrap output inside the
// repository even if the script is invoked
// from another working directory.
// =========================================

const scriptFile =
  fileURLToPath(
    import.meta.url
  );

const scriptDirectory =
  path.dirname(
    scriptFile
  );

const projectRoot =
  path.resolve(
    scriptDirectory,
    ".."
  );


// =========================================
// HELP
// =========================================

function printHelp() {

  output.write(
    [
      "",
      "Transfer Servis staff bootstrap",
      "",
      "Usage:",
      "  npm run staff:bootstrap-admin",
      "",
      "The command interactively asks for:",
      "  - admin login",
      "  - display name",
      "  - password",
      "  - password confirmation",
      "",
      "Password input is hidden.",
      "",
      "The command only creates a local SQL file:",
      "  .staff-bootstrap/*.sql",
      "",
      "It does NOT modify local or remote D1.",
      "",
      "Do not pass passwords through command-line arguments.",
      ""
    ].join(
      "\n"
    )
  );
}


// =========================================
// ARGUMENTS
// =========================================

function validateArguments() {

  const args =
    process.argv.slice(
      2
    );


  if (
    args.length === 0
  ) {

    return {
      help:
        false
    };
  }


  if (
    args.length === 1
    &&
    (
      args[0] === "--help"
      ||
      args[0] === "-h"
    )
  ) {

    return {
      help:
        true
    };
  }


  throw new Error(
    "Do not pass staff credentials through command-line arguments"
  );
}


// =========================================
// INTERACTIVE TERMINAL
// =========================================

function requireInteractiveTerminal() {

  if (
    input.isTTY !== true
    ||
    output.isTTY !== true
    ||
    typeof input.setRawMode !==
      "function"
  ) {

    throw new Error(
      "An interactive terminal is required"
    );
  }
}


// =========================================
// VISIBLE INPUT
// =========================================

async function readVisibleInputs() {

  const interfaceInstance =
    readlinePromises
      .createInterface({
        input,
        output
      });


  try {

    const login =
      await interfaceInstance
        .question(
          "Admin login: "
        );


    const displayName =
      await interfaceInstance
        .question(
          "Display name: "
        );


    return {
      login,
      displayName
    };

  } finally {

    interfaceInstance.close();
  }
}


// =========================================
// REMOVE LAST CHARACTER
// =========================================

function removeLastCharacter(
  value
) {

  const characters =
    Array.from(
      value
    );


  characters.pop();


  return characters.join(
    ""
  );
}


// =========================================
// HIDDEN INPUT
// =========================================
//
// Nothing is echoed to the terminal.
//
// Ctrl+C safely aborts the command.
//
// JavaScript strings cannot be securely
// zeroed in memory. We therefore keep
// plaintext references for the shortest
// practical period and explicitly release
// them after hashing.
// =========================================

async function readHidden(
  prompt
) {

  requireInteractiveTerminal();


  return new Promise(
    (
      resolve,
      reject
    ) => {

      let value =
        "";


      const previousRawMode =
        input.isRaw === true;


      let finished =
        false;


      const cleanup =
        () => {

          if (finished) {

            return;
          }


          finished =
            true;


          input.removeListener(
            "keypress",
            onKeypress
          );


          input.setRawMode(
            previousRawMode
          );


          input.pause();
        };


      const finish =
        result => {

          cleanup();

          output.write(
            "\n"
          );

          resolve(
            result
          );
        };


      const abort =
        () => {

          value =
            "";

          cleanup();

          output.write(
            "\n"
          );

          reject(
            new Error(
              "Bootstrap cancelled"
            )
          );
        };


      const onKeypress =
        (
          text,
          key = {}
        ) => {

          if (
            key.ctrl === true
            &&
            key.name === "c"
          ) {

            abort();

            return;
          }


          if (
            key.name === "return"
            ||
            key.name === "enter"
          ) {

            const result =
              value;

            value =
              "";

            finish(
              result
            );

            return;
          }


          if (
            key.name === "backspace"
          ) {

            value =
              removeLastCharacter(
                value
              );

            return;
          }


          if (
            key.ctrl === true
            ||
            key.meta === true
            ||
            key.name === "escape"
            ||
            key.name === "tab"
          ) {

            return;
          }


          if (
            typeof text ===
              "string"
            &&
            text.length > 0
          ) {

            value +=
              text;
          }
        };


      readline.emitKeypressEvents(
        input
      );


      input.setRawMode(
        true
      );


      input.resume();


      input.on(
        "keypress",
        onKeypress
      );


      output.write(
        prompt
      );
    }
  );
}


// =========================================
// PASSWORD
// =========================================

async function readPassword() {

  let password =
    null;

  let confirmation =
    null;


  try {

    password =
      await readHidden(
        "Password (hidden): "
      );


    confirmation =
      await readHidden(
        "Repeat password (hidden): "
      );


    if (
      password !==
        confirmation
    ) {

      throw new Error(
        "Passwords do not match"
      );
    }


    return password;

  } finally {

    confirmation =
      null;
  }
}


// =========================================
// FILE NAME
// =========================================

function bootstrapFileName(
  account
) {

  const timestamp =
    new Date(
      account.createdAt
    )
      .toISOString()
      .replace(
        /[:.]/g,
        "-"
      );


  const idSuffix =
    account.id
      .slice(
        -8
      );


  return (
    `admin-${timestamp}-${idSuffix}.sql`
  );
}


// =========================================
// SQL FILE
// =========================================

async function writeBootstrapSql(
  account
) {

  // Validate/build SQL before creating any
  // filesystem artifact.
  const sql =
    buildStaffAccountInsertSql(
      account
    );


  const directory =
    path.join(
      projectRoot,
      ".staff-bootstrap"
    );


  const filename =
    bootstrapFileName(
      account
    );


  const filePath =
    path.join(
      directory,
      filename
    );


  const content =
    [
      "-- =========================================",
      "-- Transfer Servis",
      "-- Staff administrator bootstrap",
      "--",
      "-- GENERATED LOCALLY.",
      "--",
      "-- This file contains a password verifier,",
      "-- never the plaintext password.",
      "--",
      "-- INSERT only.",
      "-- Existing login/id will fail instead of",
      "-- being overwritten.",
      "-- =========================================",
      "",
      sql
    ].join(
      "\n"
    );


  await mkdir(
    directory,
    {
      recursive:
        true,

      mode:
        0o700
    }
  );


  // wx:
  //
  // create new file only;
  // fail if this exact path already exists.
  await writeFile(
    filePath,
    content,
    {
      encoding:
        "utf8",

      flag:
        "wx",

      mode:
        0o600
    }
  );


  return filePath;
}


// =========================================
// MAIN
// =========================================

async function main() {

  const options =
    validateArguments();


  if (
    options.help
  ) {

    printHelp();

    return;
  }


  requireInteractiveTerminal();


  output.write(
    "\nTransfer Servis - admin bootstrap\n\n"
  );


  const {
    login,
    displayName
  } =
    await readVisibleInputs();


  let password =
    null;

  let account;


  try {

    password =
      await readPassword();


    account =
      await createAdminBootstrapAccount({
        login,
        displayName,
        password
      });

  } finally {

    // JS strings are immutable and cannot
    // be reliably wiped from process
    // memory, but we deliberately remove
    // our application-level reference as
    // soon as hashing has completed or
    // failed.
    password =
      null;
  }


  const filePath =
    await writeBootstrapSql(
      account
    );


  const relativePath =
    path.relative(
      projectRoot,
      filePath
    );


  output.write(
    [
      "",
      "Bootstrap SQL created.",
      "",
      `Account ID:   ${account.id}`,
      `Login:        ${account.login}`,
      `Display name: ${account.displayName}`,
      `Role:         ${account.role}`,
      `Status:       ${account.status}`,
      "",
      `File: ${relativePath}`,
      "",
      "No D1 database was modified.",
      ""
    ].join(
      "\n"
    )
  );
}


// =========================================
// ENTRY POINT
// =========================================

main()
  .catch(
    error => {

      output.write(
        "\n"
      );


      console.error(
        "Bootstrap failed:",
        error instanceof Error
          ? error.message
          : "unknown error"
      );


      process.exitCode =
        1;
    }
  );