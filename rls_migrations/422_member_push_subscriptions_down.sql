-- 422 down — remove member push subscriptions.
-- Drops the member RPCs and the auth_user_id owner additions. Casual player
-- subscriptions (player_id) are untouched.

DROP FUNCTION IF EXISTS public.unregister_member_push_subscription(text);
DROP FUNCTION IF EXISTS public.register_member_push_subscription(jsonb, text);

DROP INDEX IF EXISTS public.push_subscriptions_authuser_platform_key;

ALTER TABLE public.push_subscriptions
  DROP CONSTRAINT IF EXISTS push_subscriptions_owner_chk;

-- Only safe to drop the column if no member rows exist; CASCADE would orphan them.
ALTER TABLE public.push_subscriptions
  DROP COLUMN IF EXISTS auth_user_id;
