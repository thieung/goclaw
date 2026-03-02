import { Search, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export interface CronFilter {
  search: string
  status: "all" | "enabled" | "disabled"
  agent: string
  schedule: "all" | "every" | "cron" | "at"
}

interface CronFilterBarProps {
  filter: CronFilter
  onFilterChange: (filter: CronFilter) => void
  agents: string[]  // Unique agent IDs from jobs
}

export function CronFilterBar({ filter, onFilterChange, agents }: CronFilterBarProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {/* Search */}
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by name or message..."
          value={filter.search}
          onChange={(e) => onFilterChange({ ...filter, search: e.target.value })}
          className="pl-8"
        />
      </div>

      {/* Status Filter */}
      <Select value={filter.status} onValueChange={(v: any) => onFilterChange({ ...filter, status: v })}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="enabled">Enabled</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </SelectContent>
      </Select>

      {/* Agent Filter */}
      <Select value={filter.agent} onValueChange={(v: any) => onFilterChange({ ...filter, agent: v })}>
        <SelectTrigger className="w-[150px]">
          <SelectValue placeholder="Agent" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Agents</SelectItem>
          {agents.map((agent) => (
            <SelectItem key={agent} value={agent}>
              {agent === "default" ? "Default" : agent.slice(0, 8)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Schedule Filter */}
      <Select value={filter.schedule} onValueChange={(v: any) => onFilterChange({ ...filter, schedule: v })}>
        <SelectTrigger className="w-[130px]">
          <SelectValue placeholder="Schedule" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Types</SelectItem>
          <SelectItem value="every">Interval</SelectItem>
          <SelectItem value="cron">Cron</SelectItem>
          <SelectItem value="at">One-time</SelectItem>
        </SelectContent>
      </Select>

      {/* Clear Filters */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onFilterChange({ search: "", status: "all", agent: "all", schedule: "all" })}
        disabled={
          filter.search === "" &&
          filter.status === "all" &&
          filter.agent === "all" &&
          filter.schedule === "all"
        }
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  )
}
