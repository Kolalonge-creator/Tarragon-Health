-- S11d: the emergency-symptom question (BP-X1, TRI-008) offers weakness or numbness, trouble speaking and back pain,
-- which the symptom_type enum did not have. They are added so an answer of "yes" can be stored as a symptoms row, which
-- is what the server's triage context reads (private/public.triage_context_for_observation already lists them).
-- Enum values cannot be used in the transaction that adds them; nothing here uses them.
alter type public.symptom_type add value if not exists 'weakness_or_numbness';
alter type public.symptom_type add value if not exists 'difficulty_speaking';
alter type public.symptom_type add value if not exists 'back_pain';
