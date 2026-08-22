export async function fetchJSON(
  url,
  options = {},
  retries = 2
) {
  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      10000
    );

  try {
    const response =
      await fetch(
        url,
        {
          ...options,
          signal: controller.signal
        }
      );

    if (!response.ok) {
      const body =
        await response
          .text()
          .catch(() => "");

      console.error(
        "HTTP ERROR:",
        {
          url,
          status: response.status,
          statusText:
            response.statusText,
          body:
            body.slice(0, 500)
        }
      );

      const error =
        new Error(
          `HTTP ${response.status} ${response.statusText}`
        );

      error.status =
        response.status;

      throw error;
    }

    return await response.json();

  } catch (error) {
    console.error(
      "FETCH ERROR:",
      url,
      error
    );

    const status =
      Number(error?.status || 0);

    // =========================
    // DO NOT RETRY CLIENT ERRORS
    // =========================
    if (
      status >= 400 &&
      status < 500 &&
      status !== 429
    ) {
      throw error;
    }

    // =========================
    // RETRY NETWORK / 429 / 5xx
    // =========================
    if (retries > 0) {
      return fetchJSON(
        url,
        options,
        retries - 1
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}