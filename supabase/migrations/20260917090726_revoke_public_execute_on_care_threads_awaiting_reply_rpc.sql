-- New functions get an implicit PUBLIC EXECUTE grant on creation regardless
-- of the public-schema default-privilege revoke (that revoke covers TABLE
-- default privileges, not the separate function-creation-time PUBLIC grant)
-- -- the recurring "anon inherits execute via PUBLIC, not a direct grant"
-- gotcha documented in CLAUDE.md. Close it explicitly rather than assume the
-- authenticated-only grant in the prior migration was sufficient.
revoke execute on function public.count_care_threads_awaiting_reply() from public;
