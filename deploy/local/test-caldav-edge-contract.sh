#!/usr/bin/env bash
# Synthetic loopback-only contract for the real, opt-in NGINX DAV location.
set -euo pipefail
umask 077
base=${1:?Loopback URL required}
[[ "$base" =~ ^http://127\.0\.0\.1:[0-9]+$ ]] || { echo 'Only a disposable loopback fixture is permitted' >&2; exit 2; }
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
expect_status() {
  local expected=$1; shift
  local actual
  actual=$(curl --silent --show-error --max-time 10 --output "$work/body" --dump-header "$work/headers" --write-out '%{http_code}' "$@")
  [[ "$actual" == "$expected" ]] || { echo "DAV edge expected $expected, got $actual" >&2; exit 1; }
}
expect_status 403 "$base/dav/"
expect_status 403 -H 'X-Forwarded-Proto: http' "$base/dav/"
expect_status 401 -H 'X-Forwarded-Proto: https' "$base/dav/"
expect_status 307 -H 'X-Forwarded-Proto: https' "$base/.well-known/caldav"
grep -qi '^location: https://calendar.example/dav/' "$work/headers"
expect_status 201 -X POST -H 'Authorization: Bearer contract-token' -H 'Content-Type: application/json' --data '{"timeZone":"UTC"}' "$base/v1/calendar-connections"
mv "$work/body" "$work/connection.json"
ruby -rjson - "$work/connection.json" "$work/auth.conf" "$work/id" <<'RUBY'
connection = JSON.parse(File.read(ARGV[0]))
auth = [connection.fetch('username') + ':' + connection.fetch('password')].pack('m0')
File.write(ARGV[1], "header = \"Authorization: Basic #{auth}\"\nheader = \"X-Forwarded-Proto: https\"\n")
File.write(ARGV[2], connection.fetch('id'))
RUBY
collection="$base/dav/calendars/$(<"$work/id")/family/"
expect_status 207 --config "$work/auth.conf" -X PROPFIND -H 'Depth: 1' -H 'Content-Type: application/xml' \
  --data '<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>' "$collection"
printf '%s\r\n' 'BEGIN:VCALENDAR' 'VERSION:2.0' 'PRODID:-//Rallyroo//Edge Contract//EN' \
  'BEGIN:VEVENT' 'UID:edge-contract@preview.invalid' 'DTSTAMP:20270101T000000Z' \
  'DTSTART:20270104T150000Z' 'DTEND:20270104T160000Z' 'SUMMARY:Synthetic edge probe' \
  'END:VEVENT' 'END:VCALENDAR' >"$work/event.ics"
resource="${collection}edge-contract.ics"
expect_status 201 --config "$work/auth.conf" -X PUT -H 'Content-Type: text/calendar' -H 'If-None-Match: *' --data-binary "@$work/event.ics" "$resource"
expect_status 200 --config "$work/auth.conf" "$resource"
cmp "$work/body" "$work/event.ics"
etag=$(awk 'tolower($1)=="etag:" {gsub("\r", "", $2); print $2}' "$work/headers")
[[ -n "$etag" ]]
expect_status 207 --config "$work/auth.conf" -X REPORT -H 'Content-Type: application/xml' \
  --data '<c:calendar-query xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:d="DAV:"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>' "$collection"
expect_status 204 --config "$work/auth.conf" -X DELETE -H "If-Match: $etag" "$resource"
expect_status 404 --config "$work/auth.conf" "$resource"
echo 'Synthetic DAV edge contract passed (discovery, TLS boundary, PROPFIND, REPORT, PUT, GET, DELETE).'
