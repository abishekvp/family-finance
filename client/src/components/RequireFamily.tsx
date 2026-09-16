import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function RequireFamily() {
  const { user } = useAuth();

  if (!user) return null;
  if (user.families.length === 0) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
