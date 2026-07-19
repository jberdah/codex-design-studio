// Returns the parsed JSON object body, or null when the body is missing,
// malformed, or not an object — callers turn null into a 400 response
// instead of letting request.json() escalate to an opaque 500.
export async function readJsonBody<T extends object>(request: Request): Promise<T | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== "object") return null;
  return body as T;
}
