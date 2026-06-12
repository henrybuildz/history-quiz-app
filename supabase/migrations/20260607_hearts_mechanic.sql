-- Hearts mechanic: deduct lives on wrong answer, regenerate over time.
--
-- Adds last_life_lost_at to profiles so the server can calculate how many
-- hearts have regenerated since the player last lost one.
-- Rate: 1 life per 6 hours, capped at MAX_LIVES (12).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_life_lost_at TIMESTAMPTZ DEFAULT NULL;

-- ── deduct_life ────────────────────────────────────────────────────────────────
-- Called on every wrong answer. Atomically decrements lives (floor 0) and
-- records the timestamp so regen_lives can calculate elapsed time.
-- Returns the new lives count.

DROP FUNCTION IF EXISTS deduct_life(UUID);

CREATE FUNCTION deduct_life(
  p_user_id  UUID,
  OUT out_lives INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'deduct_life: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  UPDATE profiles
  SET
    lives             = GREATEST(0, lives - 1),
    -- Only advance the timestamp when a life is actually lost (lives > 0).
    -- When already at 0, keep the original timestamp so regen math is correct.
    last_life_lost_at = CASE WHEN lives > 0 THEN NOW() ELSE last_life_lost_at END
  WHERE id = p_user_id
  RETURNING lives INTO out_lives;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'deduct_life: profile not found'
      USING ERRCODE = 'no_data_found';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION deduct_life(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION deduct_life(UUID) TO authenticated;

-- ── regen_lives ────────────────────────────────────────────────────────────────
-- Called on quiz start. Calculates how many lives have regenerated since
-- last_life_lost_at, applies them atomically, and returns:
--   out_lives        — current lives after regen
--   out_next_life_at — when the next life will be ready (NULL if already at max)

DROP FUNCTION IF EXISTS regen_lives(UUID);

CREATE FUNCTION regen_lives(
  p_user_id        UUID,
  OUT out_lives        INTEGER,
  OUT out_next_life_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_max_lives   CONSTANT INTEGER := 12;
  v_regen_hours CONSTANT INTEGER := 6;
  v_lives       INTEGER;
  v_last_lost   TIMESTAMPTZ;
  v_elapsed_h   NUMERIC;
  v_to_add      INTEGER;
  v_new_lost_at TIMESTAMPTZ;
BEGIN
  IF auth.uid() IS NULL OR auth.uid() != p_user_id THEN
    RAISE EXCEPTION 'regen_lives: insufficient privilege'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- FOR UPDATE locks the row for the duration of this transaction, preventing
  -- two concurrent regen_lives calls (e.g. from two devices) from both reading
  -- the same stale lives count and each independently adding regenerated hearts.
  SELECT lives, last_life_lost_at
  INTO v_lives, v_last_lost
  FROM profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'regen_lives: profile not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Already at max or never lost a life — nothing to regen.
  IF v_lives >= v_max_lives OR v_last_lost IS NULL THEN
    out_lives        := v_lives;
    out_next_life_at := NULL;
    RETURN;
  END IF;

  v_elapsed_h := EXTRACT(EPOCH FROM (NOW() - v_last_lost)) / 3600;
  v_to_add    := LEAST(
    FLOOR(v_elapsed_h / v_regen_hours)::INTEGER,
    v_max_lives - v_lives
  );

  IF v_to_add <= 0 THEN
    -- No full intervals elapsed yet — return current state and next regen time.
    out_lives        := v_lives;
    out_next_life_at := v_last_lost + (v_regen_hours * INTERVAL '1 hour');
    RETURN;
  END IF;

  -- Advance last_life_lost_at by the regenerated intervals so partial progress
  -- toward the NEXT life is preserved (don't reset the full 6-hour window).
  v_new_lost_at := v_last_lost + (v_to_add * v_regen_hours * INTERVAL '1 hour');

  UPDATE profiles
  SET
    lives             = lives + v_to_add,
    last_life_lost_at = v_new_lost_at
  WHERE id = p_user_id
  RETURNING lives INTO out_lives;

  -- If still below max after regen, tell the client when the next one arrives.
  IF out_lives < v_max_lives THEN
    out_next_life_at := v_new_lost_at + (v_regen_hours * INTERVAL '1 hour');
  ELSE
    out_next_life_at := NULL;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION regen_lives(UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION regen_lives(UUID) TO authenticated;
