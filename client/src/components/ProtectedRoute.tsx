import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { FullPageLoader } from "./FullPageLoader";
import { SecurityGate } from "./SecurityGate";

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullPageLoader />;

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return (
    <SecurityGate>
      <Outlet />
    </SecurityGate>
  );
}
