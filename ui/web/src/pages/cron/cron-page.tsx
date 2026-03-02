import { useState } from "react";
import { Clock, Plus, Play, Trash2, History, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Pagination } from "@/components/shared/pagination";
import { TableSkeleton } from "@/components/shared/loading-skeleton";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { useCron, type CronJob, type CronRunLogEntry } from "./hooks/use-cron";
import { CronFormDialog } from "./cron-form-dialog";
import { CronRunLogDialog } from "./cron-run-log-dialog";
import { CronDetailDrawer } from "./cron-detail-drawer";
import { CronFilterBar, type CronFilter } from "./cron-filter-bar";
import { useMinLoading } from "@/hooks/use-min-loading";
import { useDeferredLoading } from "@/hooks/use-deferred-loading";
import { usePagination } from "@/hooks/use-pagination";

function formatSchedule(job: CronJob): string {
  const s = job.schedule;
  if (s.kind === "every" && s.everyMs) {
    const sec = s.everyMs / 1000;
    if (sec < 60) return `every ${sec}s`;
    if (sec < 3600) return `every ${Math.round(sec / 60)}m`;
    return `every ${Math.round(sec / 3600)}h`;
  }
  if (s.kind === "cron" && s.expr) return s.expr;
  if (s.kind === "at" && s.atMs) return `once at ${new Date(s.atMs).toLocaleString()}`;
  return s.kind;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;

  if (diff < 0) {
    // Past
    const mins = Math.abs(diff) / 60000;
    if (mins < 60) return `${Math.round(mins)}m ago`;
    const hours = mins / 60;
    if (hours < 24) return `${Math.round(hours)}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  } else {
    // Future
    const mins = diff / 60000;
    if (mins < 60) return `in ${Math.round(mins)}m`;
    const hours = mins / 60;
    if (hours < 24) return `in ${Math.round(hours)}h`;
    return `in ${Math.round(hours / 24)}d`;
  }
}

function formatDate(date: Date): string {
  return date.toLocaleString();
}

export function CronPage() {
  const { jobs, mode, loading, refresh, createJob, editJob, toggleJob, deleteJob, runJob, getRunLog } = useCron();
  const spinning = useMinLoading(loading);
  const showSkeleton = useDeferredLoading(loading && jobs.length === 0);
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<CronJob | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);
  const [runLogTarget, setRunLogTarget] = useState<CronJob | null>(null);
  const [runLogEntries, setRunLogEntries] = useState<CronRunLogEntry[]>([]);
  const [runLogLoading, setRunLogLoading] = useState(false);
  const [runLogPage, setRunLogPage] = useState(1);
  const [runLogPageSize, setRunLogPageSize] = useState(20);
  const [runLogTotal, setRunLogTotal] = useState(0);
  const [toggleTarget, setToggleTarget] = useState<{ job: CronJob; enabled: boolean } | null>(null);
  const [selectedJob, setSelectedJob] = useState<CronJob | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Filter state
  const [filter, setFilter] = useState<CronFilter>({
    search: "",
    status: "all",
    agent: "all",
    schedule: "all",
  });

  // Sort state
  type SortColumn = "name" | "schedule" | "nextRun" | "lastRun" | "status";
  type SortDirection = "asc" | "desc";
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection } | null>(null);

  // Extract unique agents
  const uniqueAgents = Array.from(new Set(jobs.map((j) => j.agentId || "default")));

  // Filter jobs
  const filteredJobs = jobs.filter((job) => {
    // Search filter
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      const nameMatch = job.name.toLowerCase().includes(searchLower);
      const messageMatch = job.payload?.message?.toLowerCase().includes(searchLower);
      if (!nameMatch && !messageMatch) return false;
    }

    // Status filter
    if (filter.status === "enabled" && !job.enabled) return false;
    if (filter.status === "disabled" && job.enabled) return false;

    // Agent filter
    if (filter.agent !== "all") {
      const jobAgent = job.agentId || "default";
      if (jobAgent !== filter.agent) return false;
    }

    // Schedule filter
    if (filter.schedule !== "all") {
      if (job.schedule.kind !== filter.schedule) return false;
    }

    return true;
  });

  // Sort jobs
  const sortedJobs = [...filteredJobs].sort((a, b) => {
    if (!sort) return 0;

    const getValue = (job: CronJob) => {
      switch (sort.column) {
        case "name":
          return job.name.toLowerCase();
        case "schedule":
          return formatSchedule(job);
        case "nextRun":
          return job.state?.nextRunAtMs || 0;
        case "lastRun":
          return job.state?.lastRunAtMs || 0;
        case "status":
          return job.state?.lastStatus || "";
        default:
          return 0;
      }
    };

    const aVal = getValue(a);
    const bVal = getValue(b);

    if (typeof aVal === "string" && typeof bVal === "string") {
      return sort.direction === "asc"
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }

    return sort.direction === "asc" ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
  });

  const { pageItems, pagination, setPage, setPageSize } = usePagination(sortedJobs);

  const handleShowRunLog = async (job: CronJob) => {
    setRunLogTarget(job);
    setRunLogPage(1);
    setRunLogLoading(true);
    try {
      const result = await getRunLog(job.id, 20, 0);
      setRunLogEntries(result.entries);
      setRunLogTotal(result.total);
    } finally {
      setRunLogLoading(false);
    }
  };

  const handleRunLogPageChange = async (newPage: number) => {
    if (!runLogTarget) return;
    setRunLogPage(newPage);
    setRunLogLoading(true);
    try {
      const offset = (newPage - 1) * runLogPageSize;
      const result = await getRunLog(runLogTarget.id, runLogPageSize, offset);
      setRunLogEntries(result.entries);
    } finally {
      setRunLogLoading(false);
    }
  };

  const handleRunLogPageSizeChange = async (newPageSize: number) => {
    if (!runLogTarget) return;
    setRunLogPageSize(newPageSize);
    setRunLogPage(1);
    setRunLogLoading(true);
    try {
      const result = await getRunLog(runLogTarget.id, newPageSize, 0);
      setRunLogEntries(result.entries);
    } finally {
      setRunLogLoading(false);
    }
  };

  const handleExport = async () => {
    if (!runLogTarget) return;

    // Fetch all entries for export
    const allEntries: CronRunLogEntry[] = [];
    const batchSize = 200;
    let offset = 0;

    while (true) {
      const batch = await getRunLog(runLogTarget.id, batchSize, offset);
      allEntries.push(...batch.entries);
      offset += batchSize;
      if (offset >= batch.total) break;
    }

    const exportData = {
      jobName: runLogTarget.name,
      exportedAt: new Date().toISOString(),
      totalEntries: allEntries.length,
      entries: allEntries,
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cron-run-log-${runLogTarget.name.replace(/[^a-z0-9]/gi, "-")}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Cron"
        description="Schedule recurring agent tasks"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={spinning} className="gap-1">
              <RefreshCw className={"h-3.5 w-3.5" + (spinning ? " animate-spin" : "")} /> Refresh
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
              <Plus className="h-3.5 w-3.5" /> New Job
            </Button>
          </div>
        }
      />

      <div className="mt-4">
        {/* Standalone Mode Warning */}
        {mode === "standalone" && (
          <Alert variant="default" className="mb-4 bg-amber-50 border-amber-200">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertTitle className="text-amber-800">Standalone Mode</AlertTitle>
            <AlertDescription className="text-amber-700">
              Run logs are not persistent and will be lost when the server restarts.
            </AlertDescription>
          </Alert>
        )}

        {/* Filter Bar */}
        <CronFilterBar filter={filter} onFilterChange={setFilter} agents={uniqueAgents} />

        {showSkeleton ? (
          <TableSkeleton rows={5} />
        ) : jobs.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No cron jobs"
            description="Create a cron job to schedule recurring agent tasks."
            action={
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" /> New Job
              </Button>
            }
          />
        ) : (
          <div className="rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="px-4 py-3 text-left font-medium">Enabled</th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => setSort(sort?.column === "name" ? (sort.direction === "asc" ? null : { column: "name", direction: "asc" }) : { column: "name", direction: "asc" })}
                  >
                    <div className="flex items-center gap-1">
                      Name
                      {sort?.column === "name" && <span className="text-muted-foreground">{sort.direction === "asc" ? "↑" : "↓"}</span>}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => setSort(sort?.column === "schedule" ? (sort.direction === "asc" ? null : { column: "schedule", direction: "asc" }) : { column: "schedule", direction: "asc" })}
                  >
                    <div className="flex items-center gap-1">
                      Schedule
                      {sort?.column === "schedule" && <span className="text-muted-foreground">{sort.direction === "asc" ? "↑" : "↓"}</span>}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => setSort(sort?.column === "nextRun" ? (sort.direction === "asc" ? null : { column: "nextRun", direction: "asc" }) : { column: "nextRun", direction: "asc" })}
                  >
                    <div className="flex items-center gap-1">
                      Next Run
                      {sort?.column === "nextRun" && <span className="text-muted-foreground">{sort.direction === "asc" ? "↑" : "↓"}</span>}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => setSort(sort?.column === "lastRun" ? (sort.direction === "asc" ? null : { column: "lastRun", direction: "asc" }) : { column: "lastRun", direction: "asc" })}
                  >
                    <div className="flex items-center gap-1">
                      Last Run
                      {sort?.column === "lastRun" && <span className="text-muted-foreground">{sort.direction === "asc" ? "↑" : "↓"}</span>}
                    </div>
                  </th>
                  <th
                    className="px-4 py-3 text-left font-medium cursor-pointer hover:bg-muted/50 select-none"
                    onClick={() => setSort(sort?.column === "status" ? (sort.direction === "asc" ? null : { column: "status", direction: "asc" }) : { column: "status", direction: "asc" })}
                  >
                    <div className="flex items-center gap-1">
                      Status
                      {sort?.column === "status" && <span className="text-muted-foreground">{sort.direction === "asc" ? "↑" : "↓"}</span>}
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left font-medium">Message</th>
                  <th className="px-4 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((job: CronJob) => (
                  <tr
                    key={job.id}
                    className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                    onClick={() => {
                      setSelectedJob(job);
                      setShowDetail(true);
                    }}
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Switch
                        checked={job.enabled}
                        onCheckedChange={(checked: boolean) => setToggleTarget({ job, enabled: checked })}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium">{job.name}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{formatSchedule(job)}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {job.state?.nextRunAtMs ? (
                        <span title={formatDate(new Date(job.state.nextRunAtMs))}>
                          {formatRelativeTime(job.state.nextRunAtMs)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {job.state?.lastRunAtMs ? (
                        <span title={formatDate(new Date(job.state.lastRunAtMs))}>
                          {formatRelativeTime(job.state.lastRunAtMs)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {job.state?.lastStatus ? (
                        <Badge variant={job.state.lastStatus === "ok" ? "default" : "destructive"}>
                          {job.state.lastStatus}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">Never</span>
                      )}
                    </td>
                    <td className="max-w-[200px] truncate px-4 py-3 text-muted-foreground">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">{job.payload?.message}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-md">
                            <p className="whitespace-pre-wrap">{job.payload?.message}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Run now"
                          onClick={() => runJob(job.id)}
                        >
                          <Play className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Run history"
                          onClick={() => handleShowRunLog(job)}
                        >
                          <History className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Delete"
                          onClick={() => setDeleteTarget(job)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              page={pagination.page}
              pageSize={pagination.pageSize}
              total={pagination.total}
              totalPages={pagination.totalPages}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </div>
        )}
      </div>

      <CronFormDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        onSubmit={createJob}
        onEdit={editJob}
        editJob={editTarget}
      />

      <CronDetailDrawer
        open={showDetail}
        onOpenChange={setShowDetail}
        job={selectedJob}
        onEdit={(job) => {
          setShowDetail(false);
          setEditTarget(job);
        }}
        onRun={runJob}
        onToggle={(job, enabled) => {
          setToggleTarget({ job, enabled });
        }}
        onDelete={(job) => {
          setShowDetail(false);
          setDeleteTarget(job);
        }}
      />

      {toggleTarget && (
        <ConfirmDialog
          open
          onOpenChange={() => setToggleTarget(null)}
          title={toggleTarget.enabled ? "Enable Cron Job" : "Disable Cron Job"}
          description={
            toggleTarget.enabled
              ? `Enable "${toggleTarget.job.name}"? It will start running on schedule.`
              : `Disable "${toggleTarget.job.name}"? It will stop running until re-enabled.`
          }
          confirmLabel={toggleTarget.enabled ? "Enable" : "Disable"}
          variant={toggleTarget.enabled ? "default" : "destructive"}
          onConfirm={async () => {
            await toggleJob(toggleTarget.job.id, toggleTarget.enabled);
            setToggleTarget(null);
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          open
          onOpenChange={() => setDeleteTarget(null)}
          title="Delete Cron Job"
          description={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={async () => {
            await deleteJob(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      )}

      {runLogTarget && (
        <CronRunLogDialog
          open
          onOpenChange={() => setRunLogTarget(null)}
          jobName={runLogTarget.name}
          entries={runLogEntries}
          loading={runLogLoading}
          mode={mode}
          total={runLogTotal}
          page={runLogPage}
          pageSize={runLogPageSize}
          onPageChange={handleRunLogPageChange}
          onPageSizeChange={handleRunLogPageSizeChange}
          onExport={handleExport}
        />
      )}
    </div>
  );
}
