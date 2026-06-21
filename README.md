# MemeManager UI

表情仓库管理台

## 目标

- 管理额外表情仓库
- 自动拉取 Git 更新
- 自动识别仓库里的 meme 根目录
- 为 `meme-generator` 提供统一的外部表情目录
- 后续通过 GitHub Actions 自动构建镜像

## 技术栈

- `Next.js 16`
- `React 19`
- `TypeScript`
- `Tailwind CSS 4`

## 本地开发

```bash
npm install
npm run dev
```

默认地址：`http://localhost:3000`

健康检查：`/api/health`

## `meme-generator` 是怎么加载额外表情的

- 它读取配置文件里的 `meme_dirs`
- `meme_dirs` 里的每个目录，都会被当成一个“meme 容器目录”扫描
- 这个目录的下一层，每个带 `__init__.py` 的子目录都会被当成一个 meme 模块加载

目录结构要长这样：

```text
/path/to/meme_dir
├── meme1/
│   └── __init__.py
└── meme2/
    └── __init__.py
```

参考项目：

- `meme-generator-contrib` 的根目录是 `memes`
- `meme-generator-jj` 的默认分支是 `master`，根目录是 `memes`
- `tudou-meme` 的根目录是 `meme`
- `meme_emoji`、`crazy_emoji`、`xiaoruan-meme` 的根目录是 `emoji`

`MemeManager UI` 会做三件事：

1. `git clone/pull` 仓库到共享卷
2. 自动识别真实的 meme 根目录，必要时支持手动覆盖
3. 把所有启用仓库下的 meme 子目录链接到一个固定目录

默认仓库配置放在 `data/example-config.json`

- 首次启动时，会用这个文件初始化 `data/config/repos.json` 和 `data/state/repos-state.json`
- 这些仓库初始都是“未同步”状态
- 你可以直接改 `data/example-config.json`，不需要改代码

当前持久化拆成两层：

- `data/config/repos.json`：仓库配置，包含 URL、分支、启停、手动指定的 `meme root`
- `data/state/repos-state.json`：运行状态，包含同步中、删除中、最近 commit、最近错误、最近同步时间

这样前端只负责发起 API 请求，真正的同步/删除在后台任务里执行，不会把页面请求卡死。

这样仓库先只是配置项，不会立刻拉代码，也不会增加共享卷体积。只有你点同步后，才会真正 clone/pull。

这样 `meme-generator` 只需要固定读取一个目录，不用每加一个仓库就改一次 `MEME_DIRS`

## Docker Compose

推荐把两个容器挂到同一个卷，比如 `/data`

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
    image: ghcr.io/your-name/mememanager-ui:latest
    ports:
      - "3000:3000"
    environment:
      DATA_ROOT: /data
    volumes:
      - meme-data:/data

volumes:
  meme-data:
```

注意：

- `meme-generator` 当前是在启动时加载 memes，不是热重载
- 所以新增或更新额外仓库后，现阶段通常还需要重启 `meme-generator` 容器才能生效

## 镜像发布

- 项目已提供 `D:\MemeManager-UI\.github\workflows\docker.yml:1`
- 推送到默认分支时，会自动构建并发布 `linux/amd64` 和 `linux/arm64` 镜像到 `GHCR`
- 推送 `v*` 标签时，会额外发布对应版本标签
- 默认镜像名是 `ghcr.io/<owner>/<repo>`

首次启用前要确认：

- GitHub 仓库已创建并推送
- 仓库 `Actions` 和 `Packages` 权限正常
- 包可见性按需设为 public

## 当前进度

- 已完成基础脚手架
- 已完成真实仓库管理、同步和共享目录生成
- 下一步接入更细的错误展示和镜像自动构建
