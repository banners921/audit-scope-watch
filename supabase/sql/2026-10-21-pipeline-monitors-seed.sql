-- Pipeline monitor definitions (2026-10-21). Re-running resets thresholds and
-- suppression to these values but keeps each monitor's current state.
-- check_sql returns the newest timestamp of data the pipeline actually landed.
insert into public.pipeline_monitors (name, feeds, check_sql, threshold, quiet_ok, fn_name, suppressed, suppressed_reason) values
-- Audit ingestion
('Audit ingestion: firm GitHub repos + websites', 'audit_history',
 $$select max(created_at) from audit_history where data_source like 'bulk-ingest:%' or data_source like 'scrape:%'$$, '24 hours', false, 'poll-audit-firm-repos', false, null),
('Audit ingestion: website scraper', 'audit_history', $$select max(created_at) from audit_history where data_source like 'scrape:%'$$, '21 days', true, 'scrape-audit-firm', false, null),
('Audit ingestion: Sherlock', 'audit_history', $$select max(created_at) from audit_history where data_source ilike '%sherlock%'$$, '21 days', true, 'ingest-sherlock-reports', false, null),
('Audit ingestion: Code4rena', 'audit_history', $$select max(created_at) from audit_history where data_source ilike '%code4rena%' or data_source ilike 'c4%'$$, '21 days', true, 'ingest-code4rena-reports', false, null),
('Audit ingestion: Hacken sitemap', 'audit_history', $$select max(created_at) from audit_history where data_source like 'hacken%'$$, '21 days', true, 'import-hacken-sitemap', false, null),
('Audit ingestion: CyberScope', 'audit_history', $$select max(created_at) from audit_history where data_source ilike '%cyberscope%'$$, '21 days', true, 'sync-cyberscope', false, null),
('Audit ingestion: Cantina', 'audit_history', $$select max(created_at) from audit_history where data_source ilike '%cantina%'$$, '21 days', true, null, false, null),
('Audit ingestion: protocol-side discovery', 'audit_history',
 $$select max(created_at) from audit_history where data_source ilike any (array['github_protocol_repo%','protocol_security_page%','firm_repo_walk%','discover%'])$$, '21 days', true, 'discover-company-audits', false, null),
('Audit ingestion: pending-company promotion', 'audit_history', $$select max(created_at) from audit_history where data_source like 'pending_promoted%'$$, '21 days', true, null, false, null),
('Audit ingestion: Solodit', 'audit_history', $$select max(created_at) from audit_history where data_source ilike 'solodit%'$$, '7 days', true, null, true, 'Cron solodit-ingest-recurring disabled (active=false) since May'),
-- Findings
('Severity extraction', 'audit_history findings_*', $$select max(findings_extracted_at) from audit_history where findings_extraction_status like 'extracted%'$$, '24 hours', false, null, true,
 'Jina 402 + Anthropic credits; replacement extract-findings-gemini awaits Gemini billing. Unsuppress when it is scheduled.'),
