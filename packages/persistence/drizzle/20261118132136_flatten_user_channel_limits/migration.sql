-- Drops the `managed` level from each purpose in `user_channel.limits` (#34):
-- { "transactional": { "managed": { dailySends, monthlySends } } } becomes
-- { "transactional": { dailySends, monthlySends } }.
--
-- A cap absent from the old bucket was read as unlimited, so it is written as an explicit
-- null. A purpose is rewritten only when its `managed` is an object: anything else has no
-- caps to carry over, and is left for the Usage policy to refuse rather than made
-- unlimited here. A purpose already in the new shape has no `managed`, so the statement
-- can run again and changes nothing.
UPDATE "user_channel"
SET "limits" = "limits"
	|| CASE WHEN jsonb_typeof("limits" -> 'transactional' -> 'managed') = 'object'
		THEN jsonb_build_object('transactional', jsonb_build_object(
			'dailySends', "limits" -> 'transactional' -> 'managed' -> 'dailySends',
			'monthlySends', "limits" -> 'transactional' -> 'managed' -> 'monthlySends'))
		ELSE '{}'::jsonb END
	|| CASE WHEN jsonb_typeof("limits" -> 'marketing' -> 'managed') = 'object'
		THEN jsonb_build_object('marketing', jsonb_build_object(
			'dailySends', "limits" -> 'marketing' -> 'managed' -> 'dailySends',
			'monthlySends', "limits" -> 'marketing' -> 'managed' -> 'monthlySends'))
		ELSE '{}'::jsonb END
WHERE jsonb_typeof("limits" -> 'transactional' -> 'managed') = 'object'
	OR jsonb_typeof("limits" -> 'marketing' -> 'managed') = 'object';
