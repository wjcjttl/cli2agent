# Security Policy

## Reporting Vulnerabilities

If you discover a security vulnerability in cli2agent, please report it
through one of the following channels:

- **GitHub Issues:** Open an issue with the label `security`
- **Email:** Contact the maintainers directly via the email listed in the
  repository profile

Please include a clear description of the vulnerability, steps to reproduce,
and any potential impact. We will acknowledge reports within 72 hours.

## Design Considerations

### Permission Model

cli2agent uses `--dangerously-skip-permissions` when invoking the Claude CLI.
This is intentional and by design. The server is meant to be self-hosted in
trusted environments where the operator controls access. It should never be
exposed to the public internet without an authentication layer.

### Credential Handling

- API keys and tokens are passed exclusively via environment variables
  (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`)
- Credentials are never stored in code, configuration files, or logs
- Use `CLI2AGENT_API_KEY` to require bearer token authentication on all
  API endpoints in production deployments

### Docker Security

The Docker image follows security best practices:

- Runs as a non-root user (`agent`, UID 999)
- Uses `--no-new-privileges` to prevent privilege escalation
- Workspace is mounted with explicit volume binds, limiting filesystem access
- No unnecessary capabilities are granted

## Production Recommendations

1. **Always set `CLI2AGENT_API_KEY`** to protect the HTTP API with bearer
   token authentication
2. **Do not expose the service to the public internet** without a reverse
   proxy and proper access controls
3. **Use read-only mounts** for workspace directories when write access is
   not needed
4. **Rotate API keys regularly** and avoid sharing keys across environments
5. **Monitor container logs** for unexpected tool invocations or errors
