import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common"

import {
  addRepo,
  getDashboardData,
  requestRemoveRepo,
  requestRepoSync,
  requestSyncAllRepos,
  setRepoEnabled,
  updateRepoMemeRoot,
} from "../src/lib/meme-manager"

@Controller("repos")
export class ReposController {
  @Get()
  async getRepos() {
    return getDashboardData()
  }

  @Post()
  async createRepo(
    @Body()
    body: {
      url?: string
      branch?: string
      customMemeRoot?: string
    },
  ) {
    const repo = await addRepo({
      url: body.url || "",
      branch: body.branch || "main",
      customMemeRoot: body.customMemeRoot || "",
    })

    return { ok: true, repo }
  }

  @Post("sync-all")
  async syncAll() {
    await requestSyncAllRepos()
    return { ok: true }
  }

  @Post(":repoId/sync")
  async syncRepo(@Param("repoId") repoId: string) {
    return requestRepoSync(repoId)
  }

  @Patch(":repoId")
  async updateRepo(
    @Param("repoId") repoId: string,
    @Body()
    body: {
      enabled?: boolean
      customMemeRoot?: string
    },
  ) {
    if (typeof body.customMemeRoot === "string") {
      await updateRepoMemeRoot(repoId, body.customMemeRoot)
      return { ok: true }
    }

    if (typeof body.enabled === "boolean") {
      await setRepoEnabled(repoId, body.enabled)
      return { ok: true }
    }

    return { error: "无效请求" }
  }

  @Delete(":repoId")
  async removeRepo(@Param("repoId") repoId: string) {
    return requestRemoveRepo(repoId)
  }
}
