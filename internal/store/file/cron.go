package file

import (
	"strings"
	"time"

	"github.com/nextlevelbuilder/goclaw/internal/cron"
	"github.com/nextlevelbuilder/goclaw/internal/store"
)

// FileCronStore wraps cron.Service to implement store.CronStore.
type FileCronStore struct {
	svc *cron.Service
}

func NewFileCronStore(svc *cron.Service) *FileCronStore {
	return &FileCronStore{svc: svc}
}

// Service returns the underlying cron.Service for direct access during migration.
func (f *FileCronStore) Service() *cron.Service { return f.svc }

func (f *FileCronStore) AddJob(name string, schedule store.CronSchedule, message string, deliver bool, channel, to, agentID, userID string) (*store.CronJob, error) {
	cronSched := toCronSchedule(schedule)
	job, err := f.svc.AddJob(name, cronSched, message, deliver, channel, to, agentID)
	if err != nil {
		return nil, err
	}
	result := cronJobToStore(job)
	return &result, nil
}

func (f *FileCronStore) GetJob(jobID string) (*store.CronJob, bool) {
	job, ok := f.svc.GetJob(jobID)
	if !ok {
		return nil, false
	}
	result := cronJobToStore(job)
	return &result, true
}

func (f *FileCronStore) ListJobs(filter store.ListJobsFilter) []store.CronJob {
	jobs := f.svc.ListJobs(filter.IncludeDisabled)
	var result []store.CronJob

	for _, j := range jobs {
		job := cronJobToStore(&j)

		// Apply filters
		if filter.StatusFilter == "enabled" && !job.Enabled {
			continue
		}
		if filter.StatusFilter == "disabled" && job.Enabled {
			continue
		}
		if filter.AgentFilter != "" && filter.AgentFilter != "all" {
			if job.AgentID != filter.AgentFilter {
				continue
			}
		}
		if filter.UserID != "" && job.UserID != filter.UserID {
			continue
		}
		if filter.Search != "" {
			searchLower := strings.ToLower(filter.Search)
			if !strings.Contains(strings.ToLower(job.Name), searchLower) &&
				!strings.Contains(strings.ToLower(job.Payload.Message), searchLower) {
				continue
			}
		}
		if filter.ScheduleFilter != "" && filter.ScheduleFilter != "all" {
			if job.Schedule.Kind != filter.ScheduleFilter {
				continue
			}
		}

		result = append(result, job)
	}
	return result
}

func (f *FileCronStore) RemoveJob(jobID string) error {
	return f.svc.RemoveJob(jobID)
}

func (f *FileCronStore) UpdateJob(jobID string, patch store.CronJobPatch) (*store.CronJob, error) {
	cronPatch := toCronPatch(patch)
	job, err := f.svc.UpdateJob(jobID, cronPatch)
	if err != nil {
		return nil, err
	}
	result := cronJobToStore(job)
	return &result, nil
}

func (f *FileCronStore) EnableJob(jobID string, enabled bool) error {
	return f.svc.EnableJob(jobID, enabled)
}

func (f *FileCronStore) GetRunLog(jobID string, limit, offset int) ([]store.CronRunLogEntry, int, error) {
	if limit <= 0 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}

	// In-memory run logs (max 200) - fetch all to enable pagination
	allLogs := f.svc.GetRunLog(jobID, 200) // Returns up to 200 logs

	total := len(allLogs)
	start := offset
	end := offset + limit

	if start >= total {
		return []store.CronRunLogEntry{}, total, nil
	}
	if end > total {
		end = total
	}

	paginatedLogs := allLogs[start:end]
	result := make([]store.CronRunLogEntry, len(paginatedLogs))
	for i, e := range paginatedLogs {
		result[i] = store.CronRunLogEntry{
			Ts:      e.Ts,
			JobID:   e.JobID,
			Status:  e.Status,
			Error:   e.Error,
			Summary: e.Summary,
			// File store doesn't have token/duration stats
		}
	}

	return result, total, nil
}

func (f *FileCronStore) Status() map[string]interface{} {
	return f.svc.Status()
}

func (f *FileCronStore) Start() error { return f.svc.Start() }
func (f *FileCronStore) Stop()        { f.svc.Stop() }

func (f *FileCronStore) SetOnJob(handler func(job *store.CronJob) (*store.CronJobResult, error)) {
	f.svc.SetOnJob(func(j *cron.Job) (string, error) {
		sj := cronJobToStore(j)
		result, err := handler(&sj)
		if err != nil {
			return "", err
		}
		if result != nil {
			return result.Content, nil
		}
		return "", nil
	})
}

func (f *FileCronStore) RunJob(jobID string, force bool) (bool, string, error) {
	return f.svc.RunJob(jobID, force)
}

func (f *FileCronStore) GetDueJobs(_ time.Time) []store.CronJob {
	// In standalone mode, the cron.Service handles scheduling internally.
	return nil
}

// --- Conversion helpers ---

func toCronSchedule(s store.CronSchedule) cron.Schedule {
	return cron.Schedule{
		Kind:    s.Kind,
		AtMS:    s.AtMS,
		EveryMS: s.EveryMS,
		Expr:    s.Expr,
		TZ:      s.TZ,
	}
}

func toCronPatch(p store.CronJobPatch) cron.JobPatch {
	var sched *cron.Schedule
	if p.Schedule != nil {
		s := toCronSchedule(*p.Schedule)
		sched = &s
	}
	return cron.JobPatch{
		Name:           p.Name,
		AgentID:        p.AgentID,
		Enabled:        p.Enabled,
		Schedule:       sched,
		Message:        p.Message,
		Deliver:        p.Deliver,
		Channel:        p.Channel,
		To:             p.To,
		DeleteAfterRun: p.DeleteAfterRun,
	}
}

func cronJobToStore(j *cron.Job) store.CronJob {
	return store.CronJob{
		ID:      j.ID,
		Name:    j.Name,
		AgentID: j.AgentID,
		Enabled: j.Enabled,
		Schedule: store.CronSchedule{
			Kind:    j.Schedule.Kind,
			AtMS:    j.Schedule.AtMS,
			EveryMS: j.Schedule.EveryMS,
			Expr:    j.Schedule.Expr,
			TZ:      j.Schedule.TZ,
		},
		Payload: store.CronPayload{
			Kind:    j.Payload.Kind,
			Message: j.Payload.Message,
			Command: j.Payload.Command,
			Deliver: j.Payload.Deliver,
			Channel: j.Payload.Channel,
			To:      j.Payload.To,
		},
		State: store.CronJobState{
			NextRunAtMS: j.State.NextRunAtMS,
			LastRunAtMS:  j.State.LastRunAtMS,
			LastStatus:  j.State.LastStatus,
			LastError:   j.State.LastError,
		},
		CreatedAtMS:    j.CreatedAtMS,
		UpdatedAtMS:    j.UpdatedAtMS,
		DeleteAfterRun: j.DeleteAfterRun,
	}
}
