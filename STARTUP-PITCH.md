# CortexWeb Startup Pitch

## One-line pitch

CortexWeb helps independent businesses launch an editable website and collect customer inquiries from the same simple workspace.

## Problem hypothesis

Early-stage founders, creators, and small local businesses often need a credible website before they have the time or budget to coordinate design, development, hosting, and lead tracking. Existing choices can force a tradeoff between a flexible custom build and a quick but fragmented tool setup. This is a hypothesis to validate with interviews, not a measured market finding.

## Initial customer

Start with two reachable groups: student founders and creators who need a launch page, and nearby small businesses that need a basic multi-page presence and a reliable way to receive inquiries. The first customer should have a clear site goal and be comfortable piloting an early product.

## Proposed value

- Start with a brief and a relevant multi-page template instead of a blank canvas.
- Edit sections visually without writing code.
- Publish the site and collect contact form submissions in a searchable inbox.
- Keep project status and recent activity visible in one workspace.

The differentiator to test is the connected workflow from building to publishing to handling inquiries, not a claim that the editor has more features than established website platforms.

## Business model hypothesis

Test a free pilot for one published site, then interview users about a paid tier for multiple sites, custom domains, team access, and managed hosting. Pricing should be set only after observing willingness to pay; this prototype does not process payments or provide managed hosting.

## Validation plan

1. Interview 10 potential users about how they currently create and maintain a website, including time, cost, and how they handle inquiries.
2. Run 5 guided pilots with a real site goal and capture the starting point, time to first publish, and any points where a person needs help.
3. Ask each pilot to publish a site and submit a test inquiry. Confirm that the owner can find and respond to the lead.
4. Record completion, abandonment, support time, and repeat usage. Treat these as observations, not testimonials unless the user explicitly approves a quote.
5. Decide whether to improve onboarding, form handling, design control, or hosting based on repeated evidence.

## Live demo path

1. Create an account and a first website project.
2. Select a multi-page template and adjust a headline or section.
3. Add a contact form and publish the site.
4. Open the public `/site/{slug}` route and send a test inquiry.
5. Return to the workspace, open Leads, and show the captured name, email, message, and website.

## Current implementation

The prototype includes a vanilla JavaScript interface, a Node.js 24 HTTP server, MySQL persistence for accounts/projects/submissions, server-side password hashing, CSRF checks, publish routes, and an owner-scoped Leads inbox. Database integration records are explicitly demos. The editor still has browser-local state in parts of the workflow.

## Before a public launch

Add automated end-to-end tests, session expiration and a persistent session store, configurable secrets and HTTPS, request rate limits and spam controls, privacy/terms documentation, database backups, accessible keyboard behavior, real media storage, and a production hosting/deployment pipeline. Do not present planned AI generation, custom domains, payments, or live third-party database connections as existing features.

## 60-second presentation

“Small businesses and early founders need a website, but getting from an idea to a useful site often means stitching together design, publishing, and separate ways to handle customer inquiries. CortexWeb is exploring a simpler workflow: start from an editable multi-page template, publish the site, and receive contact form messages in the same workspace. Our prototype already demonstrates that loop, including a searchable leads inbox. We are beginning with student founders, creators, and local businesses because we can reach them directly. Our next step is not to claim product-market fit; it is to run five guided pilots, measure whether people can publish and handle a real inquiry, and use those findings to decide what to build next.”