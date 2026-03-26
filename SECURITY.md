# Security Policy

Frontron is the framework-first desktop app layer for existing web projects. Security reports should focus on the framework runtime, preload bridge, packaging flow, and shipped public package surface.

## Reporting a Vulnerability

Do not open a public GitHub issue for a suspected security vulnerability.

Report it privately to the maintainer first:

- Preferred: use GitHub private vulnerability reporting or a security advisory on the repository if that option is available
- Fallback: contact the maintainer through [the maintainer profile](https://github.com/andongmin94) and clearly mark the report as `Security`

Include:

- affected package and version
- reproduction steps or a minimal fixture
- impact summary
- whether the issue affects development, packaged apps, or both

## Scope

Relevant reports usually involve:

- preload or bridge exposure problems
- renderer-to-main boundary bypasses
- runtime security policy bugs
- packaging or staged-app behavior that exposes unsafe defaults
- dependency vulnerabilities that materially affect shipped Frontron behavior

Out of scope:

- issues in private app code built on top of Frontron
- local-only misconfiguration without a framework bug
- unsupported raw Electron patterns that Frontron does not claim to support

## Supported Versions

Security fixes are tracked against the latest published Frontron release. Older versions may be asked to upgrade before a fix is provided.

## Disclosure

Please allow time for validation and a coordinated fix before public disclosure.
