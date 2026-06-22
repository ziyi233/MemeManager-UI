# MemeManager UI

`MemeManager UI` 是一个给 `meme-generator` 用的扩展仓库管理面板

它解决的事情很简单：

- 管理多个额外表情仓库
- 按需同步，不同步就只保留配置
- 自动识别仓库里的表情根目录
- 把已启用仓库汇总到一个固定目录，供 `meme-generator` 读取

## 功能

- 添加、启用、停用、移除扩展仓库
- 单仓库同步、全部同步
- 后台异步执行 `git clone` / `git pull`
- 实时显示任务日志和 Git 输出
- 用 `JSON` 持久化配置和任务记录；仓库状态从 `data/repos/` 和 Git 工作区实时感知

## 适用场景

如果你在用 `meme-generator`，又想同时挂多个扩展表情仓库，这个项目就是拿来干这个的

它不会把每个仓库路径都塞进 `MEME_DIRS`

它会把所有启用仓库里的表情目录统一汇总到一个固定目录，比如：`/data/managed/memes`

然后 `meme-generator` 只需要读取这一个目录

## 支持的仓库结构

项目会自动尝试识别这些常见根目录：

- `memes`
- `meme`
- `emoji`

如果自动识别失败，也可以手动填写表情根目录

## 已验证的预置仓库

- `MemeCrafters/meme-generator-contrib`，分支 `main`，根目录 `memes`
- `ziyi233/meme-generator-core-memes`，分支 `main`
- `anyliew/meme_emoji`，分支 `main`，根目录 `emoji`
- `jinjiao007/meme-generator-jj`，分支 `master`，根目录 `memes`
- `anyliew/crazy_emoji`，分支 `main`，根目录 `emoji`
- `LRZ9712/tudou-meme`，分支 `main`，根目录 `meme`
- `xiaoruange39/xiaoruan-meme`，分支 `main`，根目录 `emoji`

注意：

- `meme_emoji` 和 `tudou-meme` 之间存在目录重名，启用并同步后可能触发冲突
- `MemeManager UI` 会按仓库顺序链接先出现的表情目录，并在界面中展示后续重名冲突

## 本地开发

```bash
npm install
npm run dev
```

默认地址：`http://localhost:3000`

健康检查：`/api/health`

生产启动前需要先构建：

```bash
npm run build
npm run start
```

`npm run start` 会同时启动：

- Web 界面：`3000`
- NestJS 后端服务：`3001`，仅供 Web 服务内部调用

## 数据目录

运行时数据默认写在 `data/` 下面：

- `data/example-config.json`：预置仓库模板
- `data/config/repos.json`：实际仓库配置
- `data/state/jobs.json`：任务记录和最近日志
- `data/repos/`：clone 下来的仓库
- `data/managed/memes/`：汇总后的共享目录

仓库里只保留 `data/example-config.json`

其余目录都是运行时文件，不纳入版本控制

## 仓库拉取源

仓库配置里保存的始终是原始地址，比如 `https://github.com/owner/repo`

如果你的网络环境直连 GitHub 不稳定，可以配置环境变量：

```text
MEME_REPO_URL_PREFIX=
```

它的行为很直接：同步时把这个前缀拼到原始 URL 前面再执行 `git clone/fetch/pull`

例如：

```text
MEME_REPO_URL_PREFIX=https://ghfast.top/
```

那么实际拉取时会变成：

```text
https://ghfast.top/https://github.com/anyliew/meme_emoji
```

这样可以在不修改仓库配置的前提下切换镜像源

## 与 `meme-generator` 联动

`meme-generator` 读取的是 `meme_dirs`

对于这个项目，推荐固定成：

```json
["/data/managed/memes"]
```

也就是说，`meme-generator` 不直接读取每个扩展仓库，而是只读 `MemeManager UI` 汇总后的共享目录

## 重载 Meme API

你现在使用的 `meme-generator` 已经提供正式重载端点：`POST /memes/reload`

所以新增、启停、移除表情仓库后，不需要重启整个服务，只要触发一次 reload 即可生效

`MemeManager UI` 现在支持两种方式：

- 手动点击页面右上角的 `重载 Meme API`
- 在同步完成后自动触发重载

通过环境变量配置：

- `MEME_API_RELOAD_URL`：向一个 URL 发送 `POST` 请求
- `MEME_API_RELOAD_COMMAND`：执行一条本地命令
- `MEME_API_AUTO_RELOAD=true`：在同步、启停、移除、根目录变更后自动触发重载

推荐优先用 URL 方式，直接指向：

```text
http://meme-generator:2233/memes/reload
```

推荐默认先不开自动重载，先用手动按钮

原因很简单：

- 有些人希望多次同步完再统一重载一次
- 自动重载在网络抖动或目标服务未就绪时更容易报错
- 手动按钮更稳，也更符合第一版预期

如果你的部署里已经有额外的反向代理、鉴权层或控制脚本，也可以继续改用 `MEME_API_RELOAD_COMMAND` 或你自己的重载 URL

## Docker Compose 示例

推荐直接使用项目根目录里的 `docker-compose.yml`

这个版本默认：

- `meme-generator`：`ghcr.io/ziyi233/meme-generator:latest`
- `meme-manager-ui`：`ghcr.io/ziyi233/mememanager-ui:latest`
- 内置表情包：关闭，并且镜像中不再包含内置表情目录
- 共享数据目录：`./data:/data`
- 管理面板端口：`6667:3000`

启动：

```bash
docker compose up -d
```

停止：

```bash
docker compose down
```

```yaml
services:
  meme-generator:
    image: ghcr.io/ziyi233/meme-generator:latest
    ports:
      - "2233:2233"
    environment:
      LOAD_BUILTIN_MEMES: "false"
      MEME_DIRS: '["/data/managed/memes"]'
    volumes:
      - ./data:/data

  meme-manager-ui:
    image: ghcr.io/ziyi233/mememanager-ui:latest
    ports:
      - "6667:3000"
    environment:
      DATA_ROOT: /data
      MEME_API_RELOAD_URL: http://meme-generator:2233/memes/reload
    volumes:
      - ./data:/data
```

## Docker 镜像

项目自带多阶段 `Dockerfile`，运行时会同时启动 Web 和 NestJS 后端服务

Docker/Compose 对外只暴露 Web 端口，NestJS 后端默认绑定在容器内部的 `127.0.0.1:3001`

即使项目里没有 `public/` 目录，镜像构建也可以正常完成

默认环境变量：

- `PORT=3000`
- `HOSTNAME=0.0.0.0`
- `DATA_ROOT=/data`
- `SERVER_HOST=127.0.0.1`
- `SERVER_PORT=3001`

## GitHub Actions

仓库内置工作流：`.github/workflows/docker.yml`

行为如下：

- 普通提交不会自动构建镜像
- 推送 `v*` 标签时，会构建并发布对应版本标签
- 手动触发 `workflow_dispatch` 时，也可以直接发布镜像
- 发布到 `GHCR`
- 默认构建平台：`linux/amd64`、`linux/arm64`

默认镜像名：

```text
ghcr.io/<owner>/<repo>
```

## 当前限制

- 某些第三方仓库之间可能出现表情目录重名冲突
- 网络不稳定时，`git clone` 仍可能失败，但失败目录会自动清理，下一次可以直接重试
- 如果没有配置 `MEME_API_RELOAD_URL` 或 `MEME_API_RELOAD_COMMAND`，同步成功后仍需要你自己调用 `POST /memes/reload`
