import "reflect-metadata"

import { NestFactory } from "@nestjs/core"
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify"

import { AppModule } from "./app.module"

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { cors: true },
  )

  const host = process.env.SERVER_HOST || "127.0.0.1"
  const port = Number(process.env.SERVER_PORT || 3001)

  await app.listen({ port, host })
}

bootstrap().catch((error) => {
  console.error(error)
  process.exit(1)
})
