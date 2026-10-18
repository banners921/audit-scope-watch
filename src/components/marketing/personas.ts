import { ShieldCheck, Briefcase, Umbrella, LineChart, type LucideIcon } from "lucide-react";

// Shared by the homepage and pricing page. Security/risk teams lead.
export const PERSONAS: { icon: LucideIcon; title: string; job: string }[] = [
  { icon: ShieldCheck, title: "Security and risk teams", job: "Check a project's audit history and past hacks before you list it, integrate it, or hold its token." },
  { icon: Briefcase, title: "Audit firm sales teams", job: "Find projects shipping new code since their last audit, or switching firms, and reach them first." },
  { icon: Umbrella, title: "Insurance underwriters", job: "Price cover using real audit findings and hack history, not one report from last year." },
  { icon: LineChart, title: "Investors", job: "Add security to your due diligence: who reviewed the code, what they found, and what changed since." },
];
