import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireFamily } from "./components/RequireFamily";
import { Layout } from "./components/Layout";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";
import { Register } from "./pages/Register";
import { Onboarding } from "./pages/Onboarding";
import { AcceptInvite } from "./pages/AcceptInvite";
import { Dashboard } from "./pages/Dashboard";
import { FamilySettings } from "./pages/FamilySettings";
import { Transactions } from "./pages/Transactions";
import { Stats } from "./pages/Stats";
import { Accounts } from "./pages/Accounts";
import { Settings } from "./pages/Settings";
import { GetTheApp } from "./pages/GetTheApp";
import { ForgotPassword } from "./pages/ForgotPassword";
import { Account } from "./pages/Account";
import { Approvals } from "./pages/Approvals";
import { Lending } from "./pages/Lending";
import { LendingPerson } from "./pages/LendingPerson";
import { Recurring } from "./pages/Recurring";
import { RecurringForm } from "./pages/RecurringForm";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />

      <Route element={<ProtectedRoute />}>
        <Route path="/onboarding" element={<Onboarding />} />
        <Route path="/invites/:token" element={<AcceptInvite />} />

        <Route element={<RequireFamily />}>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/account" element={<Account />} />
            <Route path="/family" element={<FamilySettings />} />
            <Route path="/approvals" element={<Approvals />} />
            <Route path="/get-the-app" element={<GetTheApp />} />
            <Route path="/lending" element={<Lending />} />
            <Route path="/lending/:id" element={<LendingPerson />} />
            <Route path="/recurring" element={<Recurring />} />
            <Route path="/recurring/:id" element={<RecurringForm />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
