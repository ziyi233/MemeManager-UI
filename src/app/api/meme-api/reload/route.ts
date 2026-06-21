import { reloadMemeApi } from "@/lib/meme-manager"

export async function POST() {
  try {
    const result = await reloadMemeApi()
    return Response.json({ ok: true, ...result })
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "重载失败",
      },
      { status: 500 },
    )
  }
}
