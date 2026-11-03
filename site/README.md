# CN Capital — marketing website development

This directory is an **independent public-facing website prototype**. It is not the customer platform and does not use Lovable.

## Brand and architecture
- Brand: CN Capital, confirmed from the existing authenticated web terminal.
- Logo: `brand.png` is the exact existing `web/cn-capital.png` Git blob copied without image alteration.
- Stack: static HTML/CSS/vanilla JS. No paid template, framework, Google Font, CDN, build-time API, or backend access.
- Styling: charcoal, slate, bronze/gold and muted blue, related to the platform's customer login design.
- Marketing pages: `index.html`, `platform.html`, `company.html`, `contact.html`, `legal.html`.

## Motion & interface
CSS 3D-inspired orbital animation, animated ambient gradients, CSS signal and marquee, pointer-responsive orbital perspective, scroll reveal, and four-category **illustrative** SVG chart selector. Reduced-motion settings disable decorative motion.
All imagery / chart lines in the marketing site are designed artifacts, not live quotes or actual financial results.

## Verification
Run `node check.mjs` for static integrity, disclaimers, navigation and brand references.
Inspect on 375, 768, 1440 desktop/mobile breakpoints. Ensure menu, market tabs and anchor links work.
Deploy as a separate **preview environment** before any production or domain binding.

## Release blockers
- Review and approval of official legal entity, financial regulatory statements and geographic availability.
- Accurate operator contact details and approved privacy policy/terms; no placeholder identities may be published as facts.
- Any client login external link must first point to a verified production host, not QA or mock.
- Live testing for cross-browser accessibility, responsive layout and performance.
- Explicit owner permission before promotion to a production domain.

Do not merge this website branch into the platform production branch just to preview it.
