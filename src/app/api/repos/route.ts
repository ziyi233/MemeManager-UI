import { addRepo, getDashboardData } from "@/lib/meme-manager"

export async function GET() {
  const data = await getDashboardData()
  return Response.json(data)
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    url?: string
    branch?: string
    customMemeRoot?: string
  }

  const repo = await addRepo({
    url: body.url || "",
    branch: body.branch || "main",
    customMemeRoot: body.customMemeRoot || "",
  })

  return Response.json({ ok: true, repo }, { status: 201 })
}
