"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { useAuth } from "@/components/AuthProvider";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UsageLog {
  id: string;
  endpoint: string;
  method: string;
  source: string;
  response_status: number;
  latency_ms: number;
  created_at: string;
}

interface DailyUsage {
  date: string;
  request_count: number;
  endpoint: string;
}

export default function UsagePage() {
  const { organizationId } = useAuth();
  const [recentLogs, setRecentLogs] = useState<UsageLog[]>([]);
  const [dailyUsage, setDailyUsage] = useState<DailyUsage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUsage() {
      if (!organizationId) {
        setLoading(false);
        return;
      }

      const supabase = createClient();

      // Get recent logs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: logs } = await (supabase.from("usage_logs") as any)
        .select("id, endpoint, method, source, response_status, latency_ms, created_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100);

      setRecentLogs((logs as UsageLog[]) || []);

      // Get daily usage for the last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: daily } = await (supabase.from("usage_daily") as any)
        .select("date, request_count, endpoint")
        .eq("organization_id", organizationId)
        .gte("date", thirtyDaysAgo.toISOString().split("T")[0])
        .order("date", { ascending: true });

      setDailyUsage((daily as DailyUsage[]) || []);
      setLoading(false);
    }

    loadUsage();
  }, [organizationId]);

  // Aggregate daily usage for chart
  const chartData = dailyUsage.reduce((acc, item) => {
    const existing = acc.find((d) => d.date === item.date);
    if (existing) {
      existing.requests += item.request_count;
    } else {
      acc.push({ date: item.date, requests: item.request_count });
    }
    return acc;
  }, [] as { date: string; requests: number }[]);

  // Endpoint breakdown
  const endpointBreakdown = dailyUsage.reduce((acc, item) => {
    const existing = acc.find((d) => d.endpoint === item.endpoint);
    if (existing) {
      existing.count += item.request_count;
    } else {
      acc.push({ endpoint: item.endpoint, count: item.request_count });
    }
    return acc;
  }, [] as { endpoint: string; count: number }[]);

  endpointBreakdown.sort((a, b) => b.count - a.count);

  if (loading) {
    return (
      <div className="animate-pulse">
        <div className="h-8 bg-gray-800 rounded w-48 mb-8"></div>
        <div className="h-64 bg-gray-800 rounded-lg mb-8"></div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-gray-800 rounded-lg"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-bold mb-8">Usage Analytics</h1>

      {/* Usage chart */}
      <div className="bg-gray-900 rounded-lg p-6 mb-8">
        <h2 className="font-semibold mb-4">Requests (Last 30 Days)</h2>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis
                dataKey="date"
                stroke="#9CA3AF"
                fontSize={12}
                tickFormatter={(value) =>
                  new Date(value).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                }
              />
              <YAxis stroke="#9CA3AF" fontSize={12} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1F2937",
                  border: "1px solid #374151",
                  borderRadius: "8px",
                }}
                labelStyle={{ color: "#9CA3AF" }}
              />
              <Line
                type="monotone"
                dataKey="requests"
                stroke="#8B5CF6"
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-400 text-center py-8">No usage data yet</p>
        )}
      </div>

      {/* Endpoint breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
        <div className="bg-gray-900 rounded-lg p-6">
          <h2 className="font-semibold mb-4">By Endpoint</h2>
          {endpointBreakdown.length > 0 ? (
            <div className="space-y-2">
              {endpointBreakdown.slice(0, 10).map((item) => (
                <div
                  key={item.endpoint}
                  className="flex justify-between items-center"
                >
                  <span className="text-sm font-mono text-gray-400">
                    {item.endpoint}
                  </span>
                  <span className="text-sm">{item.count.toLocaleString()}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-4">No data</p>
          )}
        </div>

        <div className="bg-gray-900 rounded-lg p-6">
          <h2 className="font-semibold mb-4">By Source</h2>
          {recentLogs.length > 0 ? (
            <div className="space-y-2">
              {["api", "mcp", "cli"].map((source) => {
                const count = recentLogs.filter((l) => l.source === source).length;
                return (
                  <div
                    key={source}
                    className="flex justify-between items-center"
                  >
                    <span className="text-sm capitalize">{source}</span>
                    <span className="text-sm">{count}</span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-400 text-center py-4">No data</p>
          )}
        </div>
      </div>

      {/* Recent requests */}
      <div className="bg-gray-900 rounded-lg p-6">
        <h2 className="font-semibold mb-4">Recent Requests</h2>
        {recentLogs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-400 border-b border-gray-800">
                  <th className="pb-2">Endpoint</th>
                  <th className="pb-2">Source</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Latency</th>
                  <th className="pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentLogs.slice(0, 20).map((log) => (
                  <tr key={log.id} className="border-b border-gray-800">
                    <td className="py-2 font-mono">{log.endpoint}</td>
                    <td className="py-2 capitalize">{log.source}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs ${
                          log.response_status < 400
                            ? "bg-green-900 text-green-300"
                            : "bg-red-900 text-red-300"
                        }`}
                      >
                        {log.response_status}
                      </span>
                    </td>
                    <td className="py-2">{log.latency_ms}ms</td>
                    <td className="py-2 text-gray-400">
                      {new Date(log.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-gray-400 text-center py-8">
            No requests yet. Make your first API call to see usage data here.
          </p>
        )}
      </div>
    </div>
  );
}
