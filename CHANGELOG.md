# Changelog

## [0.3.1](https://github.com/wjcjttl/cli2agent/compare/cli2agent-v0.3.0...cli2agent-v0.3.1) (2026-03-09)


### Features

* add MCP server with health, session, and execute tools ([39036bd](https://github.com/wjcjttl/cli2agent/commit/39036bd80c717e3b6aaf47dc9c4fc8fcc9a4adf6))
* add process concurrency throttling with queue-based semaphore ([af06a30](https://github.com/wjcjttl/cli2agent/commit/af06a3011e747a9c0ced422bec2e4b641f69201f))
* add skills ecosystem with API, OpenClaw integration, and docs ([#9](https://github.com/wjcjttl/cli2agent/issues/9)) ([1eb278e](https://github.com/wjcjttl/cli2agent/commit/1eb278ebbaf210ac6015d9092ee74631f2e55901))
* add Zod schemas, OpenAPI spec, and Swagger UI ([29bc6f5](https://github.com/wjcjttl/cli2agent/commit/29bc6f57848c0bfb3beade1d10b2a9bd907dda33))
* initial MVP — core server, sessions, and agentic execution ([f1e35e3](https://github.com/wjcjttl/cli2agent/commit/f1e35e3442c64c9285affd2d7d395a0c399121e2))
* multi-CLI adapter system and Anthropic Messages API ([#8](https://github.com/wjcjttl/cli2agent/issues/8)) ([e9764cd](https://github.com/wjcjttl/cli2agent/commit/e9764cdfa36af791ea4f219ce5084828362b079a))


### Bug Fixes

* **docker:** remove working_dir override and fix UID mismatch ([#5](https://github.com/wjcjttl/cli2agent/issues/5)) ([561d817](https://github.com/wjcjttl/cli2agent/commit/561d81701f1dcd019009bccf3a79a4d88f075973))
* enable multi-turn session continuation with --resume flag ([#4](https://github.com/wjcjttl/cli2agent/issues/4)) ([9206206](https://github.com/wjcjttl/cli2agent/commit/920620627e8b1978c1280105fdf298cf1aaeefcf))
