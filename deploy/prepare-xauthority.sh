#!/bin/sh
set -eu

auth_file=$1
display=$2
umask 077
: > "$auth_file"
/usr/bin/xauth -f "$auth_file" add "$display" MIT-MAGIC-COOKIE-1 "$(/usr/bin/mcookie)"
