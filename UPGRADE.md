# 升级说明：管家团队

这份升级把 DS Bot 从「一个会聊天的 Bot」收成一个可以启用的三人团队：Chief 调度，Work 推进项目，Invest 做投资研究。空团队打开时仍然只自动出现 Chief。Work、Invest、记忆主题和工作日简报要你明确启用一次。

不包含：独立 Desktop、Agent CLI、新的连接器、iOS 推送，也不改 DeepSeek Harness 本身。

## 你会得到什么

| 部分 | 内容 |
|---|---|
| Chief | Main Bot。中文职责是调度，不亲自做深工作，也不做投资研究 |
| Work | 项目、提纲、待办。结论写在团队记忆的 `projects` |
| Invest | 投资研究，不执行交易。规则写在自己的 `investing-rules` |
| 团队记忆 | `preferences` 偏好、`projects` 项目、`people` 人物。只有用途说明，没有编造的事实 |
| 一份日程 | Invest 的「工作日投资简报」：周一到周五 08:30（`Asia/Shanghai`） |
| 健康检查 | 只问 `http://127.0.0.1:3065/v1/models` 是否在回答。不发送、不保存密钥 |

已经写过的 Bot 指令不会被盖掉。同名主题、同名日程也不会重写。

## 在 Mac 上用 link 试

这是给本机检出试用的装法，不需要发版包。数据仍在原来的 DSH 目录里，不要删 `~/.dsh`。

1. 完全退出 DSH Desktop（菜单退出，不只是关窗口）。
2. 克隆本 fork，检出要试的分支。下面用 `~/src/DS-Bot-App` 作例子，换成你的绝对路径。
3. 打开 Desktop 的 profile：`~/.dsh/profiles/desktop/package.json`。设置了 `DSH_HOME` 时，用那个目录下的 `profiles/desktop/package.json`。
4. 在 `dependencies` 里把 `ds-bot` 指到检出目录。原来如果是 GitHub 规格或 `.tgz`，改成这一行，不要留两份：

```json
{
  "dependencies": {
    "ds-bot": "link:/Users/你/src/DS-Bot-App/ds-bot"
  }
}
```

5. 同一个文件里的 `dsh.profile.bundles` 保留原有的包，并带上 `ds-bot`。没有这个数组时，不要凭空删掉 Desktop 已经在用的 bundle；先只改 `dependencies`，装完打不开再把 `ds-bot` 加进现有的 bundles。
6. 在 profile 目录安装并重新打开 Desktop：

```sh
cd ~/.dsh/profiles/desktop
pnpm install
```

7. 打开 DS Bot。侧边栏应只有 Chief。给 Chief 选好已经配过密钥的模型。
8. 在 Chief 的对话里说：`请调用 apply_steward_team，搭好 Work 和 Invest。`
9. 侧边栏出现 Work 和 Invest。打开各自的详情，能看到中文职责。
10. 记忆里能看到团队主题 `preferences`、`projects`、`people`，以及 Invest 的 `investing-rules`。主题正文是一行说明，不是已经发生的事。
11. 定时任务要先在 DSH 的插件页打开 Automation tasks。然后设置 → 定时任务里，Invest 有一条「工作日投资简报」，工作日 08:30。没开 Automation tasks 时，团队和记忆仍然建好，日程会标明跳过。

再对 Chief 说一次同样的话，不应再出现第二套 Bot，也不会改掉你后来手写的指令。

## 把 DSH 的模型指到本机 Agent2API

[Agent2API](https://github.com/aimod-cc/agent2api) 是另一个跑在本机的 OpenAI 兼容网关，默认地址是 `http://127.0.0.1:3065/v1`。它不是 DS Bot，也不是 DSH。本插件不登录账号，不读 cookie，不转发对话。

网关由你自己启动。起来之后可以在终端看模型列表：

```sh
curl -sS http://127.0.0.1:3065/v1/models
```

在 DSH：**设置 → 模型 → 添加模型提供方 → 自定义模型 API**。

| 字段 | 填写 |
|---|---|
| Provider ID | `agent2api`（小写，建好后不能改） |
| Base URL | `http://127.0.0.1:3065/v1` |
| API 协议 | OpenAI Chat Completions（配置里是 `openai-completions`） |
| API key | 本地网关要求的那一串。DSH 把它存在自己的凭据里 |

然后用「拉取可用模型」勾选要给 Bot 用的模型并保存。密钥不要写进 Bot 指令、记忆、日程或这个仓库。

插件的健康检查是 `a2api-health`：请求上面的 `/v1/models`，不带 `Authorization`，不跟随重定向，只返回是否成功、状态码和模型 id。网关若必须带密钥才列出模型，检查会显示没连上；DSH 仍可以用它自己保存的密钥。两种结果不矛盾。

## 不在这次里

- 不自动建群，不增加周五工作提纲（只要这一份工作日投资简报）。
- 不把网关做成连接器，不代理 `/v1/chat/completions`。
- 不改手机端，也不改 DSH 的安装。
