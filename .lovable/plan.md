I agree: they do not match. The footer logo is effectively still rendering as the smaller/no-crosshair version, and the current landing page setup is the wrong foundation for a working app page.

Yes — the main problem is that the landing page is currently a standalone exported `public/landing.html` file that the React app redirects to from `/`. It contains a dumped/pre-rendered HTML snapshot plus embedded generated JavaScript, rather than being a first-class React page inside the app. That is why the buttons/links are not properly wired into the app and why logo changes are brittle/inconsistent.

Plan:

1. Replace the static HTML redirect with a real React landing page
   - Create a proper React component for the AuditScope landing page.
   - Move the landing page into the app router at `/` instead of redirecting to `/landing.html`.
   - Keep the existing landing page design, copy, colors, layout, pricing, and sections intact.

2. Fix the logo once, shared by top and bottom
   - Use one shared `AuditScopeLogo` / logo-mark component for both nav and footer.
   - Use the crosshair icon with the 4 crosshair lines for both placements.
   - Make both icons slightly larger.
   - Keep spacing between icon and `AuditScope` uniform and intentional in both nav and footer.
   - Move the top wordmark slightly closer to the icon as requested.

3. Make the navigation and CTAs actually work
   - `Features` scrolls to the Features section.
   - `Pricing` scrolls to the Pricing section.
   - `Sign in` routes to `/login`.
   - `Get Started` and `Get Started — $149/mo →` route to `/signup`.
   - `hello@auditscope.ai` becomes a working `mailto:` link where appropriate.

4. Put the dark/light toggle in the actual top banner
   - Remove the floating/static toggle behavior.
   - Place the toggle inside the nav/banner area.
   - Make it update the React page theme state properly.
   - Keep the dark/light colors from the provided design.

5. Clean up the old static implementation
   - Stop using `LandingRedirect` in `src/App.tsx`.
   - Leave `public/landing.html` unused or remove it if safe.
   - Use the normal Vite/React app flow so the landing page works like the rest of the application.

Technical details:

- Current root route:

```text
/ -> LandingRedirect -> /landing.html
```

- Target root route:

```text
/ -> <LandingPage />
```

- The real landing page will live in React, so app routing, click handlers, smooth scrolling, theme state, and shared components will work normally.