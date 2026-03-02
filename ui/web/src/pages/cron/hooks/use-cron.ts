import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWs } from "@/hooks/use-ws";
import { Methods } from "@/api/protocol";
import { queryKeys } from "@/lib/query-keys";

export interface CronSchedule {
  kind: "at" | "every" | "cron";
  atMs?: number;
  everyMs?: number;
  expr?: string;
  tz?: string;
}

export interface CronPayload {
  kind: string;
  message: string;
  deliver: boolean;
  channel: string;
  to: string;
}

export interface CronJob {
  id: string;
  name: string;
  agentId?: string;
  enabled: boolean;
  schedule: CronSchedule;
  payload: CronPayload;
  createdAtMs: number;
  updatedAtMs: number;
  deleteAfterRun?: boolean;
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
  };
}

export interface CronListResponse {
  jobs: CronJob[];
  mode: "standalone" | "managed";
  count: number;
}

export interface CronRunLogEntry {
  ts: number;
  jobId: string;
  status?: string;
  error?: string;
  summary?: string;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export function useCron() {
  const ws = useWs();
  const queryClient = useQueryClient();

  const { data: cronData, isLoading: loading } = useQuery({
    queryKey: queryKeys.cron.all,
    queryFn: async () => {
      if (!ws.isConnected) return { jobs: [], mode: "standalone" as const, count: 0 };
      const res = await ws.call<CronListResponse>(Methods.CRON_LIST, {
        includeDisabled: true,
      });
      return res ?? { jobs: [], mode: "standalone" as const, count: 0 };
    },
  });

  const jobs = cronData?.jobs ?? [];
  const mode = cronData?.mode ?? "standalone";

  const invalidate = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.cron.all }),
    [queryClient],
  );

  const createJob = useCallback(
    async (params: {
      name: string;
      schedule: CronSchedule;
      message: string;
      agentId?: string;
      deliver?: boolean;
      channel?: string;
      to?: string;
    }) => {
      await ws.call(Methods.CRON_CREATE, params);
      await invalidate();
    },
    [ws, invalidate],
  );

  const editJob = useCallback(
    async (jobId: string, params: {
      name?: string;
      schedule?: CronSchedule;
      message?: string;
      agentId?: string;
    }) => {
      await ws.call(Methods.CRON_UPDATE, { jobId, patch: params });
      await invalidate();
    },
    [ws, invalidate],
  );

  const toggleJob = useCallback(
    async (jobId: string, enabled: boolean) => {
      await ws.call(Methods.CRON_TOGGLE, { jobId, enabled });
      await invalidate();
    },
    [ws, invalidate],
  );

  const deleteJob = useCallback(
    async (jobId: string) => {
      await ws.call(Methods.CRON_DELETE, { jobId });
      await invalidate();
    },
    [ws, invalidate],
  );

  const runJob = useCallback(
    async (jobId: string) => {
      await ws.call(Methods.CRON_RUN, { jobId, mode: "force" });
    },
    [ws],
  );

  const getRunLog = useCallback(
    async (jobId: string, limit = 20, offset = 0): Promise<{ entries: CronRunLogEntry[]; total: number }> => {
      if (!ws.isConnected) return { entries: [], total: 0 };
      const res = await ws.call<{ entries: CronRunLogEntry[]; total: number }>(Methods.CRON_RUNS, {
        jobId,
        limit,
        offset,
      });
      return res ?? { entries: [], total: 0 };
    },
    [ws],
  );

  return { jobs, mode, loading, refresh: invalidate, createJob, editJob, toggleJob, deleteJob, runJob, getRunLog };
}
