import { Sheet, SheetContent } from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { CronJob, CronSchedule } from "./hooks/use-cron"

interface CronDetailDrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  job: CronJob | null
  onEdit: (job: CronJob) => void
  onRun: (jobId: string) => void
  onToggle: (job: CronJob, enabled: boolean) => void
  onDelete: (job: CronJob) => void
}

function formatSchedule(schedule: CronSchedule): string {
  const s = schedule
  if (s.kind === "every" && s.everyMs) {
    const sec = s.everyMs / 1000
    if (sec < 60) return `every ${sec}s`
    if (sec < 3600) return `every ${Math.round(sec / 60)}m`
    return `every ${Math.round(sec / 3600)}h`
  }
  if (s.kind === "cron" && s.expr) return s.expr
  if (s.kind === "at" && s.atMs) return `once at ${new Date(s.atMs).toLocaleString()}`
  return s.kind
}

function formatDate(date: Date): string {
  return date.toLocaleString()
}

export function CronDetailDrawer({
  open,
  onOpenChange,
  job,
  onEdit,
  onRun,
  onToggle,
  onDelete,
}: CronDetailDrawerProps) {
  if (!job) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[480px] overflow-y-auto">
        {/* Header */}
        <div className="border-b pb-4">
          <h2 className="text-lg font-semibold">{job.name}</h2>
          <p className="text-sm text-muted-foreground">ID: {job.id.slice(0, 8)}...</p>
        </div>

        {/* Quick Stats (Managed mode only) */}
        {job.state && (
          <div className="grid grid-cols-3 gap-2 py-4">
            <div className="rounded-lg border p-3 text-center">
              <div className="text-xs text-muted-foreground">Last Run</div>
              <div className="text-sm font-medium">
                {job.state.lastRunAtMs ? formatDate(new Date(job.state.lastRunAtMs)) : "Never"}
              </div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-xs text-muted-foreground">Next Run</div>
              <div className="text-sm font-medium">
                {job.state.nextRunAtMs ? formatDate(new Date(job.state.nextRunAtMs)) : "N/A"}
              </div>
            </div>
            <div className="rounded-lg border p-3 text-center">
              <div className="text-xs text-muted-foreground">Status</div>
              <div className="text-sm font-medium">
                <Badge variant={job.state.lastStatus === "ok" ? "success" : "destructive"}>
                  {job.state.lastStatus || "Never"}
                </Badge>
              </div>
            </div>
          </div>
        )}

        {/* Details */}
        <div className="space-y-4 py-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Schedule</label>
            <p className="text-sm">{formatSchedule(job.schedule)}</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Message</label>
            <p className="text-sm whitespace-pre-wrap">{job.payload?.message}</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Agent</label>
            <p className="text-sm">{job.agentId || "default"}</p>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Created</label>
            <p className="text-sm">{formatDate(new Date(job.createdAtMs))}</p>
          </div>

          {job.state?.lastError && (
            <div>
              <label className="text-xs font-medium text-muted-foreground">Last Error</label>
              <pre className="mt-1 rounded bg-muted p-2 text-xs text-destructive">{job.state.lastError}</pre>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 border-t pt-4">
          <Button variant="outline" onClick={() => onEdit(job)} className="flex-1">
            Edit
          </Button>
          <Button variant="outline" onClick={() => onRun(job.id)} className="flex-1">
            Run Now
          </Button>
        </div>
        <div className="flex gap-2 pt-2">
          <Button
            variant={job.enabled ? "destructive" : "default"}
            onClick={() => onToggle(job, !job.enabled)}
            className="flex-1"
          >
            {job.enabled ? "Disable" : "Enable"}
          </Button>
          <Button variant="ghost" onClick={() => onDelete(job)} className="flex-1">
            Delete
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
