import { Controller, Get } from "@nestjs/common"

@Controller()
export class AppController {
  @Get("health")
  getHealth() {
    return {
      status: "ok",
      name: "meme-manager-server",
      timestamp: new Date().toISOString(),
    }
  }
}
