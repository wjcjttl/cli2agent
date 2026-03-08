[English](README.md) | 中文

# cli2agent

![CI](https://github.com/wjcjttl/cli2agent/actions/workflows/ci.yml/badge.svg)
![Docker](https://github.com/wjcjttl/cli2agent/actions/workflows/docker.yml/badge.svg)
![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node-20-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-5-blue)

一个自托管的 Docker 服务，封装 Claude Code CLI 并将其暴露为 HTTP + SSE API 端点。

> **免责声明：** cli2agent 封装了 Claude Code CLI，该 CLI 受
> [Anthropic 服务条款](https://www.anthropic.com/policies/usage)约束。
> 通过 API 自动化或暴露 CLI 的行为可能不符合上述条款的规定。
> 使用前请仔细阅读 Anthropic 的相关政策。本软件按"原样"提供，
> 遵循 MIT 许可证 — 详见 [LICENSE](LICENSE)。

---

## 功能特性

- **会话管理** — 创建、列出、查看和删除基于 SQLite 的命名会话；通过 Claude Code 的 JSONL 文件实现跨请求的会话持久化
- **智能体任务执行** — 向 `POST /v1/execute` 发送提示词，通过 SSE 实时流式返回思考过程、文本、工具调用和工具结果
- **兼容 Anthropic Messages API** — `POST /v1/messages` 接受标准 Anthropic 请求格式；可直接作为 Cline、Cursor、LangChain 和 Anthropic SDK 的后端替代
- **Docker 优先** — 只需一条 `docker compose up` 即可启动；宿主机无需安装 Node.js 工具链
- **代理层认证** — 可选的 `CLI2AGENT_API_KEY` 用于控制服务访问权限，与 Anthropic 凭据相互独立
- **可配置并发** — 进程执行默认为串行模式；通过设置 `CLI2AGENT_MAX_CONCURRENT` 可允许并行 CLI 进程，当所有槽位繁忙时自动排队请求
- **资源安全** — 以非 root 用户运行，强制限制 CPU/内存，并在客户端断连或超时时自动清理 CLI 进程

---

## 架构

```
┌──────────────────────────────────────────────────┐
│  Client (Cline / Cursor / SDK / Orchestrator)    │
└─────────────────────┬────────────────────────────┘
                      │ HTTP (REST + SSE)
                      ▼
┌──────────────────────────────────────────────────┐
│  cli2agent  (Node.js / TypeScript / Fastify)     │
│                                                  │
│  ┌────────────┐ ┌──────────────┐ ┌────────────┐ │
│  │ API Routes │ │Session Mgr   │ │Stream      │ │
│  │            │ │(SQLite)      │ │Translator  │ │
│  └─────┬──────┘ └──────┬───────┘ │NDJSON→SSE  │ │
│        │               │         └──────┬─────┘ │
│  ┌─────▼───────────────▼────────────────▼─────┐ │
│  │           CLI Process Manager              │ │
│  │   spawn: claude -p --output-format         │ │
│  │          stream-json                       │ │
│  └────────────────────┬───────────────────────┘ │
└───────────────────────┼──────────────────────────┘
                        │ stdin/stdout (NDJSON)
                        ▼
┌──────────────────────────────────────────────────┐
│  Claude Code CLI  (@anthropic-ai/claude-code)    │
│  Context management   Tool execution             │
│  Session persistence  MCP integration            │
└──────────────────────────────────────────────────┘
```

---

## 快速开始

### Docker（推荐）

```bash
# 1. 克隆仓库
git clone https://github.com/wjcjttl/cli2agent.git
cd cli2agent

# 2. 设置 Anthropic API 密钥
export ANTHROPIC_API_KEY=sk-ant-...

# 3. 启动服务（将 ./workspace 挂载到容器中）
docker compose up
```

服务启动后监听地址为 `http://localhost:3000`。

如需指向已有项目：

```bash
WORKSPACE_PATH=/path/to/your/project docker compose up
```

### 预构建镜像（ghcr.io）

发布版本标签时会自动构建并发布多架构（`amd64`/`arm64`）镜像到 GitHub Container Registry：

```bash
docker pull ghcr.io/wjcjttl/cli2agent:latest

# 或使用特定版本
docker pull ghcr.io/wjcjttl/cli2agent:0.2.0
```

直接运行：

```bash
docker run -p 3000:3000 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v /path/to/project:/workspace:rw \
  ghcr.io/wjcjttl/cli2agent:latest
```

### 本地开发

```bash
npm install
npm run build
ANTHROPIC_API_KEY=sk-ant-... node dist/server.js
```

需要 Node.js 20+ 并全局安装 `@anthropic-ai/claude-code`（`npm install -g @anthropic-ai/claude-code`）。

---

## 认证方式

cli2agent 需要凭据来代你调用 Anthropic。所有认证均在容器**外部**配置，通过环境变量或挂载文件传入 — 无需在容器内进行交互式登录。

`/health` 端点会报告检测到的认证方式。

### 方式一：API 密钥（推荐）

最简单的方式，适用于任何 Anthropic API 套餐。

```bash
docker run -e ANTHROPIC_API_KEY=sk-ant-api03-... cli2agent
```

### 方式二：自定义 API 端点（LiteLLM、OpenRouter 等）

通过同时设置密钥和 Base URL 将 CLI 指向自定义网关：

```bash
docker run \
  -e ANTHROPIC_API_KEY=sk-your-gateway-key \
  -e ANTHROPIC_BASE_URL=https://your-gateway.example.com \
  cli2agent
```

### 方式三：OAuth 令牌（Claude Pro/Max 订阅用户）

先在**宿主机**上完成认证，然后将令牌文件挂载到容器中：

```bash
# 1. 在宿主机上完成 OAuth 登录
claude auth login

# 2. 将令牌文件以只读方式挂载到容器中
docker run \
  -v ~/.config/claude/auth.json:/home/node/.config/claude/auth.json:ro \
  cli2agent
```

如有需要，可通过 `CLAUDE_AUTH_TOKEN_PATH` 覆盖容器内的令牌路径。

> **注意：** OAuth 令牌可能会过期。如遇到认证错误，请在宿主机上重新运行 `claude auth login` 并重启容器。

### 方式四：Amazon Bedrock

通过 AWS Bedrock 使用 Claude，设置以下环境变量：

```bash
docker run \
  -e CLAUDE_CODE_USE_BEDROCK=1 \
  -e ANTHROPIC_BEDROCK_BASE_URL=https://bedrock-runtime.us-east-1.amazonaws.com \
  -e AWS_ACCESS_KEY_ID=... \
  -e AWS_SECRET_ACCESS_KEY=... \
  -e AWS_DEFAULT_REGION=us-east-1 \
  cli2agent
```

### 方式五：Google Vertex AI

通过 Vertex AI 使用 Claude：

```bash
docker run \
  -e CLAUDE_CODE_USE_VERTEX=1 \
  -e ANTHROPIC_VERTEX_PROJECT_ID=my-gcp-project \
  -e CLOUD_ML_REGION=us-east5 \
  cli2agent
```

### 检测优先级

服务启动时按以下顺序检查凭据：

1. `ANTHROPIC_API_KEY`（可搭配或不搭配 `ANTHROPIC_BASE_URL`）
2. `CLAUDE_CODE_USE_BEDROCK=1` + `ANTHROPIC_BEDROCK_BASE_URL`
3. `CLAUDE_CODE_USE_VERTEX=1` + `ANTHROPIC_VERTEX_PROJECT_ID`
4. OAuth 令牌文件，位于 `~/.config/claude/auth.json`（或 `CLAUDE_AUTH_TOKEN_PATH` 指定路径）

如果未检测到任何凭据，服务仍会启动，但会输出警告日志，`/health` 将报告 `"method": "none"`。

---

## API 参考

所有端点均无额外前缀（核心端点如下所列）。当设置了 `CLI2AGENT_API_KEY` 时，客户端必须通过 `x-api-key` 请求头或 `Authorization: Bearer <key>` 提供密钥。

### 健康检查

| 方法 | 路径 | 描述 |
|------|------|------|
| `GET` | `/health` | 返回 `{"status":"ok"}` — 用于 Docker 健康检查 |

### 会话

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/v1/sessions` | 创建新会话 |
| `GET` | `/v1/sessions` | 列出会话（查询参数：`status`、`workspace`、`limit`、`offset`） |
| `GET` | `/v1/sessions/:id` | 获取会话详情，包括 token 用量和消息数 |
| `DELETE` | `/v1/sessions/:id` | 删除会话；使用 `?force=true` 可强制终止活跃进程 |
| `POST` | `/v1/sessions/:id/fork` | 在指定消息处分叉已有会话 |

**创建会话请求：**
```json
{
  "workspace": "/workspace",
  "name": "Feature X",
  "model": "claude-sonnet-4-6"
}
```

### 执行（智能体模式）

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/v1/execute` | 运行智能体提示词；当 `"stream": true` 时流式返回 SSE 事件 |
| `POST` | `/v1/execute/:task_id/cancel` | 取消运行中的任务（先发 SIGTERM，5 秒后发 SIGKILL） |

**请求：**
```json
{
  "session_id": "uuid",
  "prompt": "Refactor auth.py to use dependency injection",
  "stream": true,
  "include_thinking": true,
  "max_turns": 10,
  "allowed_tools": ["Read", "Edit", "Bash"],
  "system_prompt": "You are a senior Python engineer.",
  "model": "claude-sonnet-4-6"
}
```

**SSE 事件流：**
```
event: task_start
data: {"task_id":"...","session_id":"...","status":"running"}

event: thinking_delta
data: {"text":"Let me analyze the current structure..."}

event: text_delta
data: {"text":"I'll refactor auth.py to use dependency injection. "}

event: tool_use
data: {"tool":"Read","input":{"file_path":"auth.py"}}

event: tool_result
data: {"tool":"Read","output":"class AuthService:...","duration_ms":45}

event: task_complete
data: {"task_id":"...","status":"completed","duration_ms":12340,"turns":3}
```

`session_id` 为可选参数 — 如未提供，将自动创建新会话并在 `task_start` 中返回其 ID。

### Messages（兼容 Anthropic 格式）

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/v1/messages` | Anthropic Messages API 的直接替代 |

接受标准的 `messages`、`model`、`system`、`stream`、`max_tokens` 和 `thinking` 字段。响应遵循 Anthropic SSE 格式（`message_start`、`content_block_start`、`content_block_delta` 等），现有 Anthropic SDK 客户端无需修改即可使用。

**兼容性说明：**

| 功能 | 状态 |
|------|------|
| 单轮文本消息 | 已支持 |
| 流式传输（SSE） | 已支持 |
| 非流式响应 | 已支持 |
| 系统提示词 | 已支持 |
| 思考过程块 | 已支持 |
| 多轮对话（通过会话） | 部分支持 |
| 工具调用块（CLI 内置工具） | 部分支持 |
| 自定义工具定义 | 暂不支持 |
| 视觉/图像输入 | 暂不支持 |
| 精确 token 计数 | 尽力估算 |

---

## 配置

所有配置均通过环境变量进行。

**服务配置：**

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `CLI2AGENT_PORT` | `3000` | HTTP 服务器监听端口 |
| `CLI2AGENT_HOST` | `0.0.0.0` | 绑定的主机/网络接口 |
| `CLI2AGENT_API_KEY` | — | 设置后，客户端必须通过 `x-api-key` 或 `Authorization: Bearer` 提供此密钥 |
| `CLI2AGENT_WORKSPACE` | `/workspace` | 传递给 CLI 的默认工作目录 |
| `CLI2AGENT_DEFAULT_MODEL` | _（CLI 默认值）_ | 未指定模型时使用的默认 Claude 模型 |
| `CLI2AGENT_DEFAULT_MAX_TURNS` | `25` | 智能体循环的默认最大轮次 |
| `CLI2AGENT_MAX_CONCURRENT` | `1` | 最大并发 CLI 进程数（默认串行执行） |
| `CLI2AGENT_QUEUE_TIMEOUT` | `30000` | 请求等待进程槽位的超时时间，超时返回 429（毫秒） |
| `CLI2AGENT_REQUEST_TIMEOUT` | `300000` | 单次请求超时时间（毫秒），默认 5 分钟 |
| `CLI2AGENT_MAX_SESSIONS` | `100` | 最大跟踪会话数 |
| `DISABLE_AUTOUPDATER` | `1`（Docker 中） | 阻止 Claude Code 在容器内自动更新 |

**Claude 认证**（用法详见[认证方式](#认证方式)）：

| 变量 | 默认值 | 描述 |
|------|--------|------|
| `ANTHROPIC_API_KEY` | — | Anthropic API 密钥（推荐） |
| `ANTHROPIC_BASE_URL` | — | 自定义 API 端点（LiteLLM、OpenRouter 等） |
| `CLAUDE_CODE_USE_BEDROCK` | — | 设为 `1` 以使用 Amazon Bedrock |
| `ANTHROPIC_BEDROCK_BASE_URL` | — | Bedrock 端点 URL（启用 Bedrock 时必填） |
| `CLAUDE_CODE_USE_VERTEX` | — | 设为 `1` 以使用 Google Vertex AI |
| `ANTHROPIC_VERTEX_PROJECT_ID` | — | GCP 项目 ID（启用 Vertex 时必填） |
| `CLAUDE_AUTH_TOKEN_PATH` | `~/.config/claude/auth.json` | 容器内 OAuth 令牌文件路径 |

### 卷挂载

| 容器路径 | 用途 |
|----------|------|
| `/workspace` | Claude 操作的代码仓库（将项目挂载到此处） |
| `/workspace/CLAUDE.md` | 项目级系统提示词；CLI 会自动读取 |
| `/workspace/.mcp.json` | MCP 服务器配置 |
| `/home/node/.claude/` | 会话 JSONL 文件和用户级设置（通过命名卷持久化） |
| `/home/node/.config/claude/auth.json` | OAuth 凭据（使用 OAuth 认证时以只读方式挂载） |

---

## 路线图

### 第一阶段 — 最小可用产品（核心循环）
- [x] Fastify 服务器及 `/health` 端点
- [x] CLI 进程启动器（`claude -p --output-format stream-json`）
- [x] 从 stdout 逐行解析 NDJSON
- [x] `POST /v1/execute` 及 SSE 流式传输
- [x] 基础会话管理（创建、列出、删除）
- [x] Dockerfile + docker-compose.yml

### 第二阶段 — Anthropic 兼容性
- [ ] 流式转换状态机（CLI NDJSON 转 Anthropic SSE）
- [ ] `POST /v1/messages` 端点
- [x] 非流式响应模式
- [x] 通过会话恢复实现多轮对话

### 第三阶段 — 生产环境加固
- [x] 会话级并发互斥锁和请求队列
- [x] 优雅关闭与进程清理
- [ ] 会话垃圾回收（空闲超时）
- [ ] 请求取消（`/v1/execute/:id/cancel`）
- [x] 结构化错误处理与恢复

### 第四阶段 — 高级功能
- [ ] 会话分叉（`POST /v1/sessions/:id/fork`）
- [ ] 双向协议支持（通过 WebSocket 升级处理交互式权限提示）
- [ ] SDK 模式（使用 `query()` 函数替代子进程调用）
- [x] 按请求传递 MCP 配置
- [ ] 任务历史记录与状态跟踪

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
