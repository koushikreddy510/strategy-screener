#!/usr/bin/env bash

set -euo pipefail

SCREENER_ROOT="/Users/koushik-bangaru/Desktop/strategy-screener"
TRADING_ROOT="/Users/koushik-bangaru/Desktop/trading-service"
DATA_STORE_ROOT="/Users/koushik-bangaru/Desktop/data-store"
FRONTEND_ROOT="$SCREENER_ROOT/frontend"
SCHEDULER_ROOT="$TRADING_ROOT/scheduler"

LOG_DIR="$SCREENER_ROOT/.stack-logs"
PID_DIR="$SCREENER_ROOT/.stack-pids"

mkdir -p "$LOG_DIR" "$PID_DIR"

usage() {
  cat <<'EOF'
Usage:
  ./run_local_stack.sh start [--with-scheduler]
  ./run_local_stack.sh stop
  ./run_local_stack.sh status
  ./run_local_stack.sh restart [--with-scheduler]

Starts the local stack:
  - strategy-screener backend (8000)
  - trading-service API (8001)
  - strategy-screener frontend (3000)
  - data-store runner (8003)

Optional:
  --with-scheduler   also starts trading-service scheduler (8004)

Logs:
  .stack-logs/<service>.log
EOF
}

read_env_value() {
  local file="$1"
  local key="$2"
  if [[ -f "$file" ]]; then
    local line
    line="$(python3 - "$file" "$key" <<'PY'
import sys
path, key = sys.argv[1], sys.argv[2]
try:
    with open(path) as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            if k.strip() == key:
                print(v.strip())
                break
except FileNotFoundError:
    pass
PY
)"
    printf '%s' "$line"
  fi
}

DATABASE_URL_VALUE="$(read_env_value "$SCREENER_ROOT/.env" "DATABASE_URL")"
MARKET_DATABASE_URL_VALUE="$(read_env_value "$TRADING_ROOT/.env" "MARKET_DATABASE_URL")"
TRADING_DATABASE_URL_VALUE="$(read_env_value "$TRADING_ROOT/.env" "DATABASE_URL")"
DATA_STORE_DIR_VALUE="$(read_env_value "$SCREENER_ROOT/.env" "DATA_STORE_DIR")"

if [[ -z "${DATABASE_URL_VALUE:-}" ]]; then
  echo "ERROR: DATABASE_URL not found in $SCREENER_ROOT/.env"
  exit 1
fi

if [[ -z "${TRADING_DATABASE_URL_VALUE:-}" ]]; then
  TRADING_DATABASE_URL_VALUE="$DATABASE_URL_VALUE"
fi

if [[ -z "${MARKET_DATABASE_URL_VALUE:-}" ]]; then
  MARKET_DATABASE_URL_VALUE="$DATABASE_URL_VALUE"
fi

if [[ -z "${DATA_STORE_DIR_VALUE:-}" ]]; then
  DATA_STORE_DIR_VALUE="$DATA_STORE_ROOT"
fi

port_open() {
  local port="$1"
  python3 - "$port" <<'PY'
import socket, sys
port = int(sys.argv[1])
s = socket.socket()
s.settimeout(0.2)
try:
    s.connect(("127.0.0.1", port))
    print("open")
except Exception:
    print("closed")
finally:
    s.close()
PY
}

start_one() {
  local name="$1"
  local port="$2"
  local cmd="$3"
  local logfile="$LOG_DIR/$name.log"
  local pidfile="$PID_DIR/$name.pid"

  if [[ "$(port_open "$port")" == "open" ]]; then
    echo "[skip] $name already appears to be running on port $port"
    return
  fi

  echo "[start] $name -> $logfile"
  nohup bash -lc "$cmd" >"$logfile" 2>&1 &
  echo $! >"$pidfile"
  sleep 1
}

without_proxy_env() {
  cat <<'EOF'
unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy;
unset SOCKS_PROXY SOCKS5_PROXY socks_proxy socks5_proxy;
unset GIT_HTTP_PROXY GIT_HTTPS_PROXY;
EOF
}

