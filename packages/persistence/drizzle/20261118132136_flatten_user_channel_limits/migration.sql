-- Drops the `managed` level from each purpose in `user_channel.limits` (#34):
-- { "transactional": { "managed": { dailySends, monthlySends } } } becomes
-- { "transactional": { dailySends, monthlySends } }.
--
-- A purpose is rewritten only when its `managed` is an object holding both caps, which is
-- every bucket the plans code has written. Anything else (no bucket, or one missing a cap,
-- which the old reader took for unlimited) is left as it is for the Usage policy to
-- refuse, never made unlimited here. A purpose already in the new shape has no `managed`,
-- so the statement can run again and changes nothing.
UPDATE "user_channel"
SET "limits" = "limits"
	|| CASE WHEN jsonb_typeof("limits" -> 'transactional' -> 'managed') = 'object'
			AND "limits" -> 'transactional' -> 'managed' ?& array['dailySends', 'monthlySends']
		THEN jsonb_build_object('transactional', jsonb_build_object(
			'dailySends', "limits" -> 'transactional' -> 'managed' -> 'dailySends',
			'monthlySends', "limits" -> 'transactional' -> 'managed' -> 'monthlySends'))
		ELSE '{}'::jsonb END
	|| CASE WHEN jsonb_typeof("limits" -> 'marketing' -> 'managed') = 'object'
			AND "limits" -> 'marketing' -> 'managed' ?& array['dailySends', 'monthlySends']
		THEN jsonb_build_object('marketing', jsonb_build_object(
			'dailySends', "limits" -> 'marketing' -> 'managed' -> 'dailySends',
			'monthlySends', "limits" -> 'marketing' -> 'managed' -> 'monthlySends'))
		ELSE '{}'::jsonb END
WHERE (jsonb_typeof("limits" -> 'transactional' -> 'managed') = 'object'
		AND "limits" -> 'transactional' -> 'managed' ?& array['dailySends', 'monthlySends'])
	OR (jsonb_typeof("limits" -> 'marketing' -> 'managed') = 'object'
		AND "limits" -> 'marketing' -> 'managed' ?& array['dailySends', 'monthlySends']);
