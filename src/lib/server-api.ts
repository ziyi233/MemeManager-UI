const SERVER_ORIGIN = process.env.SERVER_API_ORIGIN?.trim() || "http://127.0.0.1:3001"

async function parseJson(response: Response) {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>
}

export async function serverFetch(path: string, init?: RequestInit) {
  const response = await fetch(`${SERVER_ORIGIN}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
    cache: "no-store",
  })

  const data = await parseJson(response)
  return { response, data }
}

export { SERVER_ORIGIN }
