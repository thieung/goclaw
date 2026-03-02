import React, { useState } from "react"
import { ChevronDown, ChevronUp, Copy, Download } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { formatDate } from "@/lib/format"
import type { CronRunLogEntry } from "./hooks/use-cron"

interface CronRunLogDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobName: string
  entries: CronRunLogEntry[]
  loading: boolean
  mode?: "standalone" | "managed"
  total?: number
  page?: number
  pageSize?: number
  onPageChange?: (page: number) => void
  onPageSizeChange?: (pageSize: number) => void
  onExport?: () => void
}

export function CronRunLogDialog({
  open,
  onOpenChange,
  jobName,
  entries,
  loading,
  mode = "standalone",
  total = 0,
  page = 1,
  pageSize = 20,
  onPageChange,
  onPageSizeChange,
  onExport,
}: CronRunLogDialogProps) {
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  const handleCopy = async (text: string, type: string) => {
    try {
      await navigator.clipboard.writeText(text)
      alert(`${type} copied to clipboard!`)
    } catch (err) {
      console.error("Failed to copy:", err)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-4xl flex flex-col">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle>Run Log: {jobName}</DialogTitle>
          <Button variant="outline" size="sm" onClick={onExport} disabled={entries.length === 0}>
            <Download className="h-3.5 w-3.5 mr-2" />
            Export JSON
          </Button>
        </DialogHeader>

        {/* Mode disclaimer */}
        {mode === "standalone" && (
          <Alert variant="default" className="bg-blue-50 border-blue-200">
            <AlertDescription className="text-blue-700 text-xs">
              Token usage statistics are only available in managed mode.
            </AlertDescription>
          </Alert>
        )}

        {loading && entries.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No run history yet.
          </p>
        ) : (
          <div className="flex flex-col flex-1 min-h-0">
            <div className="rounded-md border flex-1 overflow-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50">
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium">Timestamp</th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">Summary</th>
                    {mode === "managed" && (
                      <>
                        <th className="px-4 py-3 text-left font-medium">Duration</th>
                        <th className="px-4 py-3 text-right font-medium">Tokens</th>
                      </>
                    )}
                    <th className="px-4 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, i) => (
                    <React.Fragment key={i}>
                      <tr
                        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                        onClick={() => setExpandedRow(expandedRow === i ? null : i)}
                      >
                        <td className="px-4 py-3 whitespace-nowrap">
                          {formatDate(new Date(entry.ts))}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={entry.status === "ok" ? "default" : "destructive"}>
                            {entry.status || "unknown"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 max-w-[300px] truncate">
                          {entry.summary || "No output"}
                        </td>
                        {mode === "managed" && (
                          <>
                            <td className="px-4 py-3">
                              {entry.durationMs ? (
                                <span className="text-muted-foreground">
                                  {(entry.durationMs / 1000).toFixed(1)}s
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {entry.inputTokens || entry.outputTokens ? (
                                <span className="text-muted-foreground">
                                  {entry.inputTokens?.toLocaleString() ?? 0} / {entry.outputTokens?.toLocaleString() ?? 0}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3 text-right">
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            {expandedRow === i ? (
                              <ChevronUp className="h-4 w-4" />
                            ) : (
                              <ChevronDown className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                      </tr>

                      {/* Expanded Row */}
                      {expandedRow === i && (
                        <tr>
                          <td colSpan={6} className="border-b bg-muted/20">
                            <div className="p-4 space-y-3">
                              {/* Full Summary */}
                              <div>
                                <label className="text-xs font-medium text-muted-foreground">Output</label>
                                <pre className="mt-1 rounded bg-background p-3 text-xs whitespace-pre-wrap max-h-[300px] overflow-auto border">
                                  {entry.summary || "No output"}
                                </pre>
                              </div>

                              {/* Error (if failed) */}
                              {entry.error && (
                                <div>
                                  <label className="text-xs font-medium text-muted-foreground">Error</label>
                                  <pre className="mt-1 rounded bg-destructive/10 p-3 text-xs text-destructive whitespace-pre-wrap max-h-[200px] overflow-auto border border-destructive/20">
                                    {entry.error}
                                  </pre>
                                </div>
                              )}

                              {/* Token Stats (Managed mode only) */}
                              {mode === "managed" && (entry.inputTokens !== undefined || entry.outputTokens !== undefined) && (
                                <div className="grid grid-cols-2 gap-4">
                                  <div className="rounded border p-2">
                                    <div className="text-xs text-muted-foreground">Input Tokens</div>
                                    <div className="text-sm font-medium">{entry.inputTokens?.toLocaleString() ?? "—"}</div>
                                  </div>
                                  <div className="rounded border p-2">
                                    <div className="text-xs text-muted-foreground">Output Tokens</div>
                                    <div className="text-sm font-medium">{entry.outputTokens?.toLocaleString() ?? "—"}</div>
                                  </div>
                                </div>
                              )}

                              {/* Actions */}
                              <div className="flex gap-2">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleCopy(entry.summary || "", "Output")}
                                  disabled={!entry.summary}
                                >
                                  <Copy className="h-3.5 w-3.5 mr-2" />
                                  Copy Output
                                </Button>
                                {entry.error && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleCopy(entry.error || "", "Error")}
                                  >
                                    <Copy className="h-3.5 w-3.5 mr-2" />
                                    Copy Error
                                  </Button>
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > 0 && (
              <div className="flex items-center justify-between border-t pt-4 mt-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Show</span>
                  <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange?.(Number(v))}>
                    <SelectTrigger className="w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="text-sm text-muted-foreground">
                    per page | {total} total runs
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange?.(page - 1)}
                    disabled={page === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {page} of {Math.ceil(total / pageSize)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onPageChange?.(page + 1)}
                    disabled={page >= Math.ceil(total / pageSize)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
