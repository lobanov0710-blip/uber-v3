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
      await response.body?.cancel().catch(() => {});

      console.error(
        "HTTP ERROR:",
        {
          status: response.status
        }
      );

      const error =
        new Error(
          "Upstream request failed"
        );

      error.status =
        response.status;

      throw error;
    }

    return await response.json();

  } catch (error) {
    console.error(
      "FETCH ERROR:",
      { status: Number.isInteger(error?.status) ? error.status : 0 }
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
