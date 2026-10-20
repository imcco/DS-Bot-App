# 管家预设：Chief、Work、Invest

- 日期：2026-10-19
- 相关：在已定的「不自动预置分工 Bot」之上，加一个用户明确启用的团队预设
- 代码：`ds-bot/src/host/steward-preset.js`、`team-preset.js`、`a2api.js`，空团队的第一个 Main Bot 在 `roster.js`

## 为什么

一个新团队如果只有一个会聊天的 Main Bot，用户还是得自己写三份职责、四份记忆主题和一个工作日任务。这份预设把 Chief / Work / Invest 收成一次启用：中文职责、记忆脚手架、一份工作日投资简报，外加对本机 Agent2API 地址的薄健康检查。

不做成安装后自动出现三个 Bot。已定的设计仍是：空团队只建一个 Main Bot，分工由用户或 Main Bot 来建。

## 已定的行为

- 空团队第一次打开时，仍然只建一个 Main Bot，名字沿用 `Chief`（或配置里的 `mainName`）。出厂角色 `Chief of Staff` 写成「团队总管」，指令用 Chief 的中文职责。配置另行指定了角色时，保留那个角色，指令仍用这份中文职责。
- `apply_steward_team` 只有 Main Bot 能调用。接口 `steward-apply` 做同一件事，给用户和测试用。可以重复调用。
- 已有同名 Bot：指令是空的才填上；Chief 的角色只有在空着或仍是 `Chief of Staff` 时才改成「团队总管」。已经写过的指令、其他角色、颜色都不改。
- 没有名叫 Chief 的 Bot，而团队里已经有别的 Main Bot：不另外建 Chief，报告 `missing`。Work 和 Invest 仍会补上（没有同名 Bot 时）。
- 记忆主题只在没有该主题时建立，正文是一行用途说明，不是一条事实。团队：`preferences`、`projects`、`people`。Invest 自己：`investing-rules`。已有主题不改写。记忆关掉时跳过。
- 只附一份定时任务：Invest 的「工作日投资简报」，周一到周五 08:30，时区 `Asia/Shanghai`。星期编号和任务表单一样，1 是周一。同 Bot 已有同名任务则不再建。DSH 没开 Automation tasks 时跳过，并说明原因。
- `a2api-health` 只请求 `http://127.0.0.1:3065/v1/models`。不发送密钥，不跟随重定向，不返回响应正文。回答是模型 id 列表，或「连不上 / 超时 / 不是模型列表」。

## 不做什么

- 不在启用之外自动创建 Work 或 Invest，不建群，不挂连接器。
- 不覆盖用户已经写好的 Bot 指令。
- 不保存网关密钥、账号或 cookie，不代理对话请求。
- 不做第二个日程模板，不改 Desktop、移动端，也不改 DSH。

## 已知限制

- 网关若要求密钥才返回 `/v1/models`，健康检查会显示没连上。DSH 用自己保存的密钥仍可能可用。密钥只放在 DSH 的凭据里。
- 新 Bot 在 Chief 还没选定模型时，同样等用户选模型，不擅自挑一个。
- 定时任务仍绑定创建时的 Session。换段之后由现有的转发规则送到当前段，不在这次预设里迁移。

## 变更

- 2026-10-19：增加可选的管家预设、四个记忆主题、工作日投资简报，以及 Agent2API 健康检查。
