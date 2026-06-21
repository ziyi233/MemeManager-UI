import { serverFetch } from "@/lib/server-api"

export async function POST(
  request: Request,
  context: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await context.params
  const body = await request.text()
  const { response, data } = await serverFetch(`/repos/${repoId}/sync`, {
    method: "POST",
    body: body || JSON.stringify({}),
  })
  return Response.json(data, { status: response.status })
}
