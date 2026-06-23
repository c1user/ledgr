import { useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  useLocation,
} from "react-router-dom";
import useAuthStore from "./store/authStore";
import useThemeStore from "./store/themeStore";

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import TransactionsHub from "./pages/TransactionsHub";
import Transactions from "./pages/Transactions";
import Accounting from "./pages/Accounting";
import Accounts from "./pages/Accounts";
import Receipts from "./pages/Receipts";
import Payroll from "./pages/Payroll";
import AiChat from "./pages/AiChat";
import Reports from "./pages/Reports";
import ProfitLoss from "./pages/ProfitLoss";
import TaxSummary from "./pages/TaxSummary";
import Rules from "./pages/Rules";
import Vendors from "./pages/Vendors";
import Clients from "./pages/Clients";
import Invoices from "./pages/Invoices";
import Budget from "./pages/Budget";
import TimeTracking from "./pages/TimeTracking";
import Inventory from "./pages/Inventory";
import BalanceSheet from "./pages/BalanceSheet";
import AccountsReceivable from "./pages/AccountsReceivable";
import Sales from "./pages/Sales";
import Recurring from "./pages/Recurring";
import Hacienda from "./pages/Hacienda";
import BusinessProfile from "./pages/BusinessProfile";
import ProjectsHub from "./pages/ProjectsHub";
import Projects from "./pages/Projects";

// Layout
import AppLayout from "./components/AppLayout";

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

  // Apply theme to document root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

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
            <Route path="recurring" element={<Recurring />} />
            <Route path="rules" element={<Rules />} />
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
          <Route path="payroll" element={<Payroll />} />
          <Route path="ai" element={<AiChat />} />

          {/* Reports hub — P&L, balance sheet, tax summary and Hacienda */}
          <Route path="reports" element={<Reports />}>
            <Route index element={<ProfitLoss />} />
            <Route path="balance-sheet" element={<BalanceSheet />} />
            <Route path="tax-summary" element={<TaxSummary />} />
            <Route path="hacienda" element={<Hacienda />} />
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
          <Route path="chart-of-accounts" element={<Accounting />} />
          <Route path="vendors" element={<Vendors />} />

          {/* Sales hub — clients, invoices and receivables as tab routes */}
          <Route path="sales" element={<Sales />}>
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

          <Route path="budget" element={<Budget />} />

          {/* Projects hub — projects and time tracking (job costing) */}
          <Route path="projects" element={<ProjectsHub />}>
            <Route index element={<Projects />} />
            <Route path="time" element={<TimeTracking />} />
          </Route>
          {/* Legacy redirect for the old top-level route */}
          <Route
            path="time"
            element={<Navigate to="/projects/time" replace />}
          />

          <Route path="inventory" element={<Inventory />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
