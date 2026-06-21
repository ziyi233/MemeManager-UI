import { requestRemoveRepo, setRepoEnabled, updateRepoMemeRoot } from "@/lib/meme-manager"

export async function PATCH(
  request: Request,
  context: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await context.params
  const body = (await request.json()) as {
    enabled?: boolean
    customMemeRoot?: string
  }

  if (typeof body.customMemeRoot === "string") {
    await updateRepoMemeRoot(repoId, body.customMemeRoot)
    return Response.json({ ok: true })
  }

  if (typeof body.enabled === "boolean") {
    await setRepoEnabled(repoId, body.enabled)
    return Response.json({ ok: true })
  }

  return Response.json({ error: "无效请求" }, { status: 400 })
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await context.params
  const result = await requestRemoveRepo(repoId)
  return Response.json(result, { status: 202 })
}
