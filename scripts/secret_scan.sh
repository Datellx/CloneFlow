#!/usr/bin/env bash
# Fails if anything that looks like a real key is tracked by git (run before every push).
set -euo pipefail
cd "$(dirname "$0")/.."
pattern='(sk-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|xox[bp]-[A-Za-z0-9-]{20,}|-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY)'
hits=$(git ls-files -z | xargs -0 grep -nIE "$pattern" 2>/dev/null || true)
if git ls-files | grep -qE '(^|/)\.env(\.local)?$'; then echo "✗ an .env file is tracked by git"; exit 1; fi
if [ -n "$hits" ]; then echo "✗ possible secrets:"; echo "$hits"; exit 1; fi
echo "✓ no secrets found in tracked files"
