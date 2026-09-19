# maajabusafaris.com — landing page

A single self-contained `index.html`. No build step, no dependencies, no JavaScript
framework. Everything (CSS, illustrations) is inline, so the whole site is one file
you can upload anywhere.

## What you need to replace

Every placeholder is wrapped in square brackets so you can find them quickly.
Search the file for `[` and work through the list:

No placeholders remain. Every bracket has been replaced with client-supplied detail:
itineraries and prices, response time, enquiries address, phone, office address,
years operating, tour operator licence and company registration.

The trust strip also carries the line "Private guide on every departure", and the
four "why travel with us" paragraphs are my draft wording based on what you have
described. Read them and correct anything that is not accurate about how you
actually operate — they are claims made in your name, so they need to be true.

Nothing in the page claims a fact about the business that has not been left as a
placeholder — no invented licence numbers, no invented testimonials, no invented
prices. Fill them in with your own details before the site goes public.

## Photography

The hero and card artwork are hand-drawn SVG illustrations, drawn for this page.
They are there so the layout works before you have photography. When you have your
own safari photos, they will look considerably better — swap the `<svg>` block inside
`.hero-scene` for an `<img>` and do the same for each `.card-art`.

Do not use stock photos you have not licensed.

## Hosting

The domain currently has no A record, so it needs somewhere to point. Cheapest
reliable options, all free at this size:

**Cloudflare Pages or Netlify** — drag the folder onto their dashboard, then in
Namecheap set the host records they give you. Gives you HTTPS automatically.

**Namecheap shared hosting** — if you already pay for it, upload `index.html` to
`public_html/` and add an A record pointing at the hosting IP.

Either way you also want `www` to work: add a CNAME record with host `www` pointing
at the apex domain (or at the Pages/Netlify hostname).

## The enquiry form

The form is built but deliberately not wired to a backend yet — submitting it shows
a notice rather than silently failing. It needs an endpoint once SES is live.

Two options once the domain is authenticated:

1. **Netlify Forms** — add `netlify` to the `<form>` tag. Zero code, but the
   notification email comes from Netlify, not your domain.
2. **SES via a small function** (recommended) — a Lambda or Cloudflare Worker that
   takes the POST and calls SES to send you the enquiry, plus an auto-acknowledgement
   to the traveller. This is the genuine transactional use case, sends from your own
   authenticated domain, and is a concrete, demonstrable reason for the SES
   production access request.

Option 2 is worth doing in that order: authenticate the domain first, get the form
live, then request production access with a working enquiry flow to point at.
