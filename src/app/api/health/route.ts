import { serverFetch } from "@/lib/server-api"

export async function GET() {
  const { response, data } = await serverFetch("/health")
  return Response.json(data, { status: response.status })
}
