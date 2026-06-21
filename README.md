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
- 实时显示同步中、删除中、异常、已同步状态
- 用 `JSON` 持久化配置和运行状态，不依赖数据库

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
- `anyliew/meme_emoji`，分支 `main`，根目录 `emoji`
- `jinjiao007/meme-generator-jj`，分支 `master`，根目录 `memes`
- `anyliew/crazy_emoji`，分支 `main`，根目录 `emoji`
- `LRZ9712/tudou-meme`，分支 `main`，根目录 `meme`
- `xiaoruange39/xiaoruan-meme`，分支 `main`，根目录 `emoji`

注意：

- `meme_emoji` 和 `tudou-meme` 之间存在目录重名，启用并同步后可能触发冲突
- `MemeManager UI` 会阻止把两个同名表情目录同时汇总进共享目录

## 本地开发

```bash
npm install
npm run dev
```

默认地址：`http://localhost:3000`

健康检查：`/api/health`

## 数据目录

运行时数据默认写在 `data/` 下面：

- `data/example-config.json`：预置仓库模板
- `data/config/repos.json`：实际仓库配置
- `data/state/repos-state.json`：运行状态
- `data/repos/`：clone 下来的仓库
- `data/managed/memes/`：汇总后的共享目录

仓库里只保留 `data/example-config.json`

其余目录都是运行时文件，不纳入版本控制

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

项目根目录已经附带可直接使用的 `docker-compose.yml`

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
    image: ghcr.io/memecrafters/meme-generator:latest
    ports:
      - "2233:2233"
    environment:
      MEME_DIRS: '["/data/managed/memes"]'
    volumes:
      - meme-data:/data

  meme-manager-ui:
    image: ghcr.io/ziyi233/mememanager-ui:latest
    ports:
      - "3000:3000"
    environment:
      DATA_ROOT: /data
      MEME_API_RELOAD_URL: http://meme-generator:2233/memes/reload
    volumes:
      - meme-data:/data

volumes:
  meme-data:
```

## Docker 镜像

项目自带多阶段 `Dockerfile`，运行方式是 Next standalone

即使项目里没有 `public/` 目录，镜像构建也可以正常完成

默认环境变量：

- `PORT=3000`
- `HOSTNAME=0.0.0.0`
- `DATA_ROOT=/data`

## GitHub Actions

仓库内置工作流：`.github/workflows/docker.yml`

行为如下：

- 推送到 `main` 时，自动构建并发布镜像
- 推送 `v*` 标签时，额外发布对应版本标签
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
