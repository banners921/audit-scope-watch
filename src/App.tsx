import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Dashboard from "./pages/Dashboard";
import Funds from "./pages/Funds";
import FundDetail from "./pages/FundDetail";
import Alerts from "./pages/Alerts";
import Profile from "./pages/Profile";
import SavedTargets from "./pages/SavedTargets";
import Reminders from "./pages/Reminders";
import AuditorDetail from "./pages/AuditorDetail";
import FundingRounds from "./pages/FundingRounds";
import UnusualActivity from "./pages/UnusualActivity";
import Reports from "./pages/Reports";
import ProtocolDossier from "./pages/ProtocolDossier";
import WatchedFunds from "./pages/WatchedFunds";
import MorningBrief from "./pages/MorningBrief";
import OpenFindings from "./pages/OpenFindings";
import Compare from "./pages/Compare";
import PortfolioAnalytics from "./pages/PortfolioAnalytics";
import LPReport from "./pages/LPReport";
import FundReports from "./pages/FundReports";
import Stover from "./pages/Stover";
import NotFound from "./pages/NotFound.tsx";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Docs from "./pages/Docs";
import Account from "./pages/Account";
import HomeRedirect from "./pages/HomeRedirect";
import Onboarding from "./pages/Onboarding";
import Watchlist from "./pages/Watchlist";
import CompaniesBrowse from "./pages/CompaniesBrowse";
import FundsBrowse from "./pages/FundsBrowse";
import FundingRoundsBrowse from "./pages/FundingRoundsBrowse";
import AuditsBrowse from "./pages/AuditsBrowse";
import AuditorsBrowse from "./pages/AuditorsBrowse";
import Companies from "./pages/Companies";
import BookSecurity from "./pages/BookSecurity";
import BookNews from "./pages/BookNews";
import BookGrowth from "./pages/BookGrowth";
import BookCalendar from "./pages/BookCalendar";
import FundAnalytics from "./pages/FundAnalytics";
import Monitor from "./pages/Monitor";
import FundsIntel from "./pages/FundsIntel";
import AuditedRepos from "./pages/AuditedRepos";
import BugBounties from "./pages/BugBounties";
import SmartContracts from "./pages/SmartContracts";
import AuditReports from "./pages/AuditReports";

const queryClient = new QueryClient();

function LegacyProtocolRedirect() {
  const { slug } = useParams<{ slug: string }>();
  return <Navigate to={slug ? `/protocol/${slug}` : "/companies"} replace />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner theme="dark" position="top-right" />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/"
              element={<Landing />}
            />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/account" element={<ProtectedRoute><Account /></ProtectedRoute>} />
            <Route path="/home" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
            {/* Companies + auditors browse pages */}
            <Route path="/companies" element={<ProtectedRoute><CompaniesBrowse /></ProtectedRoute>} />
            <Route path="/audit-firms" element={<ProtectedRoute><AuditsBrowse /></ProtectedRoute>} />
            <Route path="/auditors" element={<Navigate to="/audit-firms?view=firms" replace />} />
            <Route path="/funding-rounds" element={<ProtectedRoute><FundingRoundsBrowse /></ProtectedRoute>} />
            <Route path="/companies-legacy" element={<ProtectedRoute><Companies forceTab="companies" /></ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute><FundAnalytics /></ProtectedRoute>} />
            <Route path="/monitor" element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
            <Route path="/funds-intel" element={<ProtectedRoute><FundsIntel /></ProtectedRoute>} />
            <Route path="/audited-repos" element={<ProtectedRoute><AuditedRepos /></ProtectedRoute>} />
            <Route path="/bug-bounties" element={<ProtectedRoute><BugBounties /></ProtectedRoute>} />
            <Route path="/smart-contracts" element={<ProtectedRoute><SmartContracts /></ProtectedRoute>} />
            <Route path="/audit-reports" element={<ProtectedRoute><AuditReports /></ProtectedRoute>} />
            <Route path="/research" element={<Navigate to="/companies" replace />} />
            <Route path="/protocols" element={<Navigate to="/companies" replace />} />
            {/* Legacy detail pages → unified dossier */}
            <Route path="/protocols/:slug" element={<ProtectedRoute><LegacyProtocolRedirect /></ProtectedRoute>} />
            <Route path="/companies/:slug" element={<ProtectedRoute><LegacyProtocolRedirect /></ProtectedRoute>} />
            <Route path="/saved" element={<ProtectedRoute><SavedTargets /></ProtectedRoute>} />
            <Route path="/reminders" element={<ProtectedRoute><Reminders /></ProtectedRoute>} />
            <Route path="/auditors/:firm" element={<ProtectedRoute><AuditorDetail /></ProtectedRoute>} />
            <Route path="/funding-rounds/legacy" element={<ProtectedRoute><FundingRounds /></ProtectedRoute>} />
            <Route path="/funds" element={<ProtectedRoute><FundsBrowse /></ProtectedRoute>} />
            <Route path="/funds-legacy" element={<ProtectedRoute><Funds /></ProtectedRoute>} />
            <Route path="/funds/:slug" element={<ProtectedRoute><FundDetail /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute><Alerts /></ProtectedRoute>} />
            <Route path="/unusual-activity" element={<ProtectedRoute><UnusualActivity /></ProtectedRoute>} />
            <Route path="/reports" element={<ProtectedRoute><FundReports /></ProtectedRoute>} />
            <Route path="/reports/custom" element={<ProtectedRoute><Reports /></ProtectedRoute>} />
            <Route path="/protocol/:slug" element={<ProtectedRoute><ProtocolDossier /></ProtectedRoute>} />
            {/* Sales-mode surfaces retired — redirect to dashboard */}
            <Route path="/prospects" element={<Navigate to="/dashboard" replace />} />
            <Route path="/teams" element={<Navigate to="/dashboard" replace />} />
            <Route path="/generate-targets" element={<Navigate to="/dashboard" replace />} />
            <Route path="/auditor-intel" element={<Navigate to="/audit-firms" replace />} />
            <Route path="/risk" element={<Navigate to="/dashboard" replace />} />
            <Route path="/watched-funds" element={<ProtectedRoute><WatchedFunds /></ProtectedRoute>} />
            <Route path="/brief" element={<ProtectedRoute><MorningBrief /></ProtectedRoute>} />
            <Route path="/book" element={<Navigate to="/book/security" replace />} />
            <Route path="/book/security" element={<ProtectedRoute><BookSecurity /></ProtectedRoute>} />
            <Route path="/book/news" element={<ProtectedRoute><BookNews /></ProtectedRoute>} />
            <Route path="/book/growth" element={<ProtectedRoute><BookGrowth /></ProtectedRoute>} />
            <Route path="/book/calendar" element={<ProtectedRoute><BookCalendar /></ProtectedRoute>} />
            <Route path="/findings" element={<ProtectedRoute><OpenFindings /></ProtectedRoute>} />
            <Route path="/compare" element={<ProtectedRoute><Compare /></ProtectedRoute>} />
            <Route path="/portfolio-analytics" element={<ProtectedRoute><PortfolioAnalytics /></ProtectedRoute>} />
            <Route path="/lp-report" element={<ProtectedRoute><LPReport /></ProtectedRoute>} />
            <Route path="/fund-reports" element={<ProtectedRoute><FundReports /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
            <Route path="/stover" element={<ProtectedRoute><Stover /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
