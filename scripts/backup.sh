#!/bin/sh
set -eu

backup_dir=${BACKUP_DIR:-"$PWD/backups"}
mkdir -p "$backup_dir"
backup_dir=$(cd "$backup_dir" && pwd)
stamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
archive="$backup_dir/homework-$stamp.tar.gz"
temporary="$archive.tmp.$$"
was_running=0

if [ -n "$(docker compose ps --status running -q homework)" ]; then
  was_running=1
fi

cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  rm -f "$temporary"
  if [ "$was_running" -eq 1 ] && [ "${KEEP_STOPPED:-0}" != 1 ]; then
    docker compose start homework >/dev/null || result=$?
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$was_running" -eq 1 ]; then
  docker compose stop homework >/dev/null
fi

umask 077
docker compose run --rm --no-deps -T --entrypoint sh homework -ec \
  'tar -czf - -C /app/data .' > "$temporary"
tar -tzf "$temporary" >/dev/null
mv "$temporary" "$archive"
chmod 600 "$archive"
printf 'Backup saved: %s\n' "$archive"
