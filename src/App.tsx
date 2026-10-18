import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import NotFound from "./pages/NotFound.tsx";
import Landing from "./pages/Landing";
import Pricing from "./pages/Pricing";
import Docs from "./pages/Docs";

// Marketing and auth pages load eagerly; the signed-in app loads per route so
// the homepage doesn't download every dashboard page.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Funds = lazy(() => import("./pages/Funds"));
const FundDetail = lazy(() => import("./pages/FundDetail"));
const Alerts = lazy(() => import("./pages/Alerts"));
const Profile = lazy(() => import("./pages/Profile"));
const SavedTargets = lazy(() => import("./pages/SavedTargets"));
const Reminders = lazy(() => import("./pages/Reminders"));
const AuditorDetail = lazy(() => import("./pages/AuditorDetail"));
const FundingRounds = lazy(() => import("./pages/FundingRounds"));
const UnusualActivity = lazy(() => import("./pages/UnusualActivity"));
const Reports = lazy(() => import("./pages/Reports"));
const ProtocolDossier = lazy(() => import("./pages/ProtocolDossier"));
const WatchedFunds = lazy(() => import("./pages/WatchedFunds"));
const MorningBrief = lazy(() => import("./pages/MorningBrief"));
const OpenFindings = lazy(() => import("./pages/OpenFindings"));
const Compare = lazy(() => import("./pages/Compare"));
const PortfolioAnalytics = lazy(() => import("./pages/PortfolioAnalytics"));
const LPReport = lazy(() => import("./pages/LPReport"));
const FundReports = lazy(() => import("./pages/FundReports"));
const Stover = lazy(() => import("./pages/Stover"));
const Account = lazy(() => import("./pages/Account"));
const HomeRedirect = lazy(() => import("./pages/HomeRedirect"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Watchlist = lazy(() => import("./pages/Watchlist"));
const CompaniesBrowse = lazy(() => import("./pages/CompaniesBrowse"));
const FundsBrowse = lazy(() => import("./pages/FundsBrowse"));
const SecurityInvestors = lazy(() => import("./pages/SecurityInvestors"));
const AuditDetail = lazy(() => import("./pages/AuditDetail"));
const FundingRoundsBrowse = lazy(() => import("./pages/FundingRoundsBrowse"));
const AuditsBrowse = lazy(() => import("./pages/AuditsBrowse"));
const AuditorsBrowse = lazy(() => import("./pages/AuditorsBrowse"));
const Companies = lazy(() => import("./pages/Companies"));
const BookSecurity = lazy(() => import("./pages/BookSecurity"));
const BookNews = lazy(() => import("./pages/BookNews"));
const BookGrowth = lazy(() => import("./pages/BookGrowth"));
const BookCalendar = lazy(() => import("./pages/BookCalendar"));
const FundAnalytics = lazy(() => import("./pages/FundAnalytics"));
const Monitor = lazy(() => import("./pages/Monitor"));
const FundsIntel = lazy(() => import("./pages/FundsIntel"));
const AuditedRepos = lazy(() => import("./pages/AuditedRepos"));
const BugBounties = lazy(() => import("./pages/BugBounties"));
const SmartContracts = lazy(() => import("./pages/SmartContracts"));
const AuditReports = lazy(() => import("./pages/AuditReports"));
const Admin = lazy(() => import("./pages/Admin"));
const Radar = lazy(() => import("./pages/Radar"));

const queryClient = new QueryClient();

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Loading…</div>
    </div>
  );
}

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
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route
              path="/"
              element={<Landing />}
            />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/docs" element={<Docs />} />
            <Route path="/account" element={<ProtectedRoute allowUnpaid><Account /></ProtectedRoute>} />
            <Route path="/home" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
            <Route path="/onboarding" element={<ProtectedRoute allowUnpaid><Onboarding /></ProtectedRoute>} />
            <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
            {/* Companies + auditors browse pages */}
            <Route path="/companies" element={<ProtectedRoute><CompaniesBrowse /></ProtectedRoute>} />
            <Route path="/audit-firms" element={<ProtectedRoute><AuditsBrowse /></ProtectedRoute>} />
            <Route path="/auditors" element={<ProtectedRoute><AuditorsBrowse /></ProtectedRoute>} />
            <Route path="/funding-rounds" element={<ProtectedRoute><FundingRoundsBrowse /></ProtectedRoute>} />
            <Route path="/companies-legacy" element={<ProtectedRoute><Companies forceTab="companies" /></ProtectedRoute>} />
            <Route path="/analytics" element={<ProtectedRoute><FundAnalytics /></ProtectedRoute>} />
            <Route path="/monitor" element={<ProtectedRoute><Monitor /></ProtectedRoute>} />
            <Route path="/funds-intel" element={<ProtectedRoute><FundsIntel /></ProtectedRoute>} />
            <Route path="/audited-repos" element={<ProtectedRoute><AuditedRepos /></ProtectedRoute>} />
            <Route path="/bug-bounties" element={<ProtectedRoute><BugBounties /></ProtectedRoute>} />
            <Route path="/smart-contracts" element={<ProtectedRoute><SmartContracts /></ProtectedRoute>} />
            <Route path="/audit-reports" element={<ProtectedRoute><AuditReports /></ProtectedRoute>} />
            <Route path="/audits/:id" element={<ProtectedRoute><AuditDetail /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
            <Route path="/radar" element={<ProtectedRoute><Radar /></ProtectedRoute>} />
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
            <Route path="/security-investors" element={<ProtectedRoute><SecurityInvestors /></ProtectedRoute>} />
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
            <Route path="/profile" element={<ProtectedRoute allowUnpaid><Profile /></ProtectedRoute>} />
            <Route path="/stover" element={<ProtectedRoute><Stover /></ProtectedRoute>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
