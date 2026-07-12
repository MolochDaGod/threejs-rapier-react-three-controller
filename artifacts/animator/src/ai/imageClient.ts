/**
 * Client for the backend AI image route. Generates a pattern image from a text
 * prompt and returns it as a data URL the engine can load as a texture.
 *
 * The API is mounted at `/api` by the shared proxy regardless of the animator's
 * base path, so a root-relative `/api/...` URL is correct in dev and production.
 */

/**
 * Ask the backend to generate a pattern image. `getToken` supplies the Clerk
 * bearer (the route is auth-gated). Resolves to a `data:image/png;base64,...`
 * URL; rejects with a friendly message on failure.
 */
export async function requestPattern(
  prompt: string,
  getToken?: () => Promise<string | null>,
): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (getToken) {
    try {
      const token = await getToken();
      if (token) headers["Authorization"] = `Bearer ${token}`;
    } catch {
      // Fall through unauthenticated; the server will reject with 401.
    }
  }
  let res: Response;
  try {
    res = await fetch("/api/openai/generate-image", {
      method: "POST",
      headers,
      credentials: "include",
      body: JSON.stringify({ prompt }),
    });
  } catch {
    throw new Error("Couldn't reach the image service.");
  }
  if (!res.ok) {
    throw new Error(res.status === 401 ? "Please sign in to generate images." : "Image generation failed.");
  }
  const data = (await res.json()) as { dataUrl?: string };
  if (!data.dataUrl) throw new Error("No image was returned.");
  return data.dataUrl;
}
