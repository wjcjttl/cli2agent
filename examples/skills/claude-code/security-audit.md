# Security Audit

Perform a security audit of the specified files or the entire project, focusing on vulnerabilities that could be exploited by untrusted input.

## Scope

If specific files or directories are provided, audit those. Otherwise, audit the full project with emphasis on:
- Entry points (API routes, CLI handlers, form processors)
- Authentication and authorization logic
- Data serialization and deserialization
- Database queries and ORM usage
- File system operations
- External service integrations

## Checklist

### Injection
- [ ] SQL injection (raw queries, string concatenation in queries)
- [ ] Command injection (shell exec with user input, unsanitized arguments)
- [ ] XSS (unescaped output in HTML, dangerouslySetInnerHTML, template literals)
- [ ] Path traversal (user-controlled file paths without validation)
- [ ] LDAP/XML/NoSQL injection where applicable

### Authentication and Authorization
- [ ] Missing authentication on sensitive endpoints
- [ ] Broken access control (horizontal/vertical privilege escalation)
- [ ] Insecure session management (predictable tokens, missing expiry)
- [ ] Hardcoded credentials or API keys in source code
- [ ] Weak password policies or missing rate limiting on auth endpoints

### Data Exposure
- [ ] Sensitive data in logs (passwords, tokens, PII)
- [ ] Overly permissive API responses (returning full objects instead of projections)
- [ ] Missing encryption for data at rest or in transit
- [ ] Secrets in version control (.env files, config with credentials)

### Configuration
- [ ] Debug mode enabled in production configurations
- [ ] Permissive CORS settings
- [ ] Missing security headers (CSP, HSTS, X-Frame-Options)
- [ ] Default or weak cryptographic settings

### Dependencies
- [ ] Known vulnerable dependencies (check package.json, requirements.txt, go.mod, etc.)
- [ ] Outdated packages with security patches available

## Output Format

For each finding:

```
[SEVERITY] Category — Description
  Location: file:line
  Risk: What could an attacker do
  Fix: Recommended remediation
```

Severity levels:
- **CRITICAL** -- Exploitable vulnerability with high impact (RCE, auth bypass, data breach)
- **HIGH** -- Exploitable with moderate impact or requires specific conditions
- **MEDIUM** -- Defense-in-depth issue, not directly exploitable but increases attack surface
- **LOW** -- Best practice violation, minimal direct risk

End with an executive summary: total findings by severity, the most urgent items, and overall security posture assessment.
