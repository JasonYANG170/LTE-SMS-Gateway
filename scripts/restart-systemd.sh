#!/usr/bin/env bash
# The service uses Restart=always, so server.js exiting triggers systemd restart.
set -eu
case "${1:-}" in ''|*[!0-9]*) exit 1;; esac
[[ "$1" == "$PPID" ]] || exit 1
exit 0
