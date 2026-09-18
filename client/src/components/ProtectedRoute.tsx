import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Logo } from "./Logo";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4">
        <Logo size={44} className="animate-pulse" />
        <div className="h-1 w-28 overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full w-1/3 animate-shimmer rounded-full brand-gradient" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