('Finding detail rows', 'audit_findings_detail', $$select max(created_at) from audit_findings_detail$$, '48 hours', false, null, true, 'Same pipeline as severity extraction'),
('Audit date backfill', 'audit_history.audit_date', $$select max(findings_extracted_at) from audit_history where audit_date_attempted_via is not null$$, '7 days', true, 'backfill-audit-dates', false, null),
('Audited-contract extraction', 'audit_contracts', $$select max(created_at) from audit_contracts$$, '7 days', false, null, true, 'Never scheduled (last rows from a one-off run, Jun 9)'),
-- TVL and on-chain
('TVL: DeFiLlama nightly sync', 'defillama_protocols, protocol_metrics', $$select max(synced_at) from defillama_protocols$$, '36 hours', false, 'sync-defillama-protocols', false, null),
('On-chain tx counts', 'protocol_metrics (onchain:*)', $$select max(created_at) from protocol_metrics where source like 'onchain:%'$$, '6 hours', false, 'collect-onchain-tx-counts', false, null),
('DeFiLlama list (oracle-diff)', 'llama_protocols', $$select max(refreshed_at) from llama_protocols$$, '9 days', false, 'oracle-diff', false, null),
('TVL: old per-protocol collector', 'protocol_metrics (defillama fees/volume)', $$select max(created_at) from protocol_metrics where source = 'defillama' and fees_usd is not null$$, '48 hours', false, null, true, 'No schedule since Jun 23; TVL now comes from sync-defillama-protocols'),
('Metric anomalies', 'metric_anomalies', $$select max(created_at) from metric_anomalies$$, '7 days', false, null, true, 'Written by collect-protocol-metrics, which has no schedule'),
('Protocol economics', 'protocol_economics', $$select max(fetched_at) from protocol_economics$$, '7 days', false, null, true, 'No schedule'),
('Contract address discovery', 'chain_addresses', $$select max(created_at) from chain_addresses$$, '21 days', true, null, false, null),
('Contract metadata check', 'chain_addresses.metadata_checked_at', $$select max(metadata_checked_at) from chain_addresses$$, '21 days', true, 'collect-contract-metadata', false, null),
-- Radar inputs (nightly schedule starts when the Radar ships)
('GitHub repo scan', 'company_repos', $$select max(synced_at) from company_repos$$, '36 hours', false, 'sync-github-repos', true, 'Nightly schedule starts when Audit Radar v2 ships'),
('Commits since audited commit', 'audit_code_changes', $$select max(fetched_at) from audit_code_changes$$, '36 hours', false, 'audit-code-changes', true, 'Nightly schedule starts when Audit Radar v2 ships'),
('Audit Radar leads', 'radar_leads', $$select max(computed_at) from radar_leads$$, '36 hours', false, null, true, 'Nightly schedule starts when Audit Radar v2 ships'),
-- Funding
('Funding rounds (Web3Leads)', 'funding_rounds', $$select max(created_at) from funding_rounds$$, '48 hours', false, 'collect-web3leads-raises', true, 'Web3Leads API host gone (DNS) since ~Oct 16; no replacement scheduled'),
('Funds / investors (Web3Leads)', 'funds', $$select max(last_updated) from funds$$, '48 hours', false, 'sync-funds-from-web3leads', true, 'Same Web3Leads outage'),
('RootData funding', 'rootdata_*_staging', $$select max(imported_at) from rootdata_funding_rounds_staging$$, '7 days', false, null, true, 'Cron rd-enrich-drainer-1min disabled'),
-- Hacks and bounties
('Hacks', 'hacks', $$select max(created_at) from hacks$$, '72 hours', true, 'collect-hack-alerts', false, null),
('Bug bounties', 'bug_bounties', $$select max(last_updated) from bug_bounties$$, '8 days', true, 'import-immunefi', false, null),
('Bug bounty deep extraction', 'bug_bounties scope fields', $$select max(deep_extracted_at) from bug_bounties$$, '14 days', false, null, true, 'No schedule'),
-- Company data
('Company signals snapshot', 'company_signals_snapshot', $$select max(created_at) from company_signals_snapshot$$, '30 hours', false, 'snapshot-company-signals', false, null),
('News', 'news_items', $$select max(created_at) from news_items$$, '2 hours', false, 'collect-news', true, 'Cron sends no request body: every run 400 since May 23'),
('X activity', 'companies.x_activity_checked_at', $$select max(x_activity_checked_at) from companies$$, '1 hour', false, 'poll-x-activity', true, 'Cron sends no request body: every run 400 since Jun 23'),
('Company descriptions (AI)', 'companies.description', $$select max(description_generated_at) from companies$$, '14 days', false, null, true, 'No schedule; Anthropic credits'),
('Company enrichment', 'company_enrichment', $$select max(enriched_at) from company_enrichment$$, '14 days', false, null, true, 'No schedule (2 rows ever)'),
('Company refresh', 'companies.last_refreshed_at', $$select max(last_refreshed_at) from companies$$, '14 days', false, null, true, 'Never ran'),
('Risk scores', 'protocol_risk_scores', $$select max(computed_at) from protocol_risk_scores$$, '48 hours', false, null, true, 'No schedule since May 23; hidden on the site until revived'),
('Risk landscape briefs', 'risk_landscape_briefs', $$select max(generated_at) from risk_landscape_briefs$$, '7 days', false, null, true, 'No schedule'),
('Account signals', 'account_signals', $$select max(fired_at) from account_signals$$, '7 days', false, null, true, 'All writers unscheduled'),
('Governance', 'governance_proposals', $$select max(created_at) from governance_proposals$$, '7 days', false, null, true, 'No schedule'),
('Token unlocks', 'token_unlocks', $$select max(updated_at) from token_unlocks$$, '7 days', false, null, true, 'No schedule'),
('Oracle dependencies', 'oracle_dependencies', $$select max(added_at) from oracle_dependencies$$, '14 days', false, null, true, 'No schedule'),
('Hiring boards', 'hiring_boards', $$select max(last_synced_at) from hiring_boards$$, '7 days', false, null, true, 'No schedule'),
('Institutions monitor', 'institutions', $$select max(last_monitored) from institutions$$, '7 days', false, null, true, 'No schedule'),
-- Product surfaces and rollups
('Firm coverage rollup', 'firm_coverage', $$select max(updated_at) from firm_coverage$$, '3 hours', false, null, false, null),
('Landing stats cache', 'landing_stats_cache', $$select max(updated_at) from landing_stats_cache$$, '1 hour', false, null, false, null),
('Watchlist alerts (error rate only)', 'Slack/Telegram deliveries', $$select now()$$, '1 hour', false, 'watchlist-alerts', false, null),
-- The monitor's own input: if pg_net upgrades drop the logging trigger, error-rate checks go blind.
('Monitor self-check: call log', 'pipeline_calls', $$select max(called_at) from pipeline_calls$$, '2 hours', false, null, false, null)
on conflict (name) do update set feeds = excluded.feeds, check_sql = excluded.check_sql, threshold = excluded.threshold,
  quiet_ok = excluded.quiet_ok, fn_name = excluded.fn_name, suppressed = excluded.suppressed, suppressed_reason = excluded.suppressed_reason;
