# NexPortal BPS Demo — Modern UI Pass

## Updated
- Rebranded the portal and browser title as NexPortal.
- Replaced visible JComm company references with BPS demo branding.
- Added a new gradient NexPortal mark in the main navigation.
- Modernized the sticky navigation with deeper glass styling and improved shadows.
- Rebuilt the sign-in presentation as a responsive split-screen SaaS landing experience.
- Added BPS Demo Environment messaging and NexPortal product positioning.
- Added a cyan/blue/violet design system and upgraded global focus states.
- Replaced the original Vite starter CSS with portal-specific responsive styling.
- Updated local browser storage keys so the BPS demo does not reuse JComm manager/onboarding keys.

## Important separation step
Before deployment, connect this copy only to the separate BPS Supabase and Vercel environment variables. Do not copy the JComm production environment variables into this project.

## Build note
The source JSX was syntax-checked after editing. A full npm build could not be completed in the workspace because the package registry returned a 404 while downloading `yocto-queue@0.1.0`. Run `npm install` and `npm run build` in the normal project environment before deployment.
