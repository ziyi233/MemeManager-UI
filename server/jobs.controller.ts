import { Controller, Get, MessageEvent, Param, Post, Sse } from "@nestjs/common"
import { Observable } from "rxjs"

import { cancelJob, listJobs, subscribeJobEvents } from "../src/lib/meme-manager"

@Controller()
export class JobsController {
  @Get("jobs")
  async getJobs() {
    return { jobs: await listJobs() }
  }

  @Post("jobs/:jobId/cancel")
  async cancelJob(@Param("jobId") jobId: string) {
    return cancelJob(jobId)
  }

  @Sse("events")
  streamEvents(): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      subscriber.next({ type: "ready", data: { ok: true } })

      const unsubscribe = subscribeJobEvents((event) => {
        subscriber.next({ type: event.type, data: event })
      })

      const heartbeat = setInterval(() => {
        subscriber.next({ type: "ping", data: {} })
      }, 15000)

      return () => {
        clearInterval(heartbeat)
        unsubscribe()
      }
    })
  }
}
