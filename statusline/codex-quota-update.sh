#!/bin/bash
# Codex quota background updater (portable: macOS + Linux)
# Fetches Codex rate limits via app-server JSON-RPC and writes to cache file.
# Designed to be run in background from statusline.sh.
# Uses lock file to prevent concurrent executions.

set -u

CACHE_FILE="$HOME/.claude/codex-quota-cache.json"
LOCK_FILE="$HOME/.claude/codex-quota-update.lock"

# --- Lock acquisition with stale PID detection ---
acquire_lock() {
  if [ -f "$LOCK_FILE" ]; then
    local lock_pid
    lock_pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      # Another updater is still running
      return 1
    fi
    # Stale lock (process dead) — remove it
    rm -f "$LOCK_FILE"
  fi
  echo $$ > "$LOCK_FILE"
  # Verify we won the race
  local written_pid
  written_pid=$(cat "$LOCK_FILE" 2>/dev/null)
  if [ "$written_pid" != "$$" ]; then
    return 1
  fi
  return 0
}

release_lock() {
  rm -f "$LOCK_FILE"
}

# --- Main ---
if ! acquire_lock; then
  exit 0
fi

trap 'release_lock' EXIT

# Check codex is available
if ! command -v codex >/dev/null 2>&1; then
  exit 0
fi

# Portable timeout: prefer `timeout` (GNU coreutils), fall back to python3
run_with_timeout() {
  local secs="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    # python3 fallback for systems without timeout command
    python3 -c "
import subprocess, sys, signal
proc = subprocess.Popen(sys.argv[2:])
try:
    proc.wait(timeout=int(sys.argv[1]))
    sys.exit(proc.returncode)
except subprocess.TimeoutExpired:
    proc.kill()
    proc.wait()
    sys.exit(124)
" "$secs" "$@"
  fi
}

# Run Python script to fetch quota via app-server JSON-RPC
# Timeout: 20 seconds total
result=$(run_with_timeout 20 python3 -c "
import subprocess, json, sys, time, select, os, fcntl

proc = subprocess.Popen(
    ['codex', 'app-server'],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    text=True, bufsize=1
)
flags = fcntl.fcntl(proc.stdout, fcntl.F_GETFL)
fcntl.fcntl(proc.stdout, fcntl.F_SETFL, flags | os.O_NONBLOCK)

def send(id, method, params={}):
    proc.stdin.write(json.dumps({'jsonrpc':'2.0','id':id,'method':method,'params':params}) + '\n')
    proc.stdin.flush()

def recv(expected_id, timeout=15):
    buf = ''
    deadline = time.time() + timeout
    while time.time() < deadline:
        ready, _, _ = select.select([proc.stdout], [], [], 1.0)
        if ready:
            try:
                chunk = proc.stdout.read(8192)
                if chunk:
                    buf += chunk
                    while '\n' in buf:
                        line, buf = buf.split('\n', 1)
                        if line.strip():
                            msg = json.loads(line.strip())
                            if msg.get('id') == expected_id:
                                return msg
            except (IOError, BlockingIOError):
                pass
    return None

try:
    send(1, 'initialize', {'clientInfo': {'name': 'codex-quota-statusline', 'version': '1.0.0'}})
    if recv(1) is None:
        sys.exit(1)

    send(2, 'account/rateLimits/read')
    resp = recv(2)
    if resp is None:
        sys.exit(1)
    if 'error' in resp:
        sys.exit(1)

    rl = resp['result']['rateLimits']
    pri = rl.get('primary', {})
    sec = rl.get('secondary', {})

    cache = {
        'timestamp': int(time.time()),
        'primary_used_percent': pri.get('usedPercent', -1),
        'secondary_used_percent': sec.get('usedPercent', -1),
        'primary_resets_at': pri.get('resetsAt', ''),
        'secondary_resets_at': sec.get('resetsAt', '')
    }
    json.dump(cache, sys.stdout)
finally:
    proc.kill()
    proc.wait()
" 2>/dev/null)

if [ $? -eq 0 ] && [ -n "$result" ]; then
  # Atomic write via temp file
  tmp="${CACHE_FILE}.tmp.$$"
  echo "$result" > "$tmp"
  mv -f "$tmp" "$CACHE_FILE"
fi
