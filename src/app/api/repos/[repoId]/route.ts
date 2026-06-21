import { serverFetch } from "@/lib/server-api"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await context.params
  const body = await request.json()
  const { response, data } = await serverFetch(`/repos/${repoId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
  return Response.json(data, { status: response.status })
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await context.params
  const body = await request.text()
  const { response, data } = await serverFetch(`/repos/${repoId}`, {
    method: "DELETE",
    body: body || undefined,
  })
  return Response.json(data, { status: response.status })
}
