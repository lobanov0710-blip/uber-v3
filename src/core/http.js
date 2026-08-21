export async function fetchJSON(url, options = {}, retries = 2) {

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!res.ok) throw new Error("bad response");

    return await res.json();

  } catch (e) {

    if (retries > 0) {
      return fetchJSON(url, options, retries - 1);
    }

    throw e;

  } finally {
    clearTimeout(timeout);
  }
}