stop_one() {
  local name="$1"
  local pidfile="$PID_DIR/$name.pid"
  if [[ -f "$pidfile" ]]; then
    local pid
    pid="$(cat "$pidfile")"
    if kill -0 "$pid" >/dev/null 2>&1; then
      echo "[stop] $name (pid $pid)"
      kill "$pid" >/dev/null 2>&1 || true
    else
      echo "[warn] $name pid file exists but process is not running"
    fi
    rm -f "$pidfile"
  else
    echo "[skip] no pid file for $name"
  fi
}

status_one() {
  local name="$1"
  local port="$2"
  local pidfile="$PID_DIR/$name.pid"
  local state
  state="$(port_open "$port")"
  if [[ -f "$pidfile" ]]; then
    echo "$name: port=$port state=$state pid=$(cat "$pidfile") log=$LOG_DIR/$name.log"
  else
    echo "$name: port=$port state=$state pid=unknown log=$LOG_DIR/$name.log"
  fi
}

start_stack() {
  local with_scheduler="${1:-0}"

  start_one "screener-backend" "8000" \
    "$(without_proxy_env) cd \"$SCREENER_ROOT\" && source .venv/bin/activate && export DATA_STORE_DIR=\"$DATA_STORE_DIR_VALUE\" && python run_server.py"

  start_one "trading-service" "8001" \
    "$(without_proxy_env) cd \"$TRADING_ROOT\" && source .venv/bin/activate && export DATABASE_URL=\"$TRADING_DATABASE_URL_VALUE\" && export MARKET_DATABASE_URL=\"$MARKET_DATABASE_URL_VALUE\" && export STRATEGY_SCREENER_URL=\"http://127.0.0.1:8000\" && uvicorn main:app --reload --host 0.0.0.0 --port 8001"

  start_one "data-store-runner" "8003" \
    "$(without_proxy_env) cd \"$DATA_STORE_ROOT\" && source \"$SCREENER_ROOT/.venv/bin/activate\" && export DATABASE_URL=\"$DATABASE_URL_VALUE\" && uvicorn runner:app --reload --host 0.0.0.0 --port 8003"

  start_one "frontend" "3000" \
    "$(without_proxy_env) cd \"$FRONTEND_ROOT\" && export REACT_APP_API_URL=\"http://localhost:8000\" && export REACT_APP_TRADING_API_URL=\"http://localhost:8001\" && npm start"

  if [[ "$with_scheduler" == "1" ]]; then
    start_one "scheduler" "8004" \
      "$(without_proxy_env) cd \"$SCHEDULER_ROOT\" && source .venv/bin/activate && export SCREENER_URL=\"http://127.0.0.1:8000\" && export TRADING_URL=\"http://127.0.0.1:8001\" && export DATA_STORE_URL=\"http://127.0.0.1:8003\" && uvicorn main:app --reload --host 0.0.0.0 --port 8004"
  else
    echo "[note] scheduler not started by default (avoids scheduled side effects). Use --with-scheduler if needed."
  fi

  echo
  echo "Stack startup requested. Run:"
  echo "  ./run_local_stack.sh status"
}

stop_stack() {
  stop_one "frontend"
  stop_one "data-store-runner"
  stop_one "trading-service"
  stop_one "screener-backend"
  stop_one "scheduler"
}

status_stack() {
  status_one "screener-backend" "8000"
  status_one "trading-service" "8001"
  status_one "data-store-runner" "8003"
  status_one "frontend" "3000"
  status_one "scheduler" "8004"
}

main() {
  local cmd="${1:-}"
  local with_scheduler=0

  if [[ "${2:-}" == "--with-scheduler" || "${1:-}" == "--with-scheduler" ]]; then
    with_scheduler=1
  fi

  case "$cmd" in
    start)
      start_stack "$with_scheduler"
      ;;
    stop)
      stop_stack
      ;;
    status)
      status_stack
      ;;
    restart)
      stop_stack
      start_stack "$with_scheduler"
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
