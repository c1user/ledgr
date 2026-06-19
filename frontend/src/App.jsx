import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import useAuthStore from "./store/authStore";
import useThemeStore from "./store/themeStore";

// Pages
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Categories from "./pages/Categories";
import Accounts from "./pages/Accounts";
import Receipts from "./pages/Receipts";
import Payroll from "./pages/Payroll";
import AiChat from "./pages/AiChat";
import ProfitLoss from "./pages/ProfitLoss";
import TaxSummary from "./pages/TaxSummary";
import ChartOfAccounts from "./pages/ChartOfAccounts";
import Rules from "./pages/Rules";
import Vendors from "./pages/Vendors";
import Budget from "./pages/Budget";
import TimeTracking from "./pages/TimeTracking";
import Inventory from "./pages/Inventory";

// Layout
import AppLayout from "./components/AppLayout";

// Protected route wrapper
const ProtectedRoute = ({ children }) => {
  const token = useAuthStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return children;
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
          <Route path="transactions" element={<Transactions />} />
          <Route path="categories" element={<Categories />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="receipts" element={<Receipts />} />
          <Route path="payroll" element={<Payroll />} />
          <Route path="ai" element={<AiChat />} />
          <Route path="reports" element={<ProfitLoss />} />
          <Route path="tax-summary" element={<TaxSummary />} />
          <Route path="chart-of-accounts" element={<ChartOfAccounts />} />
          <Route path="rules" element={<Rules />} />
          <Route path="vendors" element={<Vendors />} />
          <Route path="budget" element={<Budget />} />
          <Route path="time" element={<TimeTracking />} />
          <Route path="inventory" element={<Inventory />} />
        </Route>

        {/* Catch all */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
