import type { Metadata } from "next";
import { Section } from "../_components/section";
import { LegalCrossLinks } from "../_components/legal-document";
import { MARKETING_ROUTES } from "@/lib/marketing/routes";
import { pageMetadata } from "@/lib/marketing/site";
import { ManageCookiePreferencesButton } from "@/components/consent/manage-cookie-preferences-button";

export const metadata: Metadata = pageMetadata({
  title: "Cookie Policy",
  description:
    "What cookies, local storage, and analytics TarragonHealth uses, why, and how to control them.",
  path: MARKETING_ROUTES.cookies,
});

const LAST_UPDATED = "30 July 2026";

export default function CookiesPage() {
  return (
    <Section className="pt-20">
      <article className="mx-auto max-w-2xl">
        <p className="text-xs font-medium uppercase tracking-wide text-deep-forest">Legal</p>
        <h1 className="mt-2 font-heading text-3xl font-bold leading-tight text-charcoal-ink sm:text-4xl">
          Cookie Policy
        </h1>
        <p className="mt-4 text-xs text-charcoal-ink/65">Last updated {LAST_UPDATED}</p>

        <div className="mt-10 space-y-8">
          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              The short version
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              We use one required cookie to keep you securely signed in, plus an anonymous,
              first-party analytics beacon so our team can see which pages help people find care.
              We don&apos;t run advertising cookies, third-party trackers, ad pixels, or session
              recording of any kind, anywhere on TarragonHealth. The banner you see on your first
              visit to our public site is how you tell us to turn the analytics part off, and you
              can change your answer at any time below.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Essential: keeping you signed in
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              When you sign in, our authentication provider (Supabase) sets a small number of
              first-party, strictly necessary cookies to keep your session active and secure,
              for example so you don&apos;t have to log in again on every page. These cookies:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 leading-relaxed text-charcoal-ink/80">
              <li>are set only once you sign in (or start signing up), not while you&apos;re
                browsing the public marketing site anonymously;</li>
              <li>are used only to identify your logged-in session, never for advertising or
                tracking you across other websites;</li>
              <li>expire automatically, or when you sign out; and</li>
              <li>are required for the app to work, so if you block them, you won&apos;t be able
                to stay signed in. They&apos;re never gated by the cookie banner below.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Anonymous analytics: on by default, easy to turn off
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              By default, your browser stores a random, anonymous identifier (not a cookie, just
              browser local storage) and sends us, on each page you visit: the page path, which
              site referred you, any campaign tags in the link you followed, your approximate
              country/region/city (derived from network routing, never your exact location or IP
              address), and your device type (mobile, tablet, desktop). If you&apos;re signed in,
              it&apos;s linked to your account so our team can see overall engagement, like how
              many people are actively using TarragonHealth week to week, never to build an
              advertising profile of you. Because this is ordinary first-party product analytics
              and not third-party tracking, it also runs while you&apos;re signed in to the app
              itself, without repeating the banner on every page.
            </p>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              This data stays inside TarragonHealth, for our own product and clinical-operations
              team. We never sell it, share it with advertisers, or hand it to a third-party
              analytics or ad network, because there isn&apos;t one plugged in. If your browser
              sends a &quot;Do Not Track&quot; signal, we record nothing at all, immediately,
              regardless of anything else. Choosing &quot;Reject Non-Essential&quot; on the banner
              (or the button below) turns it off just as immediately: no identifier is created
              from that point on, and no further data leaves your browser.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              If you install the app to your home screen
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              TarragonHealth can be installed as an app on your phone. To make that possible, your
              browser stores one small, branded offline page locally so that if you open the app
              with no internet connection, you see a clear &quot;you&apos;re offline&quot; screen
              instead of a browser error. That local cache never stores your vitals, medications,
              messages, or any other clinical or personal data. Every real page you view is
              always fetched fresh from our servers over your live session.
            </p>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Controlling cookies and analytics
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              Most browsers let you view, block, or delete cookies in their settings. Because the
              cookie we use is strictly necessary for signing in, blocking or deleting it will
              sign you out and may prevent you from using the patient, clinician, or partner
              areas of TarragonHealth. Browsing the public marketing pages doesn&apos;t require
              any cookie at all. You can change your analytics choice anytime here:
            </p>
            <div className="mt-4">
              <ManageCookiePreferencesButton />
            </div>
          </section>

          <section>
            <h2 className="font-heading text-xl font-semibold text-charcoal-ink">
              Changes to this policy
            </h2>
            <p className="mt-3 leading-relaxed text-charcoal-ink/80">
              If we ever introduce a third-party analytics tool, advertising, or anything beyond
              what&apos;s described above, we&apos;ll update this page and the banner first, and
              for anything non-essential we&apos;ll ask for your permission rather than assume it.
              Questions:{" "}
              <a href="mailto:legal@tarragonhealth.ng" className="underline">
                legal@tarragonhealth.ng
              </a>
              .
            </p>
          </section>
        </div>

        <LegalCrossLinks current="cookies" />
      </article>
    </Section>
  );
}
