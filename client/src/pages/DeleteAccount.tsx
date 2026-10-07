import { Link, useLocation } from "react-router-dom";
import { LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui";
import { FullPageLoader } from "../components/FullPageLoader";
import { PublicPage, SUPPORT_EMAIL } from "../components/PublicPage";
import { DeleteAccountCard } from "./Account";

/**
 * Deleting an account from the web, without the app — Google Play asks every app with accounts for a
 * page like this. Signed in, it deletes right here; otherwise it explains the steps and signs you in.
 */
export function DeleteAccount() {
  const { user, isLoading } = useAuth();
  const location = useLocation();
  if (isLoading) return <FullPageLoader />;

  return (
    <PublicPage title="Delete your Family Finance account">
      <p>
        Deleting your account permanently removes your sign-in, your personal accounts, personal budgets and goals, the people you
        track privately, and every transaction recorded on them. It takes effect immediately and can&apos;t be undone.
      </p>
      <ul>
        <li>A family where you are the only member is deleted with you, including everything in it.</li>
        <li>
          In a family you share with others, what&apos;s on family accounts stays with the family, and the longest-standing member
          becomes admin if no other admin is left.
        </li>
        <li>Nothing is kept afterwards, apart from what your family still shares.</li>
      </ul>

      {user ? (
        <div className="pt-2 text-left">
          <DeleteAccountCard />
        </div>
      ) : (
        <div className="space-y-3 pt-2">
          <p>
            <strong>To delete your account,</strong> sign in, then confirm with your password (or, if you sign in with Google,
            Microsoft or a passkey, by typing your email address). In the Android app it&apos;s under More → Account &amp; security →
            Delete account.
          </p>
          <Link to="/login" state={{ from: location }}>
            <Button icon={<LogIn size={16} />}>Sign in to delete your account</Button>
          </Link>
          {SUPPORT_EMAIL && (
            <p className="text-xs">
              Can&apos;t sign in any more? Email{" "}
              <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`} className="font-semibold text-brand-600 hover:underline">
                {SUPPORT_EMAIL}
              </a>{" "}
              from the address on your account and we&apos;ll delete it for you.
            </p>
          )}
        </div>
      )}
    </PublicPage>
  );
}
