import { requestRepoSync } from "@/lib/meme-manager"

export async function POST(
  _request: Request,
  context: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await context.params
  const result = await requestRepoSync(repoId)
  return Response.json(result, { status: 202 })
}
