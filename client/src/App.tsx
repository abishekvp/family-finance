import { lazy, Suspense, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { RequireFamily } from "./components/RequireFamily";
import { Layout } from "./components/Layout";
import { FullPageLoader } from "./components/FullPageLoader";
import { Landing } from "./pages/Landing";
import { Login } from "./pages/Login";

/**
 * A page whose code is downloaded the first time it's opened. The landing page and sign-in ship with
 * the app shell; everything else — and the charting library only some pages use — arrives on demand,
 * so the first visit downloads a fraction of the app.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

const Register = page(() => import("./pages/Register"), "Register");
const ForgotPassword = page(() => import("./pages/ForgotPassword"), "ForgotPassword");
const Privacy = page(() => import("./pages/Privacy"), "Privacy");
const DeleteAccount = page(() => import("./pages/DeleteAccount"), "DeleteAccount");
const Onboarding = page(() => import("./pages/Onboarding"), "Onboarding");
const AcceptInvite = page(() => import("./pages/AcceptInvite"), "AcceptInvite");
const Dashboard = page(() => import("./pages/Dashboard"), "Dashboard");
const FamilySettings = page(() => import("./pages/FamilySettings"), "FamilySettings");
const Transactions = page(() => import("./pages/Transactions"), "Transactions");
const Stats = page(() => import("./pages/Stats"), "Stats");
const Accounts = page(() => import("./pages/Accounts"), "Accounts");
const Settings = page(() => import("./pages/Settings"), "Settings");
const Account = page(() => import("./pages/Account"), "Account");
const Approvals = page(() => import("./pages/Approvals"), "Approvals");
const GetTheApp = page(() => import("./pages/GetTheApp"), "GetTheApp");
const Lending = page(() => import("./pages/Lending"), "Lending");
const LendingPerson = page(() => import("./pages/LendingPerson"), "LendingPerson");
const Recurring = page(() => import("./pages/Recurring"), "Recurring");
const RecurringForm = page(() => import("./pages/RecurringForm"), "RecurringForm");
const Budgets = page(() => import("./pages/Budgets"), "Budgets");
const Categories = page(() => import("./pages/Categories"), "Categories");
const Goals = page(() => import("./pages/Goals"), "Goals");
const PayeeRules = page(() => import("./pages/PayeeRules"), "PayeeRules");
const Uncategorized = page(() => import("./pages/Uncategorized"), "Uncategorized");

export default function App() {
  return (
    <Suspense fallback={<FullPageLoader />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/delete-account" element={<DeleteAccount />} />

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
              <Route path="/budgets" element={<Budgets />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/goals" element={<Goals />} />
              <Route path="/payee-rules" element={<PayeeRules />} />
              <Route path="/uncategorized" element={<Uncategorized />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
