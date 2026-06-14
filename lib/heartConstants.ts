// Shared heart constants — isolated here to prevent a circular import between
// lib/supabase.ts (which imports guestSnapshot) and lib/guestSnapshot.ts (which
// needs MAX_LIVES). Both files import from here; neither imports the other for this value.
export const MAX_LIVES = 12
