import { isStagingEnvironment } from "./deploymentEnvironment.js";

// =========================
// TELEGRAM
// =========================

export async function tgSend(
  env,
  text
) {
  const staging = isStagingEnvironment(env);

  // Staging is OFF by default. Only an explicit opt-in AND a separate
  // test bot/chat can enable it. Never fall back to production TG secrets.
  // Driver FCM remains disabled independently in staging.
  if (
    staging &&
    String(env?.STAGING_TELEGRAM_ENABLED ?? "")
      .trim()
      .toLowerCase() !== "true"
  ) {
    return { ok: true, skipped: true };
  }

  // =========================
  // CONFIG
  // =========================

  const token =
    String(
      (staging ? env?.STAGING_TG_BOT_TOKEN : env?.TG_BOT_TOKEN) || ""
    ).trim();

  const chatId =
    String(
      (staging ? env?.STAGING_TG_CHAT_ID : env?.TG_CHAT_ID) || ""
    ).trim();

  if (!token) {
    throw new Error(
      staging
        ? "Telegram: STAGING_TG_BOT_TOKEN is missing"
        : "Telegram: TG_BOT_TOKEN is missing"
    );
  }

  if (!chatId) {
    throw new Error(
      staging
        ? "Telegram: STAGING_TG_CHAT_ID is missing"
        : "Telegram: TG_CHAT_ID is missing"
    );
  }

  // =========================
  // MESSAGE
  // =========================

  const rawMessage =
    String(text || "").trim();

  if (!rawMessage) {
    throw new Error(
      "Telegram: empty message"
    );
  }

  const message =
    `${staging ? "[ТЕСТ / STAGING] " : ""}${rawMessage}`
      .slice(0, 4000);

  // =========================
  // REQUEST
  // =========================

  const url =
    `https://api.telegram.org/bot${token}/sendMessage`;

  let response;

  try {

    response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            chat_id: chatId,
            text: message
          })
        }
      );

  } catch (error) {

    console.error(
      "TELEGRAM NETWORK ERROR:",
      error
    );

    throw new Error(
      "Telegram network error"
    );
  }

  // =========================
  // RESPONSE
  // =========================

  const data =
    await response
      .json()
      .catch(
        () => null
      );

  if (
    !response.ok ||
    !data ||
    data.ok !== true
  ) {

    console.error(
      "TELEGRAM API ERROR:",
      {
        status:
          response.status,

        statusText:
          response.statusText,

        errorCode:
          data?.error_code,

        description:
          data?.description
      }
    );

    throw new Error(
      data?.description ||
      `Telegram HTTP ${response.status}`
    );
  }

  console.log(
    "TELEGRAM SENT:",
    {
      messageId:
        data.result?.message_id,

      chatId:
        data.result?.chat?.id
    }
  );

  return {
    ok: true,

    messageId:
      data.result?.message_id
  };
}