#!/bin/sh
# Apply pending migrations (advisory-locked by Prisma, safe with --scale quiz=N), then start the service.
set -e
./node_modules/.bin/prisma migrate deploy
exec node dist/main.js
