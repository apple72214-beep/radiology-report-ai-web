# Deployment

Deploy the API workers behind a load balancer with a shared persistent filesystem.

## Event storage

Set `HAGAR_ANALYSIS_EVENT_STORE_PATH` to the same mounted path on every worker. For horizontally scaled production, use a shared event backend.

## Health checks

The `/health` endpoint reports application availability.
