import { serverFetch } from "@/lib/server-api"

export async function POST() {
  const { response, data } = await serverFetch("/meme-api/reload", {
    method: "POST",
    body: JSON.stringify({}),
  })
  return Response.json(data, { status: response.status })
}
