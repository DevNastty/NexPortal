# NexPortal demo login fix

Demo credentials:

- Email: demo@nexportal.xyz
- Password: demo123

## Code changes

- `src/lib/portalAuth.ts`
  - Uses a minimal required profile lookup first.
  - Loads optional profile fields separately.
  - Allows the exact demo account to continue as a Director after Supabase Auth succeeds even when the optional profile query is blocked by RLS or an older schema.
- `src/App.tsx`
  - Displays Supabase's real error message instead of always showing `Unable to sign in.`

Deploy this ZIP to the existing NexPortal Vercel project. Keep the existing `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` environment variables.
