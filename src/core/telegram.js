// =========================
// TELEGRAM
// =========================

export async function tgSend(
  env,
  text
) {

  // =========================
  // CONFIG
  // =========================

  const token =
    String(
      env?.TG_BOT_TOKEN || ""
    ).trim();

  const chatId =
    String(
      env?.TG_CHAT_ID || ""
    ).trim();

  if (!token) {
    throw new Error(
      "Telegram: TG_BOT_TOKEN is missing"
    );
  }

  if (!chatId) {
    throw new Error(
      "Telegram: TG_CHAT_ID is missing"
    );
  }

  // =========================
  // MESSAGE
  // =========================

  const message =
    String(text || "")
      .trim()
      .slice(0, 4000);

  if (!message) {
    throw new Error(
      "Telegram: empty message"
    );
  }

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