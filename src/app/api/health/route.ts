export function GET() {
  return Response.json({
    name: "MemeManager UI",
    status: "ok",
    timestamp: new Date().toISOString(),
  })
}
