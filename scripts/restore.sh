#!/bin/sh
set -eu

if [ "$#" -ne 2 ] || [ "$1" != '--confirm-replace' ]; then
  printf 'Usage: %s --confirm-replace /absolute/path/to/homework-backup.tar.gz\n' "$0" >&2
  exit 2
fi

archive=$(cd "$(dirname "$2")" && pwd)/$(basename "$2")
if [ ! -f "$archive" ]; then
  printf 'Backup archive not found: %s\n' "$archive" >&2
  exit 2
fi
tar -tzf "$archive" >/dev/null
if ! tar -tzf "$archive" | awk '
  BEGIN { bad = 0 }
  {
    path = $0
    if (path ~ /^\//) bad = 1
    count = split(path, part, "/")
    for (i = 1; i <= count; i++) if (part[i] == "..") bad = 1
    sub(/^\.\//, "", path)
    sub(/\/$/, "", path)
    if (path == "" || path == "media" || path == "homework.sqlite"
        || path == "homework.sqlite-wal" || path == "homework.sqlite-shm"
        || path == "homework.sqlite-journal") next
    if (path ~ /^media\/[a-f0-9]+\.(png|jpg|webp|gif|mp3|mp4|webm|ogg|wav)$/) {
      name = substr(path, 7)
      dot = index(name, ".")
      if (dot == 65) next
    }
    bad = 1
  }
  END { exit bad }
'; then
  printf 'Archive contains an unsafe path. Nothing was changed.\n' >&2
  exit 2
fi
if ! tar -tvzf "$archive" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }'; then
  printf 'Archive contains a link or unsupported file type. Nothing was changed.\n' >&2
  exit 2
fi

was_running=0
if [ -n "$(docker compose ps --status running -q homework)" ]; then
  was_running=1
fi
temporary_archive=/backup/restore.tar.gz

cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$was_running" -eq 1 ]; then
    docker compose start homework >/dev/null || result=$?
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Keep a fresh copy before replacing the volume, and leave the service stopped
# so no new submission can arrive between that copy and the restore.
KEEP_STOPPED=1 "$(dirname "$0")/backup.sh"

docker compose run --rm --no-deps -T \
  -v "$archive:$temporary_archive:ro" \
  --entrypoint sh homework -ec '
    mkdir -p /tmp/homework-restore
    tar -xzf /backup/restore.tar.gz -C /tmp/homework-restore
    test -s /tmp/homework-restore/homework.sqlite
    test -d /tmp/homework-restore/media
    node --input-type=module -e "import {DatabaseSync} from '\''node:sqlite'\''; const db=new DatabaseSync('/tmp/homework-restore/homework.sqlite',{readOnly:true}); const result=db.prepare('\''PRAGMA integrity_check'\'').get(); db.close(); if(result.integrity_check!=='\''ok'\'') process.exit(1)"
    find /app/data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} \;
    cp -a /tmp/homework-restore/. /app/data/
  '
printf 'Restored from: %s\n' "$archive"
