import { Module } from "@nestjs/common"

import { AppController } from "./app.controller"
import { JobsController } from "./jobs.controller"
import { MemeApiController } from "./meme-api.controller"
import { ReposController } from "./repos.controller"

@Module({
  controllers: [AppController, JobsController, MemeApiController, ReposController],
})
export class AppModule {}
