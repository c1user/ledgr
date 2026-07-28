import { lazy, Suspense, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import useAuthStore from "./store/authStore";
import useThemeStore from "./store/themeStore";

// Pages — all lazy-loaded so each route ships as its own chunk and heavy
// dependencies (recharts, papaparse) stay out of the entry bundle.
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Join = lazy(() => import("./pages/Join"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const LegalPage = lazy(() => import("./pages/LegalPage"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const Account = lazy(() => import("./pages/Account"));
const Team = lazy(() => import("./pages/Team"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const TransactionsHub = lazy(() => import("./pages/TransactionsHub"));
const Transactions = lazy(() => import("./pages/Transactions"));
const Accounting = lazy(() => import("./pages/Accounting"));
const Accounts = lazy(() => import("./pages/Accounts"));
const Receipts = lazy(() => import("./pages/Receipts"));
const Payroll = lazy(() => import("./pages/Payroll"));
const AiChat = lazy(() => import("./pages/AiChat"));
const Reports = lazy(() => import("./pages/Reports"));
const ProfitLoss = lazy(() => import("./pages/ProfitLoss"));
const CashFlow = lazy(() => import("./pages/CashFlow"));
const TaxSummary = lazy(() => import("./pages/TaxSummary"));
const Rules = lazy(() => import("./pages/Rules"));
const Reconcile = lazy(() => import("./pages/Reconcile"));
const Vendors = lazy(() => import("./pages/Vendors"));
const Clients = lazy(() => import("./pages/Clients"));
const Invoices = lazy(() => import("./pages/Invoices"));
const Budget = lazy(() => import("./pages/Budget"));
const TimeTracking = lazy(() => import("./pages/TimeTracking"));
const Inventory = lazy(() => import("./pages/Inventory"));
const BalanceSheet = lazy(() => import("./pages/BalanceSheet"));
const AccountsReceivable = lazy(() => import("./pages/AccountsReceivable"));
const Sales = lazy(() => import("./pages/Sales"));
const Recurring = lazy(() => import("./pages/Recurring"));
const Hacienda = lazy(() => import("./pages/Hacienda"));
const BusinessProfile = lazy(() => import("./pages/BusinessProfile"));
const Activity = lazy(() => import("./pages/Activity"));
const Plans = lazy(() => import("./pages/Plans"));
const ProjectsHub = lazy(() => import("./pages/ProjectsHub"));
const Projects = lazy(() => import("./pages/Projects"));

// Layout — eager: the shell renders immediately around lazy pages.
import AppLayout from "./components/AppLayout";
import RequireFeature from "./components/RequireFeature";
import FeedbackHost from "./components/FeedbackHost";

// Shown while a route chunk downloads.
const PageFallback = () => (
  <div className="flex items-center justify-center py-24 text-muted">
    <i className="ti ti-loader-2 animate-spin text-2xl" aria-hidden="true" />
  </div>
);

// Protected route wrapper
const ProtectedRoute = ({ children }) => {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
};

// Redirect that preserves the query string, so legacy deep links such as
// /invoices?invoice=<id> survive the move under /sales.
const RedirectWithQuery = ({ to }) => {
  const { search } = useLocation();
  return <Navigate to={`${to}${search}`} replace />;
};

export default function App() {
  const theme = useThemeStore((s) => s.theme);
  const density = useThemeStore((s) => s.density);

  // Apply theme + table density to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.setAttribute(
      "data-density",
      density || "comfortable",
    );
  }, [theme, density]);

  return (
    <BrowserRouter>
      <Suspense fallback={<PageFallback />}>
        <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/join" element={<Join />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/terms" element={<LegalPage doc="terms" />} />
        <Route path="/privacy" element={<LegalPage doc="privacy" />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Protected routes — all wrapped in AppLayout */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />

          {/* Transactions hub — ledger, recurring schedules and rules */}
          <Route path="transactions" element={<TransactionsHub />}>
            <Route index element={<Transactions />} />
            <Route
              path="recurring"
              element={
                <RequireFeature feature="recurring">
                  <Recurring />
                </RequireFeature>
              }
            />
            <Route path="rules" element={<Rules />} />
            <Route
              path="reconcile"
              element={
                <RequireFeature feature="reconciliation">
                  <Reconcile />
                </RequireFeature>
              }
            />
          </Route>
          {/* Legacy redirects for the old top-level routes */}
          <Route
            path="recurring"
            element={<Navigate to="/transactions/recurring" replace />}
          />
          <Route
            path="rules"
            element={<Navigate to="/transactions/rules" replace />}
          />

          <Route
            path="categories"
            element={<Navigate to="/chart-of-accounts" replace />}
          />
          <Route path="accounts" element={<Accounts />} />
          <Route path="receipts" element={<Receipts />} />
          <Route
            path="payroll"
            element={
              <RequireFeature feature="payroll">
                <Payroll />
              </RequireFeature>
            }
          />
          <Route
            path="ai"
            element={
              <RequireFeature feature="ai_chat">
                <AiChat />
              </RequireFeature>
            }
          />

          {/* Reports hub — P&L, balance sheet, tax summary and Hacienda */}
          <Route path="reports" element={<Reports />}>
            <Route index element={<ProfitLoss />} />
            <Route
              path="cash-flow"
              element={
                <RequireFeature feature="advanced_reports">
                  <CashFlow />
                </RequireFeature>
              }
            />
            <Route path="balance-sheet" element={<BalanceSheet />} />
            <Route path="tax-summary" element={<TaxSummary />} />
            <Route
              path="hacienda"
              element={
                <RequireFeature feature="hacienda">
                  <Hacienda />
                </RequireFeature>
              }
            />
          </Route>
          {/* Legacy redirects for the old top-level report routes */}
          <Route
            path="balance-sheet"
            element={<Navigate to="/reports/balance-sheet" replace />}
          />
          <Route
            path="tax-summary"
            element={<Navigate to="/reports/tax-summary" replace />}
          />
          <Route
            path="hacienda"
            element={<Navigate to="/reports/hacienda" replace />}
          />

          <Route path="settings" element={<BusinessProfile />} />
          <Route path="account" element={<Account />} />
          <Route path="plans" element={<Plans />} />
          <Route
            path="team"
            element={
              <RequireFeature feature="multi_user">
                <Team />
              </RequireFeature>
            }
          />
          <Route
            path="activity"
            element={
              <RequireFeature feature="audit_log">
                <Activity />
              </RequireFeature>
            }
          />
          <Route path="chart-of-accounts" element={<Accounting />} />
          <Route
            path="vendors"
            element={
              <RequireFeature feature="vendors">
                <Vendors />
              </RequireFeature>
            }
          />

          {/* Sales hub — clients, invoices and receivables as tab routes */}
          <Route
            path="sales"
            element={
              <RequireFeature feature="invoicing">
                <Sales />
              </RequireFeature>
            }
          >
            <Route index element={<Navigate to="/sales/invoices" replace />} />
            <Route path="clients" element={<Clients />} />
            <Route path="invoices" element={<Invoices />} />
            <Route path="receivables" element={<AccountsReceivable />} />
          </Route>
          {/* Legacy redirects (preserve any ?invoice=/?client= query) */}
          <Route
            path="clients"
            element={<RedirectWithQuery to="/sales/clients" />}
          />
          <Route
            path="invoices"
            element={<RedirectWithQuery to="/sales/invoices" />}
          />
          <Route
            path="accounts-receivable"
            element={<RedirectWithQuery to="/sales/receivables" />}
          />

          <Route
            path="budget"
            element={
              <RequireFeature feature="budgets">
                <Budget />
              </RequireFeature>
            }
          />

          {/* Projects hub — projects and time tracking (job costing) */}
          <Route
            path="projects"
            element={
              <RequireFeature feature="projects">
                <ProjectsHub />
              </RequireFeature>
            }
          >
            <Route index element={<Projects />} />
            <Route path="time" element={<TimeTracking />} />
          </Route>
          {/* Legacy redirect for the old top-level route */}
          <Route
            path="time"
            element={<Navigate to="/projects/time" replace />}
          />

          <Route
            path="inventory"
            element={
              <RequireFeature feature="inventory">
                <Inventory />
              </RequireFeature>
            }
          />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>

      {/* Toasts + confirm dialog (replaces window.alert / window.confirm) */}
      <FeedbackHost />
    </BrowserRouter>
  );
}
