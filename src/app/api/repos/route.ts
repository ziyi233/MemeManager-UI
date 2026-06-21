import { serverFetch } from "@/lib/server-api"

export async function GET() {
  const { response, data } = await serverFetch("/repos")
  return Response.json(data, { status: response.status })
}

export async function POST(request: Request) {
  const body = await request.json()
  const { response, data } = await serverFetch("/repos", {
    method: "POST",
    body: JSON.stringify(body),
  })
  return Response.json(data, { status: response.status })
}
