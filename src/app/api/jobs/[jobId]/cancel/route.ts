import { serverFetch } from "@/lib/server-api"

export async function POST(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await context.params
  const { response, data } = await serverFetch(`/jobs/${jobId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  })

  return Response.json(data, { status: response.status })
}
