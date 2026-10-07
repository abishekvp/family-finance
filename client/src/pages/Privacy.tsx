import { Link } from "react-router-dom";
import { PublicPage, SUPPORT_EMAIL } from "../components/PublicPage";

/** The privacy policy (linked from the Play Store listing and inside both apps). */
export function Privacy() {
  return (
    <PublicPage title="Privacy policy" updated="7 October 2026">
      <p>
        Family Finance helps a household keep track of its money together: shared family accounts alongside personal ones, budgets,
        lending and borrowing, and the transactions between them. This policy explains what the website and the Android app collect,
        why, and the choices you have.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          <strong>Your account:</strong> your name, email address and a hashed password. If you sign in with Google or Microsoft, we
          receive your name and email address from them. Passkeys store only a public key with us.
        </li>
        <li>
          <strong>What you record:</strong> accounts and their balances, transactions (amount, date and time, payee, notes,
          category), budgets, goals, repeating payments, payee rules, and the names of people you lend to or borrow from.
        </li>
        <li>
          <strong>Bank SMS (Android app, only if you turn it on):</strong> the app reads the SMS messages on your phone to find bank,
          card and UPI transaction alerts. From each alert it keeps the amount, payee, date and time, the sender (such as your bank)
          and the card or account&apos;s last digits, and records them as a transaction. The message text itself is never stored or
          uploaded, and one-time passwords, personal messages and promotions are skipped. You can turn this off at any time in the app.
        </li>
        <li>
          <strong>On your device:</strong> the app keeps your sign-in token in the phone&apos;s secure storage and a copy of your
          transactions so it works offline. We don&apos;t use advertising identifiers, analytics or tracking, and we don&apos;t access
          your location or contacts.
        </li>
      </ul>

      <h2>How we use it</h2>
      <p>
        Only to provide the service: to store your records, keep them in sync across your devices, show them to the members of your
        family according to your settings, and send the emails you ask for (sign-in codes and family invites).
      </p>

      <h2>Who can see it</h2>
      <ul>
        <li>
          <strong>Your family:</strong> family accounts, and everything recorded on them, are visible to the members of your family.
          Personal accounts, budgets and people are visible only to you.
        </li>
        <li>
          <strong>Service providers</strong> that run the service for us: Vercel (hosting and app downloads), Prisma (the database),
          Google and Microsoft (only if you sign in with them), and an email provider for codes and invites.
        </li>
        <li>We do not sell your data or share it with advertisers.</li>
      </ul>

      <h2>Security</h2>
      <p>
        Everything travels over HTTPS, and passwords are stored only as salted hashes. Your family can also turn on end-to-end
        encryption with a master password, which encrypts payees and notes on your device so that even we cannot read them.
      </p>

      <h2>Keeping and deleting your data</h2>
      <p>
        We keep your data for as long as your account exists. Transactions you delete stay in the bin for 30 days, then are removed for
        good. You can delete your account at any time from the app (More → Account &amp; security → Delete account) or on the web at{" "}
        <Link to="/delete-account" className="font-semibold text-brand-600 hover:underline">
          Delete your account
        </Link>
        . Deleting it immediately and permanently removes your sign-in, your personal accounts and budgets, and everything recorded on
        them. A family where you are the only member is deleted with you; in a family you share, what is on family accounts stays with
        the family.
      </p>

      <h2>Children</h2>
      <p>Family Finance is meant for adults managing their household&apos;s money and isn&apos;t directed at children under 13.</p>

      <h2>Changes</h2>
      <p>If this policy changes, we&apos;ll update this page and its date.</p>

      <h2>Contact</h2>
      <p>
        {SUPPORT_EMAIL ? (
          <>
            Questions or requests about your data:{" "}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold text-brand-600 hover:underline">
              {SUPPORT_EMAIL}
            </a>
            .
          </>
        ) : (
          "Questions or requests about your data: use the contact email on our Google Play listing."
        )}
      </p>
    </PublicPage>
  );
}
