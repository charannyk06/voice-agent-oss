"use client";

import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatCents, formatDuration } from "@/lib/utils";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Phone,
  Clock,
  AlertTriangle,
  Settings,
  Zap,
  Loader2,
} from "lucide-react";

interface CostSummary {
  monthSpendCents: number;
  monthMinutes: number;
  entryCount: number;
  budgetMonthlyCents: number | null;
  budgetDailyAlertCents: number | null;
}

interface DailyBreakdown {
  date: string;
  amountCents: number;
  minutes: number;
  entries: number;
}

interface ProviderCost {
  provider: string;
  amountCents: number;
  minutes: number;
  entries: number;
}

export default function CostsPage() {
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [dailyBreakdown, setDailyBreakdown] = useState<DailyBreakdown[]>([]);
  const [providerCosts, setProviderCosts] = useState<ProviderCost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCosts = async () => {
      try {
        const res = await fetch("/api/costs");
        if (!res.ok) throw new Error("Failed to fetch costs");
        const data = await res.json();
        setSummary(data.summary || {
          monthSpendCents: 0,
          monthMinutes: 0,
          entryCount: 0,
          budgetMonthlyCents: null,
          budgetDailyAlertCents: null,
        });
        setDailyBreakdown(Array.isArray(data.dailyBreakdown) ? data.dailyBreakdown : []);
        setProviderCosts(Array.isArray(data.providerCosts) ? data.providerCosts : []);
      } catch (err) {
        console.error("Error fetching costs:", err);
      }
      setLoading(false);
    };
    fetchCosts();
  }, []);

  if (loading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  const monthSpend = summary?.monthSpendCents || 0;
  const monthBudget = summary?.budgetMonthlyCents || 0;
  const totalMinutes = summary?.monthMinutes || 0;
  const callsThisMonth = summary?.entryCount || 0;
  const avgCostPerCall = callsThisMonth > 0 ? monthSpend / callsThisMonth : 0;
  const dailyAverage = dailyBreakdown.length > 0 
    ? dailyBreakdown.reduce((sum, d) => sum + d.amountCents, 0) / dailyBreakdown.length 
    : 0;
  
  // Calculate projected month end based on current spending and day of month
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedMonthEnd = dayOfMonth > 0 ? (monthSpend / dayOfMonth) * daysInMonth : 0;

  const budgetPercent = monthBudget > 0 ? Math.round((monthSpend / monthBudget) * 100) : 0;
  const maxDaily = dailyBreakdown.length > 0 
    ? Math.max(...dailyBreakdown.map((d) => d.amountCents), 1) 
    : 1;

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Costs</h1>
            <p className="text-sm text-muted-foreground">Track spending and budget</p>
          </div>
          <Button variant="outline" className="w-full sm:w-auto">
            <Settings className="mr-2 h-4 w-4" />
            Budget Settings
          </Button>
        </div>

        {/* Budget warning if close */}
        {budgetPercent > 70 && (
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-warning shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-medium">{budgetPercent}% of monthly budget used</p>
              <p className="text-xs text-muted-foreground">
                At current pace, projected to spend {formatCents(projectedMonthEnd)} this month
              </p>
            </div>
          </div>
        )}

        {/* Top metrics */}
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{formatCents(monthSpend)}</span>
              </div>
              <p className="mt-2 text-sm font-medium">Month Spend</p>
              <div className="mt-1">
                <div className="h-1.5 w-full rounded-full bg-muted">
                  <div
                    className={cn(
                      "h-1.5 rounded-full transition-all",
                      budgetPercent > 80 ? "bg-destructive" : budgetPercent > 50 ? "bg-warning" : "bg-success"
                    )}
                    style={{ width: `${Math.min(budgetPercent, 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">{budgetPercent}% of {formatCents(monthBudget)} budget</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Phone className="h-5 w-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{callsThisMonth}</span>
              </div>
              <p className="mt-2 text-sm font-medium">Calls This Month</p>
              <p className="text-[11px] text-muted-foreground">{formatCents(avgCostPerCall)} avg per call</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <span className="text-2xl font-bold">{formatDuration(totalMinutes * 60)}</span>
              </div>
              <p className="mt-2 text-sm font-medium">Total Talk Time</p>
              <p className="text-[11px] text-muted-foreground">{totalMinutes > 0 ? formatCents((monthSpend / totalMinutes) * 100) + " per min" : "-"}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <TrendingUp className="h-5 w-5 text-success" />
                <span className="text-2xl font-bold">{formatCents(projectedMonthEnd)}</span>
              </div>
              <p className="mt-2 text-sm font-medium">Projected Month End</p>
              <p className="text-[11px] text-muted-foreground">Based on daily average</p>
            </CardContent>
          </Card>
        </div>

        {/* Daily cost chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Daily Costs (Last 7 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            {dailyBreakdown.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <DollarSign className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">No cost data yet</p>
              </div>
            ) : (
              <div className="flex items-end gap-2" style={{ height: 160 }}>
                {dailyBreakdown.slice(-7).map((day, i) => (
                  <div key={day.date} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] font-medium">{formatCents(day.amountCents)}</span>
                    <div
                      className={cn(
                        "w-full rounded-t-md transition-colors",
                        i === dailyBreakdown.slice(-7).length - 1 ? "bg-primary" : "bg-primary/50"
                      )}
                      style={{ height: `${Math.max((day.amountCents / maxDaily) * 120, 4)}px` }}
                    />
                    <span className="text-[10px] text-muted-foreground">{day.date.split("-")[2]}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Cost breakdown + Provider costs */}
        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cost Breakdown</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {providerCosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No cost breakdown available</p>
              ) : (
                providerCosts.map((item, idx) => {
                  const totalCost = providerCosts.reduce((sum, p) => sum + p.amountCents, 0);
                  const percent = totalCost > 0 ? Math.round((item.amountCents / totalCost) * 100) : 0;
                  return (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2">
                          <Phone className="h-4 w-4 text-muted-foreground" />
                          <span>{item.provider}</span>
                        </div>
                        <span className="font-medium">{formatCents(item.amountCents)}</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${percent}%` }} />
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider Costs</CardTitle>
            </CardHeader>
            <CardContent>
              {providerCosts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No provider costs yet</p>
              ) : (
                <div className="space-y-3">
                  {providerCosts.map((provider, idx) => (
                    <div key={idx} className="flex items-center justify-between rounded-lg border p-3">
                      <div>
                        <p className="text-sm font-medium">{provider.provider}</p>
                        <p className="text-xs text-muted-foreground">{provider.entries} entries</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">{formatCents(provider.amountCents)}</p>
                        <Badge variant="success" className="text-[10px]">active</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Budget settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Budget & Limits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">Monthly Budget</p>
                <p className="mt-1 text-2xl font-bold">{formatCents(monthBudget)}</p>
                <Button size="sm" variant="outline" className="mt-2">Change</Button>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">Max Call Duration</p>
                <p className="mt-1 text-2xl font-bold">-</p>
                <Button size="sm" variant="outline" className="mt-2">Change</Button>
              </div>
              <div className="rounded-lg border p-4">
                <p className="text-sm font-medium">Daily Spend Alert</p>
                <p className="mt-1 text-2xl font-bold">{formatCents(summary?.budgetDailyAlertCents || 0)}</p>
                <Button size="sm" variant="outline" className="mt-2">Change</Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}