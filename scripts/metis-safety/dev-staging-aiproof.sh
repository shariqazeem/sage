#!/usr/bin/env bash
# Runs the app against the ISOLATED AI-proof staging DB (read-only proof rendering).
export SAGE_DB_PATH=var/staging-metis-v2-ai-proof.db
export DEPUTY_NETWORK=metis-sepolia
export METIS_CAMPAIGN_FACTORY_ADDRESS=0x2249b773aFEd5594985F7D350581A1b55f279C7f
export NEXT_PUBLIC_USDC_ADDRESS=0xF176f521290A937d81cc5878dfc19908f4D681A1
exec npx next dev -p 3003
