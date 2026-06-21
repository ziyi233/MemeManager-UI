import { Controller, Post } from "@nestjs/common"

import { reloadMemeApi } from "../src/lib/meme-manager"

@Controller("meme-api")
export class MemeApiController {
  @Post("reload")
  async reload() {
    return reloadMemeApi()
  }
}
