import { SERVER_ORIGIN } from "@/lib/server-api"

export const dynamic = "force-dynamic"

export async function GET() {
  const response = await fetch(`${SERVER_ORIGIN}/events`, {
    headers: {
      Accept: "text/event-stream",
    },
    cache: "no-store",
  })

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}
