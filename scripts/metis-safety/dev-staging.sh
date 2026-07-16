#!/usr/bin/env bash
# Runs the app against the ISOLATED staging DB (read-only proof rendering).
export SAGE_DB_PATH=var/staging-metis-safety.db
exec npx next dev -p 3002